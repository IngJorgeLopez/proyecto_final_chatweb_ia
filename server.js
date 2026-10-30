import express from "express";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import multer from "multer";
import path from "node:path";
import yauzl from "yauzl";
import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import {
  SPECIALIST_AGENT_ENV,
  SPECIALIST_TOOL_NAME,
} from "./specialist-tool.js";

const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
const agentName = process.env.FOUNDRY_AGENT_NAME;
const specialistAgents = Object.fromEntries(
  Object.entries(SPECIALIST_AGENT_ENV).map(([key, environmentVariable]) => [
    key,
    process.env[environmentVariable],
  ]),
);
const missingConfiguration = [
  ...(!projectEndpoint ? ["FOUNDRY_PROJECT_ENDPOINT"] : []),
  ...(!agentName ? ["FOUNDRY_AGENT_NAME"] : []),
  ...Object.entries(SPECIALIST_AGENT_ENV)
    .filter(([, environmentVariable]) => !process.env[environmentVariable])
    .map(([, environmentVariable]) => environmentVariable),
];

if (missingConfiguration.length > 0) {
  throw new Error(
    `Faltan variables de entorno obligatorias: ${missingConfiguration.join(", ")}.`,
  );
}

const projectClient = new AIProjectClient(
  projectEndpoint,
  new DefaultAzureCredential(),
);
const openai = projectClient.getOpenAIClient();

const publicDirectory = path.join(import.meta.dirname, "public");
const maxDelegationRounds = 3;
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxArchiveEntries = 1000;
const maxExpandedArchiveBytes = 20 * 1024 * 1024;
const maxExtractedTextLength = 100_000;
const maxSpreadsheetCells = 20_000;
const supportedAttachments = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

class AttachmentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

function getAttachmentExtension(filename) {
  return path.extname(filename).toLowerCase();
}

function hasExpectedSignature(file) {
  const extension = getAttachmentExtension(file.originalname);
  const buffer = file.buffer;

  if (extension === ".jpg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }
  if (extension === ".png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }
  return (
    (extension === ".docx" || extension === ".xlsx") &&
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    [0x03, 0x05, 0x07].includes(buffer[2]) &&
    [0x04, 0x06, 0x08].includes(buffer[3])
  );
}

function inspectOfficeArchive(buffer, requiredEntry) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, validateEntrySizes: true },
      (error, archive) => {
        if (error) {
          reject(new AttachmentValidationError("El archivo comprimido está dañado."));
          return;
        }

        let entryCount = 0;
        let expandedBytes = 0;
        let hasRequiredEntry = false;
        let settled = false;

        const fail = (failure) => {
          if (settled) {
            return;
          }
          settled = true;
          archive.close();
          reject(failure);
        };

        archive.on("error", () => {
          fail(new AttachmentValidationError("El archivo comprimido está dañado."));
        });
        archive.on("entry", (entry) => {
          entryCount += 1;
          expandedBytes += entry.uncompressedSize;

          if (
            entryCount > maxArchiveEntries ||
            expandedBytes > maxExpandedArchiveBytes ||
            (entry.generalPurposeBitFlag & 1) !== 0
          ) {
            fail(
              new AttachmentValidationError(
                "El documento supera los límites de procesamiento permitidos.",
              ),
            );
            return;
          }

          if (entry.fileName === requiredEntry) {
            hasRequiredEntry = true;
          }
          archive.readEntry();
        });
        archive.on("end", () => {
          if (settled) {
            return;
          }
          settled = true;
          if (!hasRequiredEntry) {
            archive.close();
            reject(new AttachmentValidationError("El documento no tiene una estructura válida."));
            return;
          }
          archive.close();
          resolve();
        });
        archive.readEntry();
      },
    );
  });
}

