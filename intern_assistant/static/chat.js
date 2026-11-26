const form = document.querySelector("form");
const question = document.querySelector("#question");
const messages = document.querySelector("#messages");
const suggestions = document.querySelector("#suggestions");
const status = document.querySelector("#status");
const submit = form.querySelector("button");
let topic = null;
let defaults = [];
let busy = false;

function showSuggestions(items) {
  suggestions.replaceChildren();
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item;
    button.addEventListener("click", () => ask(item));
    suggestions.append(button);
  }
}

function addMessage(text, kind, reply = {}) {
  const message = document.createElement("div");
  message.className = `message ${kind}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.append(paragraph);
  if (reply.source) {
    const link = document.createElement("a");
    link.className = "source";
    link.href = reply.source.url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = `${reply.source.title} · ${reply.source.section} (новая вкладка)`;
    message.append(link);
  }
  if (reply.draft) {
    const draft = document.createElement("blockquote");
    draft.textContent = reply.draft;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Скопировать черновик";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(reply.draft);
        copy.textContent = "Черновик скопирован";
        status.textContent = "Черновик скопирован";
      } catch {
        status.textContent = "Выдели текст черновика и скопируй его вручную.";
      }
    });
    message.append(draft, copy);
  }
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

async function ask(value) {
  const text = value.trim();
  if (busy || !text) return;
  busy = true;
  question.value = "";
  submit.disabled = true;
  for (const button of suggestions.children) button.disabled = true;
  status.textContent = "Ищу ответ в материалах…";
  question.focus({ preventScroll: true });
  addMessage(text, "question");
  try {
    const response = await fetch("api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, topic }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Request failed");
    const reply = await response.json();
    topic = reply.topic;
    const parts = reply.parts.length ? reply.parts : [reply];
    for (const part of parts) addMessage(part.answer, "reply", part);
    const nextSteps = [...new Set(parts.flatMap((part) => part.suggestions))];
    showSuggestions(nextSteps.length ? nextSteps : defaults);
    status.textContent = "";
  } catch {
    status.textContent = "Связь прервалась. Вопрос можно отправить ещё раз.";
    if (!question.value) question.value = text;
  } finally {
    busy = false;
    submit.disabled = false;
    for (const button of suggestions.children) button.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  ask(question.value);
});

try {
  const response = await fetch("api/topics", { signal: AbortSignal.timeout(5000) });
  if (response.ok) {
    defaults = await response.json();
    if (!busy && !messages.childElementCount) showSuggestions(defaults);
  }
} catch {
  // The composer remains available when suggestions fail to load.
}
