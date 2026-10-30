const STORAGE_KEY = "rio-claro-chat-history-v1";
const WELCOME_MESSAGE = "¡Hola! Soy el asistente de Río Claro. ¿En qué puedo ayudarte?";

const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const chatStatus = document.querySelector("#chat-status");
const newChatButton = document.querySelector("#new-chat-button");
const historyButton = document.querySelector("#history-button");
const chatHistory = document.querySelector("#chat-history");
const conversationList = document.querySelector("#conversation-list");
const storageStatus = document.querySelector("#storage-status");

function isValidMessage(message) {
  return (
    message &&
    typeof message.text === "string" &&
    ["user", "assistant", "error"].includes(message.role)
  );
}

function isValidConversation(conversation) {
  return (
    conversation &&
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    typeof conversation.updatedAt === "string" &&
    Number.isFinite(Date.parse(conversation.updatedAt)) &&
    (conversation.conversationId === null ||
      typeof conversation.conversationId === "string") &&
    Array.isArray(conversation.messages) &&
    conversation.messages.length > 0 &&
    conversation.messages.every(isValidMessage) &&
    conversation.messages.some((message) => message.role === "user")
  );
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { conversations: [], activeId: null };
    }

    const parsed = JSON.parse(stored);
    const conversations = Array.isArray(parsed.conversations)
      ? parsed.conversations.filter(isValidConversation)
      : [];
    const activeId = conversations.some(
      (conversation) => conversation.id === parsed.activeId,
    )
      ? parsed.activeId
      : null;

    return { conversations, activeId };
  } catch (error) {
    console.error("No se pudo cargar el historial local:", error);
    storageStatus.textContent =
      "No se pudo leer el historial guardado en este navegador.";
    return { conversations: [], activeId: null };
  }
}

const state = loadState();
let activeConversation =
  state.conversations.find((conversation) => conversation.id === state.activeId) ??
  null;
let conversationId = activeConversation?.conversationId ?? null;

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        conversations: state.conversations,
        activeId: state.activeId,
      }),
    );
    storageStatus.textContent = "";
    return true;
  } catch (error) {
    console.error("No se pudo guardar el historial local:", error);
    storageStatus.textContent =
      "No se pudo guardar el historial. Revisa el espacio disponible del navegador.";
    return false;
  }
}

function createMessageElement(text, role) {
  const message = document.createElement("article");
  message.className = `message message-${role}`;

  if (role === "assistant") {
    const avatar = document.createElement("img");
    avatar.className = "message-avatar";
    avatar.src = "/assistant-avatar.png";
    avatar.alt = "";
    avatar.setAttribute("aria-hidden", "true");
    message.append(avatar);
  }

  const content = document.createElement("div");
  content.className = "message-content";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  content.append(paragraph);
  message.append(content);
  return message;
}

function renderMessages(messages = []) {
  chatMessages.replaceChildren();
  const visibleMessages = messages.length
    ? messages
    : [{ role: "assistant", text: WELCOME_MESSAGE }];

  for (const message of visibleMessages) {
    chatMessages.append(createMessageElement(message.text, message.role));
  }

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderConversationList() {
  conversationList.replaceChildren();
  const conversations = [...state.conversations].sort(
    (first, second) =>
      new Date(second.updatedAt).getTime() -
      new Date(first.updatedAt).getTime(),
  );

  if (conversations.length === 0) {
    const emptyState = document.createElement("p");
    emptyState.className = "history-empty";
    emptyState.textContent = "Tus conversaciones aparecerán aquí.";
    conversationList.append(emptyState);
    return;
  }

  for (const conversation of conversations) {
    const button = document.createElement("button");
    button.className = "conversation-item";
    button.type = "button";
    button.dataset.conversationId = conversation.id;
    button.setAttribute(
      "aria-current",
      conversation.id === activeConversation?.id ? "true" : "false",
    );

    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;

    const date = document.createElement("span");
    date.className = "conversation-date";
    date.textContent = new Date(conversation.updatedAt).toLocaleString(
      "es-MX",
      { dateStyle: "short", timeStyle: "short" },
    );

    button.append(title, date);
    conversationList.append(button);
  }
}

function persistActiveConversation() {
  if (!activeConversation) {
    return;
  }

  activeConversation.updatedAt = new Date().toISOString();
  state.activeId = activeConversation.id;
  saveState();
  renderConversationList();
}

function addMessage(text, role) {
  chatMessages.append(createMessageElement(text, role));
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });

  if (activeConversation) {
    activeConversation.messages.push({ role, text });
    persistActiveConversation();
  }
}

function startNewConversation() {
  activeConversation = null;
  conversationId = null;
  state.activeId = null;
  chatInput.value = "";
  renderMessages();
  renderConversationList();
  saveState();
  chatHistory.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
  chatInput.focus();
}

function openConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) {
    return;
  }

  activeConversation = conversation;
  conversationId = conversation.conversationId;
  state.activeId = conversation.id;
  chatInput.value = "";
  renderMessages(conversation.messages);
  renderConversationList();
  saveState();
  chatHistory.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
  chatInput.focus();
}

function setPending(isPending) {
  sendButton.disabled = isPending;
  chatInput.disabled = isPending;
  newChatButton.disabled = isPending;
  historyButton.disabled = isPending;
  chatStatus.textContent = isPending ? "Escribiendo…" : "";
}

newChatButton.addEventListener("click", startNewConversation);

historyButton.addEventListener("click", () => {
  chatHistory.hidden = !chatHistory.hidden;
  historyButton.setAttribute("aria-expanded", String(!chatHistory.hidden));
  if (!chatHistory.hidden) {
    renderConversationList();
  }
});

conversationList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-conversation-id]");
  if (button) {
    openConversation(button.dataset.conversationId);
  }
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();

  if (!message || message.length > 2000) {
    return;
  }

  if (!activeConversation) {
    activeConversation = {
      id: crypto.randomUUID(),
      conversationId: null,
      title: message,
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    state.conversations.push(activeConversation);
  }

  addMessage(message, "user");
  chatInput.value = "";
  setPending(true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        conversation_id: conversationId,
      }),
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "No se pudo enviar el mensaje.");
    }

    if (
      typeof result.reply !== "string" ||
      typeof result.conversation_id !== "string"
    ) {
      throw new Error("El servidor devolvió una respuesta inválida.");
    }

    conversationId = result.conversation_id;
    activeConversation.conversationId = conversationId;
    addMessage(result.reply, "assistant");
  } catch (error) {
    addMessage(
      error instanceof Error
        ? error.message
        : "No se pudo conectar con el asistente. Inténtalo de nuevo.",
      "error",
    );
  } finally {
    setPending(false);
    chatInput.focus();
  }
});

chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

renderMessages(activeConversation?.messages ?? []);
renderConversationList();
