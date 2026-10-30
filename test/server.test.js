import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ExcelJS from "exceljs";

process.env.FOUNDRY_PROJECT_ENDPOINT =
  "https://example.services.ai.azure.com/api/projects/example";
process.env.FOUNDRY_AGENT_NAME = "test-agent";
process.env.FOUNDRY_SPECIALIST_INVOICES = "test-invoices-agent";
process.env.FOUNDRY_SPECIALIST_ACCOUNTS_PAYABLE = "test-payables-agent";
process.env.FOUNDRY_SPECIALIST_INVENTORY = "test-inventory-agent";
process.env.FOUNDRY_SPECIALIST_CUSTOMER_SERVICE = "test-customer-service-agent";
process.env.FOUNDRY_SPECIALIST_INTERNAL_POLICIES = "test-policies-agent";

const { createApp } = await import("../server.js");

async function startServer(t, app) {
  const server = app.listen(0);
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function postAttachment(baseUrl, fileName, mimeType, buffer, message = "Analiza el archivo") {
  const formData = new FormData();
  formData.append("message", message);
  formData.append(
    "attachment",
    new Blob([buffer], { type: mimeType }),
    fileName,
  );
  return fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    body: formData,
  });
}

test("GET /health responde con estado ok", async (t) => {
  const app = createApp({}, "test-agent");
  const baseUrl = await startServer(t, app);

  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("un mensaje vacío devuelve 422", async (t) => {
  const app = createApp({}, "test-agent");
  const baseUrl = await startServer(t, app);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "   " }),
  });

  assert.equal(response.status, 422);
});

test("acepta 2000 caracteres y rechaza 2001", async (t) => {
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "boundary-conversation" }),
    },
    responses: {
      create: async () => ({ output_text: "Respuesta" }),
    },
  };
  const app = createApp(openaiClient, "test-agent");
  const baseUrl = await startServer(t, app);

  const maximumLengthResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "a".repeat(2000) }),
  });
  const overLimitResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "a".repeat(2001) }),
  });

  assert.equal(maximumLengthResponse.status, 200);
  assert.equal(overLimitResponse.status, 422);
});

test("mantiene el identificador de conversación en el seguimiento", async (t) => {
  let createConversationCalls = 0;
  const responseCalls = [];
  const openaiClient = {
    conversations: {
      create: async () => {
        createConversationCalls += 1;
        return { id: "conversation-test-123" };
      },
    },
    responses: {
      create: async (...args) => {
        responseCalls.push(args);
        return { output_text: `Respuesta ${responseCalls.length}` };
      },
    },
  };
  const app = createApp(openaiClient, "rio-claro-agent");
  const baseUrl = await startServer(t, app);

  const firstResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "¿Cómo doy de alta un cliente?", conversation_id: null }),
  });
  const firstResult = await firstResponse.json();
  const followUpResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "¿Qué documentos necesito?",
      conversation_id: firstResult.conversation_id,
    }),
  });
  const followUpResult = await followUpResponse.json();

  assert.equal(firstResponse.status, 200);
  assert.equal(followUpResponse.status, 200);
  assert.equal(createConversationCalls, 1);
  assert.equal(firstResult.conversation_id, "conversation-test-123");
  assert.equal(followUpResult.conversation_id, "conversation-test-123");
  assert.deepEqual(
    responseCalls.map(([params]) => params),
    [
      { conversation: "conversation-test-123", input: "¿Cómo doy de alta un cliente?" },
      { conversation: "conversation-test-123", input: "¿Qué documentos necesito?" },
    ],
  );
  assert.deepEqual(responseCalls[0][1], {
    body: {
      agent_reference: {
        name: "rio-claro-agent",
        type: "agent_reference",
      },
    },
  });
});

