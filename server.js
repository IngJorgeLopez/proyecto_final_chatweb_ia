import express from "express";
import path from "node:path";
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

  app.post("/api/chat", async (request, response) => {
    const message = request.body?.message;
    const conversationId = request.body?.conversation_id;
    const input = typeof message === "string" ? message.trim() : "";

    if (input.length < 1 || input.length > 2000) {
      return response.status(422).json({
        error: "El mensaje debe contener entre 1 y 2000 caracteres.",
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

    try {
      const conversation = conversationId
        ? { id: conversationId }
        : await openaiClient.conversations.create();
      let result = await openaiClient.responses.create(
        { conversation: conversation.id, input },
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
  });

  return app;
}

const app = createApp(openai, agentName);
const port = process.env.PORT || 3000;

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  app.listen(port, () => {
    console.log(`Chatbot listening on port ${port}.`);
  });
}
