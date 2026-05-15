/**
 * Axoltl Memory Auto-Ingest & Highlight-to-Remember
 *
 * Automatically saves conversation turns to local memory.
 * Also provides a "⚡ Remember" button when text is highlighted.
 *
 * Rate-limited: max 1 ingest per 30 seconds.
 * Dedup: content hash prevents saving the same exchange twice.
 */

(function axoltlMemoryAutoIngest() {
  "use strict";

  const INGEST_COOLDOWN_MS = 30000; // 30 seconds
  const MIN_RESPONSE_LENGTH = 50;

  let lastIngestTime = 0;
  let lastNodeCount = 0;
  let highlightBtn = null;

  // ── Highlight-to-Remember ─────────────────────────────────

  function setupHighlightToRemember() {
    document.addEventListener("mouseup", () => {
      if (!window.axoltlMemoryEnabled) return;

      const selection = window.getSelection();
      const text = selection?.toString()?.trim();
      if (text && text.length > 20) {
        showHighlightButton(selection, text);
      } else {
        hideHighlightButton();
      }
    });

    document.addEventListener("mousedown", (e) => {
      if (highlightBtn && !highlightBtn.contains(e.target)) {
        hideHighlightButton();
      }
    });
  }

  function showHighlightButton(selection, text) {
    if (!highlightBtn) {
      highlightBtn = document.createElement("div");
      highlightBtn.id = "axoltl-remember-btn";
      highlightBtn.style.cssText = `
        position: absolute;
        background: linear-gradient(135deg, #10b981, #059669);
        color: #000;
        padding: 5px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 3px 10px rgba(0,0,0,0.4);
        z-index: 2147483647;
        display: none;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        transition: transform 0.1s ease;
        user-select: none;
      `;
      highlightBtn.textContent = "⚡ Remember";
      document.body.appendChild(highlightBtn);
    }

    // Rebind click handler with current text
    highlightBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      ingestHighlight(text);
    };

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    highlightBtn.style.top = `${rect.top + window.scrollY - 34}px`;
    highlightBtn.style.left = `${rect.left + window.scrollX + rect.width / 2 - 50}px`;
    highlightBtn.style.display = "block";
  }

  function hideHighlightButton() {
    if (highlightBtn) highlightBtn.style.display = "none";
  }

  async function ingestHighlight(text) {
    hideHighlightButton();
    if (!text?.trim()) return;
    if (!window.AxoltlMemory) {
      showToast("Memory engine not ready");
      return;
    }

    try {
      showToast("Saving to memory...");
      await window.AxoltlMemory.ingest(text, "", {
        source: "highlight",
        url: window.location.href,
      });
      showToast("Memory saved! ⚡");
    } catch (e) {
      showToast("Failed to save memory");
      console.error("[Axoltl AutoIngest] Highlight ingest failed:", e);
    }
  }

  // ── Auto-Ingest on AI Response ────────────────────────────

  function getResponseSelectors() {
    const h = window.location.hostname;

    if (h.includes("chatgpt.com") || h.includes("chat.openai.com")) {
      return {
        responses: [
          '[data-message-author-role="assistant"]',
          '[data-message-id]',
        ],
        queries: [
          '[data-message-author-role="user"]',
        ],
        getRoleFromNode: (n) => {
          const role = n.getAttribute("data-message-author-role");
          return role === "user" ? "user" : "assistant";
        },
      };
    }

    if (h.includes("claude.ai")) {
      return {
        responses: [
          '[data-testid*="chat-message"]',
          '[data-testid*="conversation-turn"]',
          '[class*="AssistantMessage"]',
        ],
        queries: [
          '[data-testid*="user"]',
          '[class*="UserMessage"]',
        ],
        getRoleFromNode: (n) => {
          const tid = (n.getAttribute("data-testid") || "").toLowerCase();
          const cls = (n.className || "").toLowerCase();
          return /user|human/.test(tid + cls) ? "user" : "assistant";
        },
      };
    }

    if (h.includes("gemini.google.com")) {
      return {
        responses: [
          "model-response",
          '[class*="model-response"]',
          ".shared-model-response-container"
        ],
        queries: [
          "user-query",
          '[class*="user-query"]',
          ".shared-user-query-container"
        ],
        getRoleFromNode: (n) => {
          const tag = n.tagName?.toLowerCase();
          const cls = (n.className || "").toLowerCase();
          return tag === "user-query" || cls.includes("user-query") ? "user" : "assistant";
        },
      };
    }

    if (h.includes("perplexity.ai")) {
      return {
        responses: [
          '[class*="AnswerText"]',
          '[class*="answer-text"]',
          ".prose",
        ],
        queries: [
          '[class*="QueryText"]',
          '[class*="query-text"]',
        ],
        getRoleFromNode: (n) => {
          const cls = (n.className || "").toLowerCase();
          return /query|user/.test(cls) ? "user" : "assistant";
        },
      };
    }

    return null;
  }

  function setupResponseObserver() {
    setInterval(() => {
      if (!window.axoltlMemoryEnabled) return;
      if (!window.AxoltlMemory) return;

      // Rate limit
      if (Date.now() - lastIngestTime < INGEST_COOLDOWN_MS) return;

      const config = getResponseSelectors();
      if (!config) return;

      // Find response nodes
      let responseNodes = [];
      for (const sel of config.responses) {
        responseNodes = document.querySelectorAll(sel);
        if (responseNodes.length > 0) break;
      }

      // Check if new responses appeared
      if (responseNodes.length <= lastNodeCount) return;

      const latestNode = responseNodes[responseNodes.length - 1];
      const responseText = latestNode.innerText?.trim();
      if (!responseText || responseText.length < MIN_RESPONSE_LENGTH) return;

      // Find the corresponding user query
      let queryText = "";
      for (const sel of config.queries) {
        const queryNodes = document.querySelectorAll(sel);
        if (queryNodes.length > 0) {
          queryText = queryNodes[queryNodes.length - 1].innerText?.trim() || "";
          break;
        }
      }

      // Update count and ingest
      lastNodeCount = responseNodes.length;
      lastIngestTime = Date.now();

      window.AxoltlMemory.ingest(queryText, responseText, {
        source: "auto",
        url: window.location.href,
      })
        .then((result) => {
          if (result) {
            console.log("[Axoltl AutoIngest] Saved:", queryText.slice(0, 50));
          }
        })
        .catch((e) => {
          console.error("[Axoltl AutoIngest] Failed:", e);
        });
    }, 5000);
  }

  // ── Toast ─────────────────────────────────────────────────

  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
      background: #18181b; color: #10b981;
      padding: 8px 16px; border-radius: 8px;
      border: 1px solid #27272a;
      font-family: -apple-system, sans-serif; font-size: 13px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      opacity: 0; transition: opacity 0.2s ease;
    `;
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = "1"; });
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 200);
    }, 2500);
  }

  // ── Init ──────────────────────────────────────────────────

  setupHighlightToRemember();
  setupResponseObserver();
})();
