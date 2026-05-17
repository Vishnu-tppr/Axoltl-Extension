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
          '[data-testid="assistant-message"]',
          '[data-message-author-role="assistant"]',
          '.markdown.prose',
        ],
        queries: [
          '[data-testid="user-message"]',
          '[data-message-author-role="user"]',
        ],
        getRoleFromNode: (n) => {
          const tid = n.getAttribute("data-testid");
          if (tid) return tid.includes("assistant") ? "assistant" : "user";
          const role = n.getAttribute("data-message-author-role");
          return role === "user" ? "user" : "assistant";
        },
      };
    }

    if (h.includes("claude.ai")) {
      return {
        responses: [
          '[data-testid*="assistant"]',
          '[data-testid*="chat-message"]',
          '[data-testid*="conversation-turn"]',
          'div.font-claude',
        ],
        queries: [
          '[data-testid*="user"]',
          'div.font-user',
        ],
        getRoleFromNode: (n) => {
          const tid = (n.getAttribute("data-testid") || "").toLowerCase();
          if (tid.includes("user") || tid.includes("human")) return "user";
          if (tid.includes("assistant") || tid.includes("claude")) return "assistant";
          const text = n.innerText || "";
          if (text.startsWith("Claude responded:")) return "assistant";
          if (text.startsWith("You said:")) return "user";
          return "assistant";
        },
      };
    }

    if (h.includes("gemini.google.com")) {
      return {
        responses: [
          "model-response",
          '[class*="model-response"]',
          '.shared-model-response-container'
        ],
        queries: [
          "user-query",
          '[class*="user-query"]',
          '.shared-user-query-container'
        ],
        getRoleFromNode: (n) => {
          const text = n.innerText || "";
          return (n.tagName === "USER-QUERY" || text.includes("You said")) ? "user" : "assistant";
        },
      };
    }

    if (h.includes("perplexity.ai")) {
      return {
        responses: [
          'div.prose.dark\\:prose-invert',
          '[class*="AnswerText"]',
          '.prose',
        ],
        queries: [
          'div.font-medium.text-textMain',
          '[class*="QueryText"]',
        ],
        getRoleFromNode: (n) => {
          const cls = (n.className || "").toLowerCase();
          return (cls.includes("textmain") || cls.includes("query")) ? "user" : "assistant";
        },
      };
    }

    return null;
  }

  let lastTurnHash = "";
  let observationTarget = null;

  function setupResponseObserver() {
    console.log("[Axoltl AutoIngest] Setting up continuous observation...");
    
    // Watch for the main content container
    const observer = new MutationObserver(() => {
      if (!window.axoltlMemoryEnabled || !window.AxoltlMemory) return;
      
      const config = getResponseSelectors();
      if (!config) return;

      // Find the message container (chatgpt specific)
      const container = document.querySelector('main [class*="react-scroll"]') || 
                        document.querySelector('main [class*="whitespace-pre-wrap"]')?.parentElement ||
                        document.body;

      // Find response nodes
      let responseNodes = [];
      for (const sel of config.responses) {
        responseNodes = document.querySelectorAll(sel);
        if (responseNodes.length > 0) break;
      }

      if (responseNodes.length === 0) return;

      const latestNode = responseNodes[responseNodes.length - 1];
      
      // STREAMING DETECTION:
      // Don't ingest if the AI is still typing/generating
      const isGenerating = document.querySelector('button[aria-label*="Stop"], button[aria-label*="Interrupt"], [class*="stop-button"], .result-streaming, .typing, [class*="is-generating"], .loading-dots, [aria-label="Stop generating"]');
      if (isGenerating) return;

      const responseText = latestNode.innerText?.trim();
      if (!responseText || responseText.length < MIN_RESPONSE_LENGTH) return;

      // Find corresponding user query
      let queryText = "";
      for (const sel of config.queries) {
        const queryNodes = document.querySelectorAll(sel);
        if (queryNodes.length > 0) {
          queryText = queryNodes[queryNodes.length - 1].innerText?.trim() || "";
          break;
        }
      }

      // Turn Hash for deduplication in current session
      const turnHash = `${queryText.slice(0, 50)}|${responseText.slice(0, 50)}`;
      if (turnHash === lastTurnHash) return;

      // Rate limit safety
      if (Date.now() - lastIngestTime < 2000) return; // 2s safety buffer

      lastTurnHash = turnHash;
      lastIngestTime = Date.now();

      console.log("[Axoltl AutoIngest] Turn completed. Ingesting...");
      
      window.AxoltlMemory.ingest(queryText, responseText, {
        source: "auto",
        url: window.location.href,
        effortLevel: "high"
      })
      .then((result) => {
        if (result) {
          showToast("Conversation turn remembered ⚡");
        }
      })
      .catch((e) => console.error("[Axoltl AutoIngest] Error:", e));
    });

    observer.observe(document.body, { childList: true, subtree: true });
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
  
  let currentUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== currentUrl) {
      console.log("[Axoltl AutoIngest] URL changed, resetting turn state.");
      currentUrl = window.location.href;
      lastTurnHash = "";
      lastNodeCount = 0;
    }
  }, 1000);

  setupHighlightToRemember();
  setupResponseObserver();
})();