test("delega en el especialista permitido y entrega su resultado al orquestador", async (t) => {
  const responseCalls = [];
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "delegation-conversation" }),
    },
    responses: {
      create: async (...args) => {
        responseCalls.push(args);
        const [params, options] = args;
        const agentName = options.body.agent_reference.name;

        if (agentName === "test-invoices-agent") {
          return { output_text: "La factura requiere validación." };
        }

        if (Array.isArray(params.input)) {
          return { output_text: "La factura requiere validación previa." };
        }

        return {
          output: [
            {
              type: "function_call",
              call_id: "call-invoices",
              name: "delegate_to_specialist",
              arguments: JSON.stringify({
                specialist: "invoices",
                task: "Verifica los requisitos de validación de factura.",
              }),
            },
          ],
        };
      },
    },
  };
  const app = createApp(openaiClient, "test-orchestrator");
  const baseUrl = await startServer(t, app);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "¿Cómo valido una factura?" }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.reply, "La factura requiere validación previa.");
  assert.deepEqual(
    responseCalls.map(([, options]) => options.body.agent_reference.name),
    ["test-orchestrator", "test-invoices-agent", "test-orchestrator"],
  );
  assert.deepEqual(responseCalls[2][0], {
    conversation: "delegation-conversation",
    input: [
      {
        type: "function_call_output",
        call_id: "call-invoices",
        output: JSON.stringify({ result: "La factura requiere validación." }),
      },
    ],
  });
});

test("si falla un especialista, el orquestador recibe un error controlado", async (t) => {
  let orchestratorCalls = 0;
  let fallbackOutput;
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "fallback-conversation" }),
    },
    responses: {
      create: async (params, options) => {
        if (options.body.agent_reference.name === "test-invoices-agent") {
          throw new Error("internal Foundry detail");
        }

        orchestratorCalls += 1;
        if (orchestratorCalls === 1) {
          return {
            output: [
              {
                type: "function_call",
                call_id: "call-failed-specialist",
                name: "delegate_to_specialist",
                arguments: JSON.stringify({
                  specialist: "invoices",
                  task: "Revisa la factura.",
                }),
              },
            ],
          };
        }

        fallbackOutput = JSON.parse(params.input[0].output);
        return { output_text: "El especialista no está disponible ahora." };
      },
    },
  };
  const app = createApp(openaiClient, "test-orchestrator");
  const baseUrl = await startServer(t, app);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Revisa esta factura." }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.reply, "El especialista no está disponible ahora.");
  assert.deepEqual(fallbackOutput, {
    error: "El agente especialista no estuvo disponible.",
  });
});

test("no invoca agentes fuera de la lista permitida", async (t) => {
  const invokedAgents = [];
  let orchestratorCalls = 0;
  let toolOutput;
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "allowlist-conversation" }),
    },
    responses: {
      create: async (params, options) => {
        const agentName = options.body.agent_reference.name;
        invokedAgents.push(agentName);

        if (agentName !== "test-orchestrator") {
          return { output_text: "No debe invocarse." };
        }

        orchestratorCalls += 1;
        if (orchestratorCalls === 1) {
          return {
            output: [
              {
                type: "function_call",
                call_id: "call-unlisted-agent",
                name: "delegate_to_specialist",
                arguments: JSON.stringify({
                  specialist: "unknown-agent",
                  task: "Ejecuta una tarea.",
                }),
              },
            ],
          };
        }

        toolOutput = JSON.parse(params.input[0].output);
        return { output_text: "No puedo delegar a ese agente." };
      },
    },
  };
  const app = createApp(openaiClient, "test-orchestrator");
  const baseUrl = await startServer(t, app);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Delega esta tarea." }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(invokedAgents, ["test-orchestrator", "test-orchestrator"]);
  assert.deepEqual(toolOutput, {
    error: "La solicitud de delegación no es válida.",
  });
});

test("extrae el texto de un DOCX antes de enviarlo al agente", async (t) => {
  const calls = [];
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "docx-conversation" }),
    },
    responses: {
      create: async (params) => {
        calls.push(params);
        return { output_text: "Respuesta sobre el documento." };
      },
    },
  };
  const app = createApp(openaiClient, "test-agent");
  const baseUrl = await startServer(t, app);
  const docx = await readFile(
    new URL("../node_modules/mammoth/test/test-data/single-paragraph.docx", import.meta.url),
  );

  const response = await postAttachment(
    baseUrl,
    "procedimiento.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docx,
  );

  assert.equal(response.status, 200);
  assert.equal(calls[0].input[0].type, "message");
  assert.equal(calls[0].input[0].role, "user");
  assert.equal(calls[0].input[0].content[0].type, "input_text");
  assert.match(
    calls[0].input[0].content[0].text,
    /Analiza el archivo\n\nContenido extraído de procedimiento\.docx:\nWalking on imported air/,
  );
});