async function extractDocumentText(file) {
  const extension = getAttachmentExtension(file.originalname);
  let text;

  if (extension === ".docx") {
    await inspectOfficeArchive(file.buffer, "word/document.xml");
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    text = result.value;
  } else {
    await inspectOfficeArchive(file.buffer, "xl/workbook.xml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const lines = [];
    let cellCount = 0;
    let textLength = 0;

    for (const worksheet of workbook.worksheets) {
      lines.push(`Hoja: ${worksheet.name}`);
      textLength += worksheet.name.length + 6;

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cellCount += 1;
          if (cellCount > maxSpreadsheetCells) {
            throw new AttachmentValidationError(
              "La hoja de cálculo supera el límite de celdas procesables.",
            );
          }

          const value = cell.text;
          const line = `${cell.address}: ${value}`;
          textLength += line.length + 1;
          if (textLength > maxExtractedTextLength) {
            throw new AttachmentValidationError(
              "El contenido extraído supera el límite de texto procesable.",
            );
          }
          lines.push(line);
        });
      });
    }

    text = lines.join("\n");
  }

  if (text.length > maxExtractedTextLength) {
    throw new AttachmentValidationError(
      "El contenido extraído supera el límite de texto procesable.",
    );
  }
  if (!text.trim()) {
    throw new AttachmentValidationError("No se encontró texto legible en el documento.");
  }

  return text;
}

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxAttachmentBytes,
    files: 1,
    fields: 2,
    fieldSize: 16 * 1024,
  },
  fileFilter: (_request, file, callback) => {
    const extension = getAttachmentExtension(file.originalname);
    if (
      !Object.hasOwn(supportedAttachments, extension) ||
      (file.mimetype && file.mimetype !== supportedAttachments[extension])
    ) {
      const error = new Error("Formato de archivo no admitido.");
      error.code = "UNSUPPORTED_FILE_TYPE";
      callback(error);
      return;
    }
    callback(null, true);
  },
});

