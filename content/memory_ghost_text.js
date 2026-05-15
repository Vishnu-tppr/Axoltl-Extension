/**
 * Axoltl Memory Ghost Text — Inline memory suggestions in AI chat inputs.
 *
 * As you type, searches local IndexedDB memory via AxoltlMemory.search().
 * Shows ghost text at caret position. Tab to accept, Escape to dismiss.
 * Inspired by xmem-extension's UX but backed entirely by local storage.
 */

(function axoltlMemoryGhostText() {
  "use strict";

  const DEBOUNCE_MS = 400;
  const MIN_QUERY_LEN = 8;
  const MAX_GHOST_CHARS = 150;
  const MIN_RELEVANCE = 0.3;

  let ghostEl = null;
  let ghostAnswer = "";
  let debounceTimer = null;
  let inflightReq = null;
  let prevQueryText = "";
  let chipEl = null;
  let cachedResults = [];

  // ── Editor Detection ──────────────────────────────────────

  const EDITOR_SELECTORS = [
    "#prompt-textarea",                              // ChatGPT
    'div.ProseMirror[contenteditable="true"]',        // Claude
    'rich-textarea [contenteditable="true"]',         // Gemini
    'rich-textarea > div[contenteditable]',           // Gemini alt
    'textarea[placeholder*="Ask"]',                   // Perplexity
    'textarea[placeholder*="ask"]',                   // Perplexity alt
    '[contenteditable="true"][data-placeholder]',     // Generic contenteditable
    "textarea",                                       // Generic textarea
  ];

  function findEditor() {
    for (const sel of EDITOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function readEditorText(el) {
    return el instanceof HTMLTextAreaElement
      ? el.value
      : el.textContent || el.innerText || "";
  }

  function isCursorAtEnd(el) {
    if (el instanceof HTMLTextAreaElement) {
      return el.selectionEnd >= el.value.trimEnd().length;
    }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return true;
    const range = sel.getRangeAt(0);
    const tail = document.createRange();
    tail.selectNodeContents(el);
    tail.setStart(range.endContainer, range.endOffset);
    return !tail.toString().trim();
  }

  // ── Caret Position ────────────────────────────────────────

  function getCaretXY(el) {
    return el instanceof HTMLTextAreaElement
      ? textareaCaretXY(el)
      : contentEditableCaretXY(el);
  }

  function contentEditableCaretXY(el) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return null;

    const collapsed = range.cloneRange();
    collapsed.collapse(false);
    const rect = collapsed.getBoundingClientRect();
    if (rect.height > 0) return { x: rect.right, y: rect.top, h: rect.height };

    const edRect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: edRect.left + parseFloat(cs.paddingLeft),
      y: edRect.top + parseFloat(cs.paddingTop),
      h: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
    };
  }

  function textareaCaretXY(ta) {
    const cs = getComputedStyle(ta);
    const mirror = document.createElement("div");
    const props = [
      "font-family","font-size","font-weight","font-style","line-height",
      "letter-spacing","word-spacing","text-indent","overflow-wrap",
      "word-break","padding-top","padding-right","padding-bottom",
      "padding-left","border-top-width","border-right-width",
      "border-bottom-width","border-left-width","box-sizing",
    ];
    for (const p of props) mirror.style.setProperty(p, cs.getPropertyValue(p));

    mirror.style.position = "absolute";
    mirror.style.top = "-9999px";
    mirror.style.left = "-9999px";
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflow = "hidden";
    mirror.style.visibility = "hidden";

    mirror.textContent = ta.value.substring(0, ta.selectionEnd);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const taRect = ta.getBoundingClientRect();
    const borderL = parseFloat(cs.borderLeftWidth) || 0;
    const borderT = parseFloat(cs.borderTopWidth) || 0;

    const result = {
      x: taRect.left + borderL + (markerRect.left - mirrorRect.left) - ta.scrollLeft,
      y: taRect.top + borderT + (markerRect.top - mirrorRect.top) - ta.scrollTop,
      h: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4,
    };
    mirror.remove();
    return result;
  }

  // ── Theme Detection ───────────────────────────────────────

  function isDarkBackground(el) {
    let current = el;
    while (current) {
      const bg = getComputedStyle(current).backgroundColor;
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        if (m.length >= 4 && parseFloat(m[3]) === 0) {
          current = current.parentElement;
          continue;
        }
        const lum = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
        return lum < 0.5;
      }
      current = current.parentElement;
    }
    return true; // default dark
  }

  // ── Ghost Text Rendering ──────────────────────────────────

  function showGhost(answer, caret, editorRect, editor) {
    dismissGhost();
    ghostAnswer = answer;

    const display =
      answer.length > MAX_GHOST_CHARS
        ? answer.slice(0, MAX_GHOST_CHARS).trimEnd() + "…"
        : answer;

    const currentText = readEditorText(editor);
    const endsWithSpace = /[\s\n]$/.test(currentText);
    const startsWithPunct = /^[.,?!:;]/.test(answer);
    let prefix = "";
    if (!endsWithSpace && !startsWithPunct && currentText.length > 0) {
      prefix = " ";
    }

    const dark = isDarkBackground(editor);

    ghostEl = document.createElement("div");
    ghostEl.className = "axoltl-ghost";
    ghostEl.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 400px;
      opacity: 0;
      transition: opacity 0.15s ease;
    `;

    const textSpan = document.createElement("span");
    textSpan.textContent = `${prefix}${display}`;
    textSpan.style.cssText = `
      color: ${dark ? "rgba(16,185,129,0.6)" : "rgba(5,150,105,0.5)"};
      font-style: italic;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    ghostEl.appendChild(textSpan);

    const tabBadge = document.createElement("span");
    tabBadge.textContent = "Tab";
    tabBadge.style.cssText = `
      background: ${dark ? "rgba(16,185,129,0.15)" : "rgba(5,150,105,0.1)"};
      color: ${dark ? "#10b981" : "#059669"};
      font-size: 10px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px;
      border: 1px solid ${dark ? "rgba(16,185,129,0.3)" : "rgba(5,150,105,0.2)"};
      flex-shrink: 0;
    `;
    ghostEl.appendChild(tabBadge);

    const cs = getComputedStyle(editor);
    ghostEl.style.fontFamily = cs.fontFamily;
    ghostEl.style.fontSize = cs.fontSize;
    ghostEl.style.lineHeight = `${caret.h}px`;

    // Position relative to caret
    const spaceRight = editorRect.right - caret.x - 16;
    if (spaceRight > 120) {
      ghostEl.style.left = `${caret.x}px`;
      ghostEl.style.top = `${caret.y}px`;
      ghostEl.style.maxWidth = `${spaceRight}px`;
    } else {
      const padL = parseFloat(cs.paddingLeft) || 0;
      ghostEl.style.left = `${editorRect.left + padL}px`;
      ghostEl.style.top = `${caret.y + caret.h}px`;
      ghostEl.style.maxWidth = `${editorRect.width - padL * 2 - 16}px`;
    }

    document.body.appendChild(ghostEl);
    requestAnimationFrame(() => { if (ghostEl) ghostEl.style.opacity = "1"; });
  }

  function showLoadingGhost(caret, editor) {
    dismissGhost();
    const dark = isDarkBackground(editor);

    ghostEl = document.createElement("div");
    ghostEl.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      left: ${caret.x}px;
      top: ${caret.y}px;
      color: ${dark ? "rgba(16,185,129,0.4)" : "rgba(5,150,105,0.3)"};
      font-style: italic;
      opacity: 0;
      transition: opacity 0.15s ease;
    `;
    const cs = getComputedStyle(editor);
    ghostEl.style.fontFamily = cs.fontFamily;
    ghostEl.style.fontSize = cs.fontSize;
    ghostEl.style.lineHeight = `${caret.h}px`;
    ghostEl.textContent = "  ···";
    document.body.appendChild(ghostEl);
    requestAnimationFrame(() => { if (ghostEl) ghostEl.style.opacity = "1"; });
  }

  function dismissGhost() {
    if (ghostEl) { ghostEl.remove(); ghostEl = null; }
    ghostAnswer = "";
  }

  function acceptGhost() {
    if (!ghostAnswer) return false;
    const editor = findEditor();
    if (!editor) return false;

    const currentText = readEditorText(editor);
    const endsWithSpace = /[\s\n]$/.test(currentText);
    const startsWithPunct = /^[.,?!:;]/.test(ghostAnswer);
    let prefix = "";
    if (!endsWithSpace && !startsWithPunct && currentText.length > 0) {
      prefix = " ";
    }

    insertText(editor, `${prefix}${ghostAnswer}`);
    dismissGhost();
    showToast("Memory context added ⚡");
    return true;
  }

  function insertText(el, text) {
    if (el instanceof HTMLTextAreaElement) {
      // React-compatible: use native setter
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, "value"
      )?.set;
      const pos = el.selectionEnd;
      const newVal = el.value.slice(0, pos) + text + el.value.slice(pos);
      if (nativeSetter) nativeSetter.call(el, newVal);
      else el.value = newVal;
      el.selectionStart = el.selectionEnd = pos + text.length;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.focus();
      document.execCommand("insertText", false, text);
    }
  }

  // ── Memory Chip ───────────────────────────────────────────

  function ensureChip(anchor) {
    if (chipEl && document.body.contains(chipEl)) return chipEl;

    chipEl = document.createElement("div");
    chipEl.id = "axoltl-memory-chip";
    const dark = isDarkBackground(anchor);
    chipEl.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      display: none;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      cursor: pointer;
      transition: all 0.2s ease;
      background: ${dark ? "rgba(16,185,129,0.12)" : "rgba(5,150,105,0.08)"};
      color: ${dark ? "#10b981" : "#059669"};
      border: 1px solid ${dark ? "rgba(16,185,129,0.25)" : "rgba(5,150,105,0.2)"};
    `;
    chipEl.innerHTML = `<span style="font-size:13px">🦎</span> <span class="axoltl-chip-count">0</span> <span class="axoltl-chip-label">memories</span>`;
    document.body.appendChild(chipEl);

    // Position above editor
    const rect = anchor.getBoundingClientRect();
    chipEl.style.top = `${rect.top - 30}px`;
    chipEl.style.right = `${window.innerWidth - rect.right + 8}px`;

    return chipEl;
  }

  function updateChip(count, loading = false) {
    if (!chipEl) return;
    const countEl = chipEl.querySelector(".axoltl-chip-count");
    const labelEl = chipEl.querySelector(".axoltl-chip-label");
    if (countEl) countEl.textContent = loading ? "…" : String(count);
    if (labelEl) labelEl.textContent = loading ? "searching" : (count === 1 ? "memory" : "memories");
    chipEl.style.display = count > 0 || loading ? "inline-flex" : "none";
  }

  // ── Autocomplete Engine ───────────────────────────────────

  async function runAutocomplete(queryText) {
    if (!window.axoltlMemoryEnabled) return;
    if (!window.AxoltlMemory) return;
    if (queryText === prevQueryText) return;
    prevQueryText = queryText;

    if (inflightReq) inflightReq.cancelled = true;
    const thisReq = (inflightReq = { cancelled: false });

    const editor = findEditor();
    if (editor && isCursorAtEnd(editor)) {
      const pos = getCaretXY(editor);
      if (pos) showLoadingGhost(pos, editor);
      ensureChip(editor);
      updateChip(0, true);
    }

    try {
      const results = await window.AxoltlMemory.search(queryText, 5);
      if (thisReq.cancelled) return;

      cachedResults = results;
      updateChip(results.length);

      if (!results.length || results[0].score < MIN_RELEVANCE) {
        dismissGhost();
        return;
      }

      // Get synthesized answer for ghost text
      const resp = await window.AxoltlMemory.retrieve(queryText);
      if (thisReq.cancelled) return;

      if (!resp.answer) { dismissGhost(); return; }

      const ed = findEditor();
      if (!ed || !isCursorAtEnd(ed)) { dismissGhost(); return; }

      const caret = getCaretXY(ed);
      if (!caret) { dismissGhost(); return; }

      const edRect = ed.getBoundingClientRect();
      if (caret.y < edRect.top - 5 || caret.y > edRect.bottom + 5) {
        dismissGhost();
        return;
      }

      showGhost(resp.answer, caret, edRect, ed);
    } catch (e) {
      console.error("[Axoltl Ghost] Search error:", e);
      updateChip(0);
      dismissGhost();
    }
  }

  // ── Input Listener ────────────────────────────────────────

  function setupInputListener() {
    const editor = findEditor();
    if (!editor || editor.dataset.axoltlGhostHooked) return;
    editor.dataset.axoltlGhostHooked = "1";

    editor.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      dismissGhost();

      const text = readEditorText(editor).trim();
      if (text.length >= MIN_QUERY_LEN && isCursorAtEnd(editor)) {
        debounceTimer = setTimeout(() => runAutocomplete(text), DEBOUNCE_MS);
      }
    });

    editor.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && ghostAnswer) {
        e.preventDefault();
        e.stopPropagation();
        acceptGhost();
      } else if (e.key === "Escape" && ghostAnswer) {
        e.preventDefault();
        e.stopPropagation();
        dismissGhost();
      }
    }, true);
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

  // ── Polling for editor (handles SPA navigation) ───────────

  setInterval(setupInputListener, 1500);
  setTimeout(setupInputListener, 800);
})();
