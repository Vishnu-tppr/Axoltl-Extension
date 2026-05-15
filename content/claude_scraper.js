/**
 * Axoltl — Claude.ai Conversation Scraper
 *
 * Captures conversation messages from claude.ai using multiple
 * fallback selector strategies. Messages are sent to the service
 * worker as structured session updates.
 *
 * Selector strategy (most → least specific):
 *   1. [data-testid] conversation turn attributes
 *   2. Known semantic class patterns (.font-claude-message, etc.)
 *   3. Accessibility-based: role="presentation" / role="group" message wrappers
 *   4. Generic fallback: structural heuristics (alternating child blocks)
 */

(function axoltlClaudeScraper() {
  "use strict";

  const PROVIDER = "claude";
  const MAX_MESSAGES = 50;
  const DEBOUNCE_MS = 800;

  let debounceTimer = null;
  let lastPayloadHash = "";

  // ── Selector strategies (tried in order) ─────────────────

  function strategyDataTestId() {
    const turns = document.querySelectorAll(
      '[data-testid*="conversation-turn"], [data-testid*="chat-message"], [data-testid*="message"]'
    );
    if (!turns.length) return null;

    const messages = [];
    turns.forEach((node) => {
      const text = node.innerText?.trim();
      if (!text || text.length < 2) return;
      const testId = node.getAttribute("data-testid") || "";
      const role = /user|human/i.test(testId) ? "user" : "assistant";
      messages.push({ role, content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  function strategySemanticClasses() {
    // Claude uses known class patterns for user/assistant blocks
    const userBlocks = document.querySelectorAll(
      '.font-user-message, [class*="UserMessage"], [class*="human-turn"]'
    );
    const assistantBlocks = document.querySelectorAll(
      '.font-claude-message, [class*="AssistantMessage"], [class*="assistant-turn"], [class*="claude-message"]'
    );
    if (!userBlocks.length && !assistantBlocks.length) return null;

    const messages = [];
    userBlocks.forEach((node) => {
      const text = node.innerText?.trim();
      if (text && text.length >= 2) messages.push({ role: "user", content: text });
    });
    assistantBlocks.forEach((node) => {
      const text = node.innerText?.trim();
      if (text && text.length >= 2) messages.push({ role: "assistant", content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  function strategyAriaRoles() {
    // Look for role="presentation" groups that contain conversation structure
    const groups = document.querySelectorAll(
      '[role="presentation"] > div, [role="group"] > div, main [role="region"] > div'
    );
    if (groups.length < 2) return null;

    const messages = [];
    let prevRole = "assistant";
    groups.forEach((node) => {
      const text = node.innerText?.trim();
      if (!text || text.length < 5) return;
      // Heuristic: user messages are typically shorter and don't contain code blocks
      const likelyUser = text.length < 500 && !text.includes("```") && prevRole === "assistant";
      const role = likelyUser ? "user" : "assistant";
      prevRole = role;
      messages.push({ role, content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  function strategyStructuralFallback() {
    // Last resort: find the main conversation container and extract alternating blocks
    const mainContent = document.querySelector(
      'main, [role="main"], .conversation-container, #conversation-container'
    );
    if (!mainContent) return null;

    // Look for direct children that look like message blocks
    const children = Array.from(mainContent.children).filter((el) => {
      const text = el.innerText?.trim();
      return text && text.length > 5 && el.offsetHeight > 20;
    });
    if (children.length < 2) return null;

    const messages = [];
    children.forEach((node, index) => {
      const text = node.innerText?.trim();
      if (!text) return;
      // Alternate: even = user, odd = assistant (common pattern)
      const role = index % 2 === 0 ? "user" : "assistant";
      messages.push({ role, content: text });
    });
    return messages.length >= 2 ? messages : null;
  }

  // ── Core collection ──────────────────────────────────────

  function collectMessages() {
    const strategies = [
      strategyDataTestId,
      strategySemanticClasses,
      strategyAriaRoles,
      strategyStructuralFallback,
    ];

    for (const strategy of strategies) {
      try {
        const result = strategy();
        if (result && result.length >= 2) {
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

    // Deduplicate: don't re-send identical payloads
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

  // Initial capture after page settles
  setTimeout(publishSessionUpdate, 2000);
})();
