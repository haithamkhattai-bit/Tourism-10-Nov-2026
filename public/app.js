const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messagesElement = document.querySelector("#messages");
const welcomeElement = document.querySelector("#welcome");
const conversationElement = document.querySelector("#conversation");
const resetButton = document.querySelector("#reset-chat");

const history = [];

function addMessage(role, content, extraClass = "") {
  const message = document.createElement("div");
  message.className = `message ${role}${extraClass ? ` ${extraClass}` : ""}`;
  message.textContent = content;
  messagesElement.append(message);
  conversationElement.scrollTop = conversationElement.scrollHeight;
  return message;
}

function setBusy(busy) {
  sendButton.disabled = busy;
  input.disabled = busy;
  sendButton.setAttribute("aria-label", busy ? "Waiting for reply" : "Send message");
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || sendButton.disabled) return;

  welcomeElement.hidden = true;
  input.value = "";
  input.style.height = "auto";
  addMessage("user", content);
  history.push({ role: "user", content });

  const typing = document.createElement("div");
  typing.className = "typing";
  typing.textContent = "Your guide is thinking…";
  messagesElement.append(typing);
  setBusy(true);

  try {
    const response = await fetch("./api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-20) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");

    typing.remove();
    history.push({ role: "assistant", content: data.reply });
    addMessage("assistant", data.reply);
  } catch (error) {
    typing.remove();
    addMessage("assistant", error.message, "error");
  } finally {
    setBusy(false);
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

resetButton.addEventListener("click", () => {
  history.length = 0;
  messagesElement.replaceChildren();
  welcomeElement.hidden = false;
  input.value = "";
  input.focus();
});
