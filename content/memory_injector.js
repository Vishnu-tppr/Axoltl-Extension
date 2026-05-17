/**
 * Axoltl Memory Injector — Intercepts message sending to inject context from memory.
 * Ported from XMem content.ts with optimizations for Axoltl.
 */

(function axoltlMemoryInjector() {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────

  let bypassContextInjection = false;
  let axoltlMode = "search"; // Default to search mode for now
  
  // These should ideally be synced with Axoltl's settings
  chrome.storage.sync.get(["axoltl_memory_enabled", "axoltl_injection_mode"], (data) => {
    if (data.axoltl_injection_mode) axoltlMode = data.axoltl_injection_mode;
  });

  // ─── Selectors (Sync with memory_commands.js) ──────────────────────────────

  const EDITOR_SELECTORS = [
    "#prompt-textarea",
    'div.ProseMirror[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    'rich-textarea > div[contenteditable]',
    'div[contenteditable="true"][aria-label*="prompt"]',
    '.ql-editor[contenteditable="true"]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="ask"]',
    '[contenteditable="true"][data-placeholder]',
    '[data-testid="apple-not-supported-textarea"]',
    'textarea[data-id="root"]',
    "textarea",
  ];

  const SEND_BUTTON_SELECTORS = [
    'button[data-testid="send-button"]',       // ChatGPT
    "#composer-submit-button",
    'button[aria-label="Send Message"]',        // Claude / generic
    'button[aria-label="Send message"]',
    'button[data-testid="send-message-button"]', // Claude
    'fieldset button[type="button"]:last-of-type', // Claude fallback
    'button[type="submit"]',                    // generic
  ];

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function findEditor() {
    for (const sel of EDITOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findSendButton() {
    for (const sel of SEND_BUTTON_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    return null;
  }

  function readEditorText(el) {
    return el instanceof HTMLTextAreaElement
      ? el.value
      : el.textContent || el.innerText || "";
  }

  function replaceEditorText(editor, text) {
    if (editor instanceof HTMLTextAreaElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      if (nativeSetter) nativeSetter.call(editor, text);
      else editor.value = text;
      editor.selectionStart = editor.selectionEnd = text.length;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      editor.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    }
  }

  function fireBypassSend(editor) {
    bypassContextInjection = true;
    const sendBtn = findSendButton();
    if (sendBtn) {
      sendBtn.click();
    } else {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }

  // ─── Overlay ──────────────────────────────────────────────────────────────

  function showInjectionOverlay(editor, label) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(9,9,11,0.85);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;border-radius:12px;color:#e4e4e7;font-family:sans-serif;font-size:13px;font-weight:500;gap:10px;animation:axoltl-fade-in 0.2s ease";
    overlay.innerHTML = `
      <div class="axoltl-inject-spinner" style="width:14px;height:14px;border:2px solid rgba(228,228,231,0.2);border-top-color:#e4e4e7;border-radius:50%;animation:axoltl-spin 0.6s linear infinite"></div>
      <span>${label}</span>
      <style>
        @keyframes axoltl-spin { to { transform: rotate(360deg); } }
        @keyframes axoltl-fade-in { from { opacity: 0; } to { opacity: 1; } }
      </style>
    `;
    
    // Position relative to editor parent if possible
    const parent = editor.parentElement;
    if (parent) {
      const style = window.getComputedStyle(parent);
      if (style.position === "static") parent.style.position = "relative";
      parent.appendChild(overlay);
    } else {
      document.body.appendChild(overlay);
    }
    
    return overlay;
  }

  function removeInjectionOverlay(overlay) {
    if (overlay) {
      overlay.style.opacity = "0";
      overlay.style.transition = "opacity 0.2s ease";
      setTimeout(() => overlay.remove(), 200);
    }
  }

  // ─── Core Logic ───────────────────────────────────────────────────────────

  async function injectContextAndSend(editor) {
    console.log("[Axoltl] injectContextAndSend triggered.");
    const userQuery = readEditorText(editor).trim();
    if (!userQuery || userQuery.length < 5) {
      fireBypassSend(editor);
      return;
    }

    // Check if memory is enabled
    const settings = await new Promise(r => chrome.storage.sync.get(["axoltl_memory_enabled"], r));
    if (settings.axoltl_memory_enabled === false) {
      fireBypassSend(editor);
      return;
    }

    const overlay = showInjectionOverlay(editor, "Recalling memories...");
    let contextText = "";
    
    try {
      if (window.AxoltlMemory) {
        const result = await window.AxoltlMemory.retrieve(userQuery);
        contextText = result.answer || "";
      }
    } catch (err) {
      console.error("[Axoltl] Memory recall failed:", err);
    }

    if (contextText) {
      replaceEditorText(
        editor,
        `<axoltl_memory_context>\n${contextText}\n</axoltl_memory_context>\n\n${userQuery}`,
      );
    }
    
    await new Promise((r) => setTimeout(r, 100)); // Small buffer for DOM updates
    fireBypassSend(editor);
    requestAnimationFrame(() => removeInjectionOverlay(overlay));
  }

  // ─── Hooking ──────────────────────────────────────────────────────────────

  function hookSendButtons() {
    for (const sel of SEND_BUTTON_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn && !btn.dataset.axoltlHooked) {
        btn.dataset.axoltlHooked = "1";
        btn.addEventListener(
          "click",
          (e) => {
            if (!bypassContextInjection) {
              e.preventDefault();
              e.stopImmediatePropagation();
              const editor = findEditor();
              if (editor) injectContextAndSend(editor);
              return;
            }
            // If bypass is on, reset it for the next message
            bypassContextInjection = false;
          },
          true,
        );
      }
    }
  }

  function mainLoop() {
    const editor = findEditor();
    if (!editor) return;

    hookSendButtons();

    if (editor.dataset.axoltlInjBound) return;
    editor.dataset.axoltlInjBound = "1";

    editor.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          if (bypassContextInjection) {
            bypassContextInjection = false;
            return;
          }
          // Only intercept if we haven't already processed context injection
          e.preventDefault();
          e.stopImmediatePropagation();
          injectContextAndSend(editor);
        }
      },
      true,
    );
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────

  const observer = new MutationObserver(mainLoop);
  observer.observe(document.body, { childList: true, subtree: true });
  mainLoop();

})();