export function createApp(
  openaiClient,
  configuredAgentName,
  configuredSpecialistAgents = specialistAgents,
) {
  const app = express();
  const agentRef = {
    body: {
      agent_reference: {
        name: configuredAgentName,
        type: "agent_reference",
      },
    },
  };
  const specialistAgentRefs = Object.fromEntries(
    Object.entries(configuredSpecialistAgents).map(([key, name]) => [
      key,
      {
        body: {
          agent_reference: {
            name,
            type: "agent_reference",
          },
        },
      },
    ]),
  );

  async function invokeSpecialist(specialist, task) {
    const specialistRef = specialistAgentRefs[specialist];
    if (
      !specialistRef ||
      typeof task !== "string" ||
      task.trim().length === 0 ||
      task.trim().length > 2000
    ) {
      return { error: "La solicitud de delegación no es válida." };
    }

    try {
      const result = await openaiClient.responses.create(
        { input: task.trim() },
        specialistRef,
      );
      if (typeof result.output_text !== "string" || result.output_text.length === 0) {
        return { error: "El agente especialista no devolvió una respuesta." };
      }

      return { result: result.output_text };
    } catch (error) {
      console.error(
        `Microsoft Foundry specialist request failed (${specialist}):`,
        error instanceof Error ? error.name : "UnknownError",
      );
      return { error: "El agente especialista no estuvo disponible." };
    }
  }

  async function processToolCalls(result) {
    const functionCalls = getFunctionCalls(result);

    if (functionCalls.length === 0) {
      return null;
    }

    return Promise.all(
      functionCalls.map(async (call) => {
        let output;

        if (call.name !== SPECIALIST_TOOL_NAME) {
          output = { error: "La herramienta solicitada no está disponible." };
        } else {
          try {
            const args = JSON.parse(call.arguments);
            output = await invokeSpecialist(args?.specialist, args?.task);
          } catch {
            output = { error: "Los argumentos de delegación no son válidos." };
          }
        }

        return {
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(output),
        };
      }),
    );
  }

  function getFunctionCalls(result) {
    return Array.isArray(result.output)
      ? result.output.filter((item) => item.type === "function_call")
      : [];
  }

  app.use(express.json({ limit: "16kb" }));
  app.use(express.static(publicDirectory));

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.post(
    "/api/chat",
    (request, response, next) => {
      attachmentUpload.single("attachment")(request, response, (error) => {
        if (!error) {
          next();
          return;
        }
        if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
          response.status(413).json({
            error: "El archivo no puede superar los 5 MB.",
          });
          return;
        }
        if (error.code === "UNSUPPORTED_FILE_TYPE") {
          response.status(415).json({
            error: "Solo se admiten archivos DOCX, XLSX, JPG y PNG.",
          });
          return;
        }
        response.status(400).json({
          error: "No se pudo procesar el archivo adjunto.",
        });
      });
    },
    async (request, response) => {
      const message = request.body?.message;
      const conversationId = request.body?.conversation_id;
      const input = typeof message === "string" ? message.trim() : "";
      const attachment = request.file;

      if (!input || input.length > 2000) {
        return response.status(422).json({
          error: input
            ? "El mensaje no puede superar los 2000 caracteres."
            : "Escribe un mensaje antes de enviarlo. El mensaje admite hasta 2000 caracteres.",
        });
      }

      if (
        conversationId !== undefined &&
        conversationId !== null &&
        (typeof conversationId !== "string" || conversationId.length === 0)
      ) {
        return response.status(422).json({
          error: "El identificador de conversación no es válido.",
        });
      }

      let responseInput = input;
      if (attachment) {
        if (!hasExpectedSignature(attachment)) {
          return response.status(422).json({
            error: "El contenido del archivo no coincide con un formato admitido.",
          });
        }

        const extension = getAttachmentExtension(attachment.originalname);
        const isImage = extension === ".jpg" || extension === ".png";
        const prompt =
          input ||
          (isImage
            ? "Analiza la imagen adjunta y responde de acuerdo con su contenido."
            : "Analiza el documento adjunto y responde de acuerdo con su contenido.");

        try {
          if (isImage) {
            responseInput = [
              {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  {
                    type: "input_image",
                    image_url: `data:${supportedAttachments[extension]};base64,${attachment.buffer.toString("base64")}`,
                    detail: "auto",
                  },
                ],
              },
            ];
          } else {
            const extractedText = await extractDocumentText(attachment);
            responseInput = [
              {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: `${prompt}\n\nContenido extraído de ${attachment.originalname}:\n${extractedText}`,
                  },
                ],
              },
            ];
          }
        } catch (error) {
          if (error instanceof AttachmentValidationError) {
            return response.status(422).json({ error: error.message });
          }
          console.error(
            "Attachment parsing failed:",
            error instanceof Error ? error.name : "UnknownError",
          );
          return response.status(422).json({
            error: "No se pudo leer el archivo. Verifica que sea válido y no esté dañado.",
          });
        }
      }

      try {
        const conversation = conversationId
          ? { id: conversationId }
          : await openaiClient.conversations.create();
        let result = await openaiClient.responses.create(
          { conversation: conversation.id, input: responseInput },
          agentRef,
        );

        for (let round = 0; round < maxDelegationRounds; round += 1) {
          const toolOutputs = await processToolCalls(result);
          if (!toolOutputs) {
            break;
          }

          result = await openaiClient.responses.create(
            { conversation: conversation.id, input: toolOutputs },
            agentRef,
          );
        }

        if (getFunctionCalls(result).length > 0) {
          console.error("Microsoft Foundry orchestration exceeded the delegation limit.");
          return response.status(502).json({
            error: "No se pudo procesar el mensaje. Inténtalo de nuevo más tarde.",
          });
        }

        return response.json({
          reply: result.output_text,
          conversation_id: conversation.id,
        });
      } catch (error) {
        console.error(
          "Microsoft Foundry request failed:",
          error instanceof Error ? error.name : "UnknownError",
        );
        return response.status(502).json({
          error: "No se pudo procesar el mensaje. Inténtalo de nuevo más tarde.",
        });
      }
    },
  );

  return app;
}

const app = createApp(openai, agentName);
const port = process.env.PORT || 3000;

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  app.listen(port, () => {
    console.log(`Chatbot listening on port ${port}.`);
  });
}
