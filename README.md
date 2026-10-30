# Chatbot Río Claro

Aplicación web en HTML, CSS y JavaScript vanilla. Express sirve la interfaz y es el único componente que se comunica con Microsoft Foundry.

## Requisitos

- Node.js 24 o posterior.
- Un proyecto de Microsoft Foundry, un agente con nombre configurado y un deployment de modelo.
- `DefaultAzureCredential` disponible localmente (por ejemplo, iniciar sesión con `az login`) o una identidad administrada con permisos en Azure.

## Configuración local

1. Instala dependencias con `npm install`.
2. Copia `.env.example` como `.env` y completa `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME` y los cinco nombres de agentes especialistas. Para crear una versión del orquestador con la herramienta de delegación, completa también `FOUNDRY_MODEL_DEPLOYMENT`.
3. Ejecuta `az login` y confirma que la identidad tenga los roles necesarios en el proyecto de Foundry.
4. Ejecuta `npm run create-agent` para crear una nueva versión del orquestador con la herramienta `delegate_to_specialist`. El script parte de la versión prompt más reciente para conservar sus instrucciones y herramientas; revisa la nueva versión en Foundry antes de usarla.
5. Inicia el sitio con `npm run dev` y abre `http://localhost:3000`.

El servidor requiere `FOUNDRY_PROJECT_ENDPOINT`, `FOUNDRY_AGENT_NAME` y estas variables para agentes del mismo proyecto Foundry:

- `FOUNDRY_SPECIALIST_INVOICES`
- `FOUNDRY_SPECIALIST_ACCOUNTS_PAYABLE`
- `FOUNDRY_SPECIALIST_INVENTORY`
- `FOUNDRY_SPECIALIST_CUSTOMER_SERVICE`
- `FOUNDRY_SPECIALIST_INTERNAL_POLICIES`

El script `npm run create-agent` requiere además `FOUNDRY_MODEL_DEPLOYMENT` y una versión existente del orquestador de tipo `prompt`; usa la configuración más reciente como base, conserva sus instrucciones y herramientas, y crea una nueva versión con la herramienta de delegación. La aplicación valida las claves de especialista mediante una lista permitida y limita el ciclo a tres rondas de delegación por mensaje. Si falla un especialista, el orquestador recibe un error controlado para responder con la información disponible, sin filtrar trazas al navegador.

En Azure, configura las variables como ajustes de la aplicación y usa la identidad administrada. `npm start` ejecuta `node server.js` y no carga `.env`.

## Endpoints y verificación

- `GET /health` devuelve `{"status":"ok"}`.
- `POST /api/chat` recibe `{"message":"...","conversation_id":null}` en el primer turno. Usa el `conversation_id` devuelto en los seguimientos para mantener el contexto del orquestador; los especialistas reciben tareas puntuales del backend.
- Los mensajes vacíos o de más de 2000 caracteres reciben `422`. Los fallos de Foundry reciben `502` con un mensaje genérico.
- Ejecuta `npm test` para probar salud, validación y continuidad de conversación sin llamar a Foundry.
- La interfaz guarda el historial y el identificador de conversación en `localStorage` del navegador. Se puede recuperar desde **Historial** o iniciar otro chat con **Nuevo**. Borrar los datos del sitio en el navegador también elimina este historial.
