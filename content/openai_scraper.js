/**
 * Axoltl — ChatGPT (chatgpt.com) Conversation Scraper
 *
 * Captures conversation messages from chatgpt.com using the stable
 * data-message-id and data-message-author-role attributes. Falls back
 * to structural heuristics if those attributes change.
 *
 * Selector strategy (most → least specific):
 *   1. [data-message-id] with [data-message-author-role]
 *   2. article elements with role markers
 *   3. .markdown containers within message wrappers
 *   4. Structural fallback (alternating blocks in main)
 */

(function axoltlOpenAIScraper() {
  "use strict";

  const PROVIDER = "chatgpt";
  const MAX_MESSAGES = 50;
  const DEBOUNCE_MS = 800;

  let debounceTimer = null;
  let lastPayloadHash = "";

  // ── Selector strategies ──────────────────────────────────

  function strategyDataMessageId() {
    const turns = document.querySelectorAll("[data-message-id]");
    if (!turns.length) return null;

    const messages = [];
    turns.forEach((node) => {
      const role = node.getAttribute("data-message-author-role");
      if (!role) return; // skip system/tool messages without role

      const normalizedRole = role === "user" ? "user" : "assistant";

      // Prefer the markdown-rendered content within the message
      const markdownEl = node.querySelector(".markdown, .prose, [class*='markdown']");
      const text = (markdownEl || node).innerText?.trim();
      if (!text || text.length < 2) return;

      messages.push({ role: normalizedRole, content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  function strategyArticleElements() {
    const articles = document.querySelectorAll("article, [data-testid*='conversation-turn']");
    if (articles.length < 2) return null;

    const messages = [];
    articles.forEach((node) => {
      const text = node.innerText?.trim();
      if (!text || text.length < 2) return;

      // Detect user vs assistant by checking for common markers
      const hasAvatar = node.querySelector("img[alt*='User'], img[alt*='You']");
      const testId = node.getAttribute("data-testid") || "";
      const role = hasAvatar || /user/i.test(testId) ? "user" : "assistant";
      messages.push({ role, content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  function strategyMarkdownBlocks() {
    // ChatGPT wraps AI responses in .markdown or .prose containers
    const markdownBlocks = document.querySelectorAll(
      "main .markdown, main .prose, main [class*='whitespace-pre-wrap']"
    );
    if (!markdownBlocks.length) return null;

    const messages = [];
    markdownBlocks.forEach((node) => {
      const text = node.innerText?.trim();
      if (!text || text.length < 5) return;

      // Walk up to find the message wrapper and check for user/assistant class
      const wrapper = node.closest("[data-message-author-role]") ||
                      node.closest("[data-message-id]") ||
                      node.parentElement;
      const roleAttr = wrapper?.getAttribute("data-message-author-role") || "";
      const role = roleAttr === "user" ? "user" : "assistant";
      messages.push({ role, content: text });
    });
    return messages.length >= 1 ? messages : null;
  }

  function strategyStructuralFallback() {
    const main = document.querySelector("main, [role='main']");
    if (!main) return null;

    // Find the scrollable conversation container
    const container = main.querySelector("[class*='react-scroll']") || main;
    const children = Array.from(container.children).filter((el) => {
      const text = el.innerText?.trim();
      return text && text.length > 5 && el.offsetHeight > 20;
    });
    if (children.length < 2) return null;

    const messages = [];
    children.forEach((node, index) => {
      const text = node.innerText?.trim();
      if (!text) return;
      const role = index % 2 === 0 ? "user" : "assistant";
      messages.push({ role, content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  // ── Core collection ──────────────────────────────────────

  function collectMessages() {
    const strategies = [
      strategyDataMessageId,
      strategyArticleElements,
      strategyMarkdownBlocks,
      strategyStructuralFallback,
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        if (result && result.length >= 1) {
          return result.slice(-MAX_MESSAGES);
        }
      } catch (e) {
        // Strategy failed, try next
      }
    }
    return [];
  }

  // ── Publish to background ────────────────────────────────

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return String(hash);
  }

  function publishSessionUpdate() {
    const messages = collectMessages();
    if (!messages.length) return;

    const payloadHash = simpleHash(JSON.stringify(messages));
    if (payloadHash === lastPayloadHash) return;
    lastPayloadHash = payloadHash;

    chrome.runtime.sendMessage({
      type: "AXOLTL_SESSION_UPDATE",
      payload: {
        provider: PROVIDER,
        updatedAt: Date.now(),
        messageCount: messages.length,
        messages,
      },
    });
  }

  // ── Debounced observer ───────────────────────────────────

  function onDomChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(publishSessionUpdate, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(onDomChange);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  setTimeout(publishSessionUpdate, 2000);
})();
