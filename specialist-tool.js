export const SPECIALIST_TOOL_NAME = "delegate_to_specialist";

export const SPECIALIST_AGENT_ENV = Object.freeze({
  invoices: "FOUNDRY_SPECIALIST_INVOICES",
  accounts_payable: "FOUNDRY_SPECIALIST_ACCOUNTS_PAYABLE",
  inventory: "FOUNDRY_SPECIALIST_INVENTORY",
  customer_service: "FOUNDRY_SPECIALIST_CUSTOMER_SERVICE",
  internal_policies: "FOUNDRY_SPECIALIST_INTERNAL_POLICIES",
});

export const SPECIALIST_TOOL = {
  type: "function",
  name: SPECIALIST_TOOL_NAME,
  description:
    "Delega una tarea concreta al agente especialista apropiado y usa su resultado para responder.",
  strict: true,
  parameters: {
    type: "object",
    properties: {
      specialist: {
        type: "string",
        enum: Object.keys(SPECIALIST_AGENT_ENV),
        description: "Clave del agente especialista que debe atender la tarea.",
      },
      task: {
        type: "string",
        minLength: 1,
        maxLength: 2000,
        description: "Instrucción concreta y suficiente para el agente especialista.",
      },
    },
    required: ["specialist", "task"],
    additionalProperties: false,
  },
};

export const SPECIALIST_INSTRUCTIONS =
  "Cuando una consulta requiera conocimiento especializado, usa delegate_to_specialist " +
  "con una tarea concreta. Claves: invoices (facturas), accounts_payable (cuentas por pagar), " +
  "inventory (productos e inventario), customer_service (atención a clientes) e " +
  "internal_policies (políticas internas). No afirmes que delegaste si no llamaste la herramienta. " +
  "Si la herramienta informa un error, no inventes resultados: ofrece una respuesta alternativa " +
  "solo con la información disponible e indica brevemente que el especialista no estuvo disponible.";
