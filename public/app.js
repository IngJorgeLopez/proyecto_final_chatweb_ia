const STORAGE_KEY = "rio-claro-chat-history-v1";
const WELCOME_MESSAGE = "¡Hola! Soy el asistente de Río Claro. ¿En qué puedo ayudarte?";

const chatMessages = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const attachmentButton = document.querySelector("#attachment-button");
const attachmentDropzone = document.querySelector("#attachment-dropzone");
const attachmentInput = document.querySelector("#attachment-input");
const attachmentPreview = document.querySelector("#attachment-preview");
const attachmentName = document.querySelector("#attachment-name");
const attachmentStatus = document.querySelector("#attachment-status");
const removeAttachmentButton = document.querySelector("#remove-attachment-button");
const chatLoadingIndicator = document.querySelector("#chat-loading-indicator");
const chatStatusText = document.querySelector("#chat-status-text");
const newChatButton = document.querySelector("#new-chat-button");
const historyButton = document.querySelector("#history-button");
const chatHistory = document.querySelector("#chat-history");
const conversationList = document.querySelector("#conversation-list");
const storageStatus = document.querySelector("#storage-status");

function isValidMessage(message) {
  return (
    message &&
    typeof message.text === "string" &&
    ["user", "assistant", "error"].includes(message.role) &&
    (message.attachmentName === undefined ||
      typeof message.attachmentName === "string")
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
let attachedFile = null;

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

function createMessageElement(text, role, fileName = null) {
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
  if (text) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    content.append(paragraph);
  }
  if (fileName) {
    const attachment = document.createElement("span");
    attachment.className = "attachment-reference";
    attachment.textContent = `Archivo adjunto: ${fileName}`;
    content.append(attachment);
  }
  message.append(content);
  return message;
}

function renderMessages(messages = []) {
  chatMessages.replaceChildren();
  const visibleMessages = messages.length
    ? messages
    : [{ role: "assistant", text: WELCOME_MESSAGE }];

  for (const message of visibleMessages) {
    chatMessages.append(
      createMessageElement(message.text, message.role, message.attachmentName),
    );
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

function addMessage(text, role, fileName = null) {
  chatMessages.append(createMessageElement(text, role, fileName));
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });

  if (activeConversation) {
    const message = { role, text };
    if (fileName) {
      message.attachmentName = fileName;
    }
    activeConversation.messages.push(message);
    persistActiveConversation();
  }
}

function clearAttachment() {
  attachedFile = null;
  attachmentInput.value = "";
  attachmentName.textContent = "";
  attachmentPreview.hidden = true;
  attachmentStatus.textContent = "";
}

function attachFile(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  const allowedExtensions = ["docx", "xlsx", "jpg", "png"];

  if (!allowedExtensions.includes(extension)) {
    clearAttachment();
    attachmentStatus.textContent =
      "Formato no admitido. Selecciona DOCX, XLSX, JPG o PNG.";
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    clearAttachment();
    attachmentStatus.textContent = "El archivo no puede superar los 5 MB.";
    return;
  }

  attachedFile = file;
  attachmentName.textContent = file.name;
  attachmentPreview.hidden = false;
  attachmentStatus.textContent = "";
}

function openAttachmentPicker() {
  if (!chatInput.disabled) {
    attachmentInput.click();
  }
}

function startNewConversation() {
  activeConversation = null;
  conversationId = null;
  state.activeId = null;
  chatInput.value = "";
  clearAttachment();
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
  clearAttachment();
  renderMessages(conversation.messages);
  renderConversationList();
  saveState();
  chatHistory.hidden = true;
  historyButton.setAttribute("aria-expanded", "false");
  chatInput.focus();
}

function setPending(isPending) {
  sendButton.disabled = isPending || !chatInput.value.trim();
  chatInput.disabled = isPending;
  attachmentButton.disabled = isPending;
  attachmentDropzone.setAttribute("aria-disabled", String(isPending));
  attachmentDropzone.classList.toggle("is-disabled", isPending);
  removeAttachmentButton.disabled = isPending;
  newChatButton.disabled = isPending;
  historyButton.disabled = isPending;
  chatLoadingIndicator.hidden = !isPending;
  chatStatusText.textContent = isPending ? "Escribiendo…" : "";
}

newChatButton.addEventListener("click", startNewConversation);
chatInput.addEventListener("input", () => {
  sendButton.disabled = !chatInput.value.trim();
});
attachmentButton.addEventListener("click", openAttachmentPicker);
attachmentDropzone.addEventListener("click", openAttachmentPicker);
attachmentDropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openAttachmentPicker();
  }
});
attachmentInput.addEventListener("change", () => {
  const file = attachmentInput.files[0];
  if (!file) {
    return;
  }

  attachFile(file);
});
removeAttachmentButton.addEventListener("click", clearAttachment);

let dragDepth = 0;
attachmentDropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  if (chatInput.disabled) {
    return;
  }
  dragDepth += 1;
  attachmentDropzone.classList.add("is-dragging");
});
attachmentDropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = chatInput.disabled ? "none" : "copy";
  }
});
attachmentDropzone.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    attachmentDropzone.classList.remove("is-dragging");
  }
});
attachmentDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  attachmentDropzone.classList.remove("is-dragging");

  if (chatInput.disabled) {
    return;
  }

  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length > 1) {
    clearAttachment();
    attachmentStatus.textContent = "Adjunta un solo archivo por mensaje.";
    return;
  }
  if (files[0]) {
    attachFile(files[0]);
  }
});

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
  const file = attachedFile;

  if (!message || message.length > 2000) {
    return;
  }

  if (!activeConversation) {
    activeConversation = {
      id: crypto.randomUUID(),
      conversationId: null,
      title: message || file.name,
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    state.conversations.push(activeConversation);
  }

  addMessage(message, "user", file?.name ?? null);
  chatInput.value = "";
  clearAttachment();
  setPending(true);

  try {
    let requestBody;
    const headers = {};
    if (file) {
      requestBody = new FormData();
      requestBody.append("message", message);
      if (conversationId) {
        requestBody.append("conversation_id", conversationId);
      }
      requestBody.append("attachment", file);
    } else {
      headers["Content-Type"] = "application/json";
      requestBody = JSON.stringify({
        message,
        conversation_id: conversationId,
      });
    }

    const response = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: requestBody,
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
