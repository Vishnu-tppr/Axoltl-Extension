function collectOpenAIMessages() {
  const nodes = document.querySelectorAll('[data-message-author-role], article[data-testid]');
  const messages = [];
  nodes.forEach((node) => {
    const text = node.textContent?.trim();
    if (!text) return;
    const roleAttr = node.getAttribute("data-message-author-role") || "assistant";
    const role = roleAttr === "user" ? "user" : "assistant";
    messages.push({ role, content: text });
  });
  return messages.slice(-40);
}

function publishSessionUpdate() {
  const messages = collectOpenAIMessages();
  if (!messages.length) return;
  chrome.runtime.sendMessage({
    type: "AXOLTL_SESSION_UPDATE",
    payload: {
      provider: "openai",
      updatedAt: Date.now(),
      messageCount: messages.length,
      messages
    }
  });
}

const observer = new MutationObserver(() => publishSessionUpdate());
observer.observe(document.documentElement, { childList: true, subtree: true });
publishSessionUpdate();
