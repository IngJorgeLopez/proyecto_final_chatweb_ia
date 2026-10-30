# Instrucciones del proyecto: Chatbot Foundry Certificador en App Service

## Qué es este proyecto
Página web que permite a los usuarios generar certificados de participación en un curso de manera automática. El proyecto está desarrollado en HTML, CSS y JS llama a un backend en nodejs con express el cual conversa con un agenete  de Microsoft Foundry. Se despliega en un App Service de Azure (Linux, Node 24 LTS).

## Entorno de desarrollo
- Windows 11 con powerShell 7.3.6
- Node.js 24 LTS y npm 9.8.1, nada de typescript ni frameworks de frontend, solo HTML, CSS y JS vanilla.

## Stack y versiones
- Express 5, ES Modules (`"type": "module"`), `async/await`.
- SDK de Foundry: `@azure/ai-projects` 2.x (API "Foundry projects (new)").
 No uses `@azure/ai-agents` ni la API 1.x.
- Autenticación: `DefaultAzureCredential` de `@azure/identity`.
- Variables de entorno en local con `node --env-file-if-exists=.env` (sin dotenv).
 
## Arquitectura (no la cambies sin preguntar)
- `server.js`: sirve `public/` en `/`, expone `POST /api/chat` y `GET /health`.
- El navegador NUNCA habla directo con Foundry. Solo el backend.
- Conversación multi-turno: `openai.conversations.create()` y
 `openai.responses.create({ conversation, input }, agentRef)`, donde
 `agentRef = { body: { agent_reference: { name, type: "agent_reference" } } }`.
 El `conversation_id` viaja entre frontend y backend en el JSON.
- El servidor escucha en `process.env.PORT` (App Service lo define).
 
## Seguridad
- Nunca escribas llaves, tokens ni endpoints reales en el código.
 Todo sale de variables de entorno: `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME`.
- En Azure se usa identidad administrada (managed identity), no API keys.
- Valida la entrada (1 a 2000 caracteres) y responde 422 si no cumple.
- Si Foundry falla, responde 502 con un mensaje genérico; no filtres trazas.
## Estilo de código
- Comentarios en español neutro; nombres de variables en inglés.
- Cambios mínimos y enfocados: no reescribas archivos completos si basta editar.
## Cómo validar
- Local: `npm run dev` y abrir http://localhost:3000
- Salud: `Invoke-RestMethod http://localhost:3000/health` debe devolver `status: ok`
- Antes de desplegar, confirma que `package.json` incluye todo lo que se importa
 y que el script `start` es `node server.js`.