test("extrae celdas de XLSX y las incluye en la entrada del agente", async (t) => {
  const calls = [];
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "xlsx-conversation" }),
    },
    responses: {
      create: async (params) => {
        calls.push(params);
        return { output_text: "Respuesta sobre la hoja." };
      },
    },
  };
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Facturas");
  worksheet.getCell("A1").value = "Folio";
  worksheet.getCell("B1").value = "F-123";
  const xlsx = await workbook.xlsx.writeBuffer();
  const app = createApp(openaiClient, "test-agent");
  const baseUrl = await startServer(t, app);

  const response = await postAttachment(
    baseUrl,
    "facturas.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsx,
  );

  assert.equal(response.status, 200);
  assert.match(calls[0].input[0].content[0].text, /Hoja: Facturas/);
  assert.match(calls[0].input[0].content[0].text, /B1: F-123/);
});

test("envía una imagen JPG como entrada multimodal", async (t) => {
  let receivedInput;
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "image-conversation" }),
    },
    responses: {
      create: async (params) => {
        receivedInput = params.input;
        return { output_text: "La imagen muestra un producto." };
      },
    },
  };
  const app = createApp(openaiClient, "test-agent");
  const baseUrl = await startServer(t, app);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  const response = await postAttachment(baseUrl, "producto.jpg", "image/jpeg", jpg);

  assert.equal(response.status, 200);
  assert.equal(receivedInput[0].type, "message");
  assert.equal(receivedInput[0].role, "user");
  assert.equal(receivedInput[0].content[0].type, "input_text");
  assert.equal(receivedInput[0].content[1].type, "input_image");
  assert.equal(
    receivedInput[0].content[1].image_url,
    `data:image/jpeg;base64,${jpg.toString("base64")}`,
  );
  assert.equal(receivedInput[0].content[1].detail, "auto");
});

test("rechaza extensiones no admitidas y contenido con firma incorrecta", async (t) => {
  const app = createApp({}, "test-agent");
  const baseUrl = await startServer(t, app);
  const pdfResponse = await postAttachment(
    baseUrl,
    "archivo.pdf",
    "application/pdf",
    Buffer.from("%PDF"),
  );
  const invalidPngResponse = await postAttachment(
    baseUrl,
    "imagen.png",
    "image/png",
    Buffer.from("no es una imagen"),
  );

  assert.equal(pdfResponse.status, 415);
  assert.equal(invalidPngResponse.status, 422);
});

test("rechaza archivos mayores a 5 MB", async (t) => {
  const app = createApp({}, "test-agent");
  const baseUrl = await startServer(t, app);
  const oversizedImage = Buffer.alloc(5 * 1024 * 1024 + 1, 0);

  const response = await postAttachment(
    baseUrl,
    "imagen.png",
    "image/png",
    oversizedImage,
  );

  assert.equal(response.status, 413);
});

test("requiere texto para enviar un adjunto y rechaza solicitudes vacías", async (t) => {
  let responseCalls = 0;
  const openaiClient = {
    conversations: {
      create: async () => ({ id: "attachment-only-conversation" }),
    },
    responses: {
      create: async () => {
        responseCalls += 1;
        return { output_text: "Resumen de la imagen." };
      },
    },
  };
  const app = createApp(openaiClient, "test-agent");
  const baseUrl = await startServer(t, app);
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const attachmentResponse = await postAttachment(
    baseUrl,
    "captura.png",
    "image/png",
    image,
    "",
  );
  const emptyResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: " " }),
  });

  assert.equal(attachmentResponse.status, 422);
  assert.equal(emptyResponse.status, 422);
  assert.equal(responseCalls, 0);
});
