import { AIProjectClient } from "@azure/ai-projects";
import { DefaultAzureCredential } from "@azure/identity";
import {
  SPECIALIST_INSTRUCTIONS,
  SPECIALIST_TOOL,
} from "../specialist-tool.js";

const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT;
const agentName = process.env.FOUNDRY_AGENT_NAME;
const modelDeployment = process.env.FOUNDRY_MODEL_DEPLOYMENT;

const missingVariables = [
  ["FOUNDRY_PROJECT_ENDPOINT", projectEndpoint],
  ["FOUNDRY_AGENT_NAME", agentName],
  ["FOUNDRY_MODEL_DEPLOYMENT", modelDeployment],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missingVariables.length > 0) {
  console.error(`Faltan variables de entorno: ${missingVariables.join(", ")}.`);
  process.exitCode = 1;
} else {
  const projectClient = new AIProjectClient(
    projectEndpoint,
    new DefaultAzureCredential(),
  );

  try {
    let latestAgentVersion;
    for await (const version of projectClient.agents.listVersions(agentName)) {
      if (
        !latestAgentVersion ||
        version.created_at > latestAgentVersion.created_at
      ) {
        latestAgentVersion = version;
      }
    }

    if (!latestAgentVersion) {
      throw new Error("No se encontró una versión existente del agente orquestador.");
    }

    if (latestAgentVersion.definition.kind !== "prompt") {
      throw new Error(
        "La configuración automática de delegación requiere un agente de tipo prompt.",
      );
    }

    const currentInstructions = latestAgentVersion.definition.instructions ?? "";
    const instructions = currentInstructions.includes(SPECIALIST_INSTRUCTIONS)
      ? currentInstructions
      : [currentInstructions, SPECIALIST_INSTRUCTIONS].filter(Boolean).join("\n\n");
    const currentTools = latestAgentVersion.definition.tools ?? [];

    const agentVersion = await projectClient.agents.createVersion(agentName, {
      ...latestAgentVersion.definition,
      model: modelDeployment,
      instructions,
      tools: [
        ...currentTools.filter((tool) => tool.name !== SPECIALIST_TOOL.name),
        SPECIALIST_TOOL,
      ],
    });

    console.log(
      `Se creó la versión ${agentVersion.version} del agente "${agentVersion.name}".`,
    );
  } catch (error) {
    console.error(
      "No se pudo crear la versión del agente:",
      error instanceof Error ? error.name : "UnknownError",
    );
    process.exitCode = 1;
  }
}
