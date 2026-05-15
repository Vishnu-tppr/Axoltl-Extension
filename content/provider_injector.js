/**
 * Axoltl — Provider Injector
 *
 * Injects compressed context into AI provider input fields via DOM
 * manipulation. Replaces the broken ?q= URL parameter approach.
 *
 * Injection strategy:
 *   1. Find the provider's input element (textarea, contenteditable, ProseMirror)
 *   2. Focus the element
 *   3. Use execCommand('insertText') for framework compatibility
 *   4. Fallback to direct value/innerText setting with input event dispatch
 *   5. Show a visual toast confirming injection
 */

const AxoltlInjector = {
  // Provider-specific input selectors (ordered by reliability)
  INPUT_SELECTORS: {
    claude: [
      "div.ProseMirror[contenteditable='true']",
      "[contenteditable='true'][data-placeholder]",
      "fieldset [contenteditable='true']",
      "textarea",
    ],
    chatgpt: [
      "#prompt-textarea",
      "[id='prompt-textarea']",
      "textarea[data-id='root']",
      "div[contenteditable='true'][data-placeholder]",
      "textarea",
    ],
    gemini: [
      "rich-textarea [contenteditable='true']",
      "rich-textarea > div[contenteditable]",
      "[contenteditable='true'][aria-label*='prompt']",
      "textarea",
    ],
    perplexity: [
      "textarea[placeholder*='Ask']",
      "textarea[placeholder*='ask']",
      "[contenteditable='true']",
      "textarea",
    ],
  },

  /**
   * Inject text into the active provider's input field.
   * Called via chrome.scripting.executeScript from the service worker.
   *
   * @param {string} text - The compressed context to inject
   * @param {string} provider - The target provider name
   * @returns {boolean} Whether injection succeeded
   */
  inject(text, provider) {
    const selectors = this.INPUT_SELECTORS[provider] || ["textarea", "[contenteditable='true']"];
    let input = null;

    // Try each selector until we find a visible, editable element
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetHeight > 0 && !el.disabled) {
        input = el;
        break;
      }
    }

    if (!input) {
      this._showToast("⚠ Could not find input field. Paste manually (Ctrl+V).", "warning");
      // Copy to clipboard as fallback
      this._copyToClipboard(text);
      return false;
    }

    // Focus the element
    input.focus();

    let injected = false;

    // Strategy 1: execCommand('insertText') — works with most frameworks
    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      try {
        injected = document.execCommand("insertText", false, text);
      } catch (e) {
        injected = false;
      }
    }

    // Strategy 2: Direct DOM manipulation with event dispatch
    if (!injected) {
      try {
        if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
          input.value = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          // contenteditable div
          input.textContent = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        injected = true;
      } catch (e) {
        injected = false;
      }
    }

    // Strategy 3: Clipboard fallback
    if (!injected) {
      this._copyToClipboard(text);
      this._showToast("📋 Context copied to clipboard. Press Ctrl+V to paste.", "info");
      return false;
    }

    this._showToast("🦎 Context injected! Press Enter to continue.", "success");
    return true;
  },

  /**
   * Wait for the page to load, find the input, then inject.
   * Used when opening a new tab — the DOM may not be ready immediately.
   */
  injectWithRetry(text, provider, maxRetries = 10) {
    let attempts = 0;

    const tryInject = () => {
      attempts++;
      const result = this.inject(text, provider);
      if (!result && attempts < maxRetries) {
        setTimeout(tryInject, 1000);
      }
    };

    // Wait for initial page load
    if (document.readyState === "complete") {
      setTimeout(tryInject, 1500);
    } else {
      window.addEventListener("load", () => setTimeout(tryInject, 2000));
    }
  },

  // ── Internal helpers ───────────────────────────────────

  _copyToClipboard(text) {
    try {
      navigator.clipboard.writeText(text).catch(() => {
        // Fallback: create a temporary textarea
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      });
    } catch (e) {
      // Silently fail — user can't paste if clipboard also fails
    }
  },

  _showToast(msg, type) {
    // Remove any existing Axoltl toast
    const existing = document.getElementById("axoltl-inject-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "axoltl-inject-toast";

    const colors = {
      success: { bg: "#065f46", border: "#10b981", text: "#ecfdf5" },
      warning: { bg: "#78350f", border: "#f59e0b", text: "#fffbeb" },
      info: { bg: "#1e3a5f", border: "#3b82f6", text: "#eff6ff" },
    };
    const c = colors[type] || colors.info;

    toast.textContent = msg;
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 99999;
      background: ${c.bg}; color: ${c.text}; border: 1px solid ${c.border};
      padding: 12px 20px; border-radius: 10px; font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      animation: axoltl-toast-in 0.3s ease-out;
      max-width: 400px;
    `;

    // Add animation keyframes
    if (!document.getElementById("axoltl-toast-style")) {
      const style = document.createElement("style");
      style.id = "axoltl-toast-style";
      style.textContent = `
        @keyframes axoltl-toast-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  },
};

if (typeof window !== "undefined") {
  window.AxoltlInjector = AxoltlInjector;
}
