function collectClaudeMessages() {
  const nodes = document.querySelectorAll('[data-testid="conversation-turn"], .font-claude-message, article');
  const messages = [];
  nodes.forEach((node) => {
    const text = node.textContent?.trim();
    if (!text) return;
    const role = /you|user/i.test(node.getAttribute("data-testid") || "") ? "user" : "assistant";
    messages.push({ role, content: text });
  });
  return messages.slice(-40);
}

function publishSessionUpdate() {
  const messages = collectClaudeMessages();
  if (!messages.length) return;
  chrome.runtime.sendMessage({
    type: "AXOLTL_SESSION_UPDATE",
    payload: {
      provider: "claude",
      updatedAt: Date.now(),
      messageCount: messages.length,
      messages
    }
  });
}

const observer = new MutationObserver(() => publishSessionUpdate());
observer.observe(document.documentElement, { childList: true, subtree: true });
publishSessionUpdate();
