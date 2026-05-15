/**
 * Axoltl Memory Ghost Text — Inline memory suggestions in AI chat inputs.
 *
 * As you type, searches local and server-side memory via AxoltlMemory.
 * Shows ghost text at caret position with a premium Teal Glow aesthetic.
 * Tab to accept, Escape to dismiss.
 */

(function axoltlMemoryGhostText() {
  "use strict";

  const DEBOUNCE_MS = 600;
  const MIN_QUERY_LEN = 8;
  const MAX_GHOST_CHARS = 160;
  const MIN_RELEVANCE = 0.4;

  let ghostEl = null;
  let ghostAnswer = "";
  let debounceTimer = null;
  let inflightReq = null;
  let prevQueryText = "";
  let chipEl = null;

  // ── Editor Detection ──────────────────────────────────────

  const EDITOR_SELECTORS = [
    "#prompt-textarea",                              // ChatGPT
    'div.ProseMirror[contenteditable="true"]',        // Claude
    "div.ql-editor",                                  // Gemini (Quill)
    'rich-textarea [contenteditable="true"]',         // Gemini Legacy
    'textarea[placeholder*="Ask"]',                   // Perplexity
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
    return !tail.toString().trim().length;
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
    return true;
  }

  // ── Ghost Text Rendering ──────────────────────────────────

  function showGhost(answer, caret, editorRect, editor) {
    dismissGhost();
    ghostAnswer = answer;

    const display =
      answer.length > MAX_GHOST_CHARS
        ? answer.slice(0, MAX_GHOST_CHARS).trimEnd() + "..."
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
    ghostEl.className = "axoltl-ghost-container";
    ghostEl.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 2px 8px;
      border-radius: 6px;
      background: ${dark ? "linear-gradient(90deg, rgba(20, 184, 166, 0.05) 0%, transparent 100%)" : "linear-gradient(90deg, rgba(13, 148, 136, 0.03) 0%, transparent 100%)"};
      opacity: 0;
      transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      transform: translateX(-4px);
    `;

    const textSpan = document.createElement("span");
    textSpan.textContent = `${prefix}${display}`;
    textSpan.style.cssText = `
      color: ${dark ? "rgba(45, 212, 191, 0.7)" : "rgba(15, 118, 110, 0.6)"};
      font-style: italic;
      white-space: pre-wrap;
      text-shadow: 0 0 12px ${dark ? "rgba(45, 212, 191, 0.25)" : "transparent"};
      letter-spacing: 0.01em;
    `;
    ghostEl.appendChild(textSpan);

    const tabBadge = document.createElement("span");
    const tabIcon = document.createElement("span");
    tabIcon.textContent = "⇥";
    tabIcon.style.cssText = "font-size:9px;opacity:0.7;margin-right:2px";
    tabBadge.appendChild(tabIcon);
    
    const tabText = document.createTextNode("Tab");
    tabBadge.appendChild(tabText);
    tabBadge.style.cssText = `
      background: ${dark ? "rgba(20, 184, 166, 0.2)" : "rgba(13, 148, 136, 0.15)"};
      color: ${dark ? "#5eead4" : "#115e59"};
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 6px;
      border: 1px solid ${dark ? "rgba(45, 212, 191, 0.4)" : "rgba(15, 118, 110, 0.3)"};
      flex-shrink: 0;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      box-shadow: 0 2px 8px ${dark ? "rgba(20, 184, 166, 0.2)" : "rgba(13, 148, 136, 0.15)"};
      backdrop-filter: blur(4px);
    `;
    ghostEl.appendChild(tabBadge);

    const cs = getComputedStyle(editor);
    ghostEl.style.fontFamily = cs.fontFamily;
    ghostEl.style.fontSize = cs.fontSize;
    ghostEl.style.lineHeight = `${caret.h}px`;

    // Position
    const spaceRight = editorRect.right - caret.x - 20;
    if (spaceRight > 150) {
      ghostEl.style.left = `${caret.x}px`;
      ghostEl.style.top = `${caret.y}px`;
      ghostEl.style.maxWidth = `${spaceRight}px`;
    } else {
      const padL = parseFloat(cs.paddingLeft) || 0;
      ghostEl.style.left = `${editorRect.left + padL}px`;
      ghostEl.style.top = `${caret.y + caret.h}px`;
      ghostEl.style.maxWidth = `${editorRect.width - padL * 2 - 20}px`;
    }

    document.body.appendChild(ghostEl);
    requestAnimationFrame(() => { 
      if (ghostEl) {
        ghostEl.style.opacity = "1";
        ghostEl.style.transform = "translateX(0)";
      }
    });
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
      color: ${dark ? "rgba(20, 184, 166, 0.4)" : "rgba(13, 148, 136, 0.3)"};
      font-style: italic;
      opacity: 0;
      transition: opacity 0.2s ease;
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
    showToast("Memory context injected ⚡");
    return true;
  }

  function insertText(el, text) {
    if (el instanceof HTMLTextAreaElement) {
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
      gap: 6px;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 11.5px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      background: ${dark ? "rgba(15, 23, 42, 0.85)" : "rgba(255, 255, 255, 0.9)"};
      color: ${dark ? "#5eead4" : "#0f766e"};
      border: 1px solid ${dark ? "rgba(45, 212, 191, 0.3)" : "rgba(13, 148, 136, 0.2)"};
      box-shadow: 0 4px 16px ${dark ? "rgba(0, 0, 0, 0.5)" : "rgba(13, 148, 136, 0.15)"};
      backdrop-filter: blur(12px);
    `;
    // Status Dot
    const dot = document.createElement("div");
    dot.className = "axoltl-status-dot";
    dot.style.cssText = "width:6px;height:6px;border-radius:50%;background:#94a3b8;margin-right:2px";
    chipEl.appendChild(dot);

    // SVG Icon (using SVG namespace)
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", "M12 2a7 7 0 0 1 7 7c0 3-2 5.5-4 7l-3 3.5L9 16c-2-1.5-4-4-4-7a7 7 0 0 1 7-7z");
    svg.appendChild(path);
    
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "9");
    circle.setAttribute("r", "2.5");
    svg.appendChild(circle);
    chipEl.appendChild(svg);

    // Count Span
    const countSpan = document.createElement("span");
    countSpan.className = "axoltl-chip-count";
    countSpan.textContent = "0";
    chipEl.appendChild(countSpan);

    // Label Span
    const labelSpan = document.createElement("span");
    labelSpan.className = "axoltl-chip-label";
    labelSpan.textContent = "found";
    chipEl.appendChild(labelSpan);
    document.body.appendChild(chipEl);

    const rect = anchor.getBoundingClientRect();
    chipEl.style.top = `${rect.top - 34}px`;
    chipEl.style.right = `${window.innerWidth - rect.right + 12}px`;

    return chipEl;
  }

  async function updateChip(count, loading = false) {
    if (!chipEl) return;
    const countEl = chipEl.querySelector(".axoltl-chip-count");
    const labelEl = chipEl.querySelector(".axoltl-chip-label");
    const dotEl = chipEl.querySelector(".axoltl-status-dot");

    if (countEl) countEl.textContent = loading ? "..." : String(count);
    if (labelEl) labelEl.textContent = loading ? "searching" : "memories";
    
    const serverConnected = await window.AxoltlMemory.isServerConnected();
    if (dotEl) {
      dotEl.style.background = serverConnected ? "#2dd4bf" : "#f43f5e";
      chipEl.title = serverConnected ? "Connected to Axoltl Memory Core" : "Offline: Using local IndexedDB fallback";
    }

    if (count > 0 || loading) {
      chipEl.style.display = "inline-flex";
      requestAnimationFrame(() => { chipEl.style.opacity = "1"; });
    } else {
      chipEl.style.display = "none";
    }
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
      // 30-second timeout for retrieval
      const searchTask = window.AxoltlMemory.search(queryText, 5);
      const timeoutTask = new Promise((_, r) => setTimeout(() => r("timeout"), 30000));
      
      const results = await Promise.race([searchTask, timeoutTask]);
      if (thisReq.cancelled) return;
      if (results === "timeout") throw new Error("Search timeout");

      updateChip(results.length);

      if (!results.length || results[0].score < MIN_RELEVANCE) {
        dismissGhost();
        return;
      }

      const resp = await window.AxoltlMemory.retrieve(queryText);
      if (thisReq.cancelled) return;

      if (!resp.answer) { dismissGhost(); return; }

      const ed = findEditor();
      if (!ed || !isCursorAtEnd(ed)) { dismissGhost(); return; }

      const caret = getCaretXY(ed);
      if (!caret) { dismissGhost(); return; }

      const edRect = ed.getBoundingClientRect();
      showGhost(resp.answer, caret, edRect, ed);
    } catch (e) {
      console.error("[Axoltl Ghost] Search error:", e);
      updateChip(0);
      dismissGhost();
    }
  }

  // ── Listener Setup ────────────────────────────────────────

  function hookEditor(editor) {
    if (editor.dataset.axoltlGhostHooked) return;
    editor.dataset.axoltlGhostHooked = "1";

    const onInput = () => {
      clearTimeout(debounceTimer);
      dismissGhost();

      const text = readEditorText(editor).trim();
      if (text.length >= MIN_QUERY_LEN && isCursorAtEnd(editor)) {
        ensureChip(editor);
        debounceTimer = setTimeout(() => runAutocomplete(text), DEBOUNCE_MS);
      } else {
        updateChip(0);
      }
    };

    editor.addEventListener("input", onInput);
    editor.addEventListener("keyup", onInput);
    
    editor.addEventListener("focus", () => {
      ensureChip(editor);
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
    
    editor.addEventListener("blur", () => dismissGhost());
    editor.addEventListener("scroll", () => {
      if (!ghostAnswer) return;
      const pos = getCaretXY(editor);
      if (!pos || !ghostEl) {
        dismissGhost();
        return;
      }
      const edRect = editor.getBoundingClientRect();
      if (pos.y < edRect.top || pos.y > edRect.bottom) {
        dismissGhost();
        return;
      }
      ghostEl.style.left = `${pos.x}px`;
      ghostEl.style.top = `${pos.y}px`;
    });
  }

  // Dismiss ghost when cursor moves away from end
  document.addEventListener("selectionchange", () => {
    if (!ghostAnswer) return;
    const ed = findEditor();
    if (!ed || !isCursorAtEnd(ed)) dismissGhost();
  });

  function mainLoop() {
    const editor = findEditor();
    if (!editor) return;
    hookEditor(editor);
  }

  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: rgba(15, 23, 42, 0.9); color: #5eead4;
      padding: 12px 24px; border-radius: 8px;
      border: 1px solid rgba(45, 212, 191, 0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; font-weight: 500;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(8px);
      opacity: 0; transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      transform: translateY(20px) scale(0.95);
    `;
    document.body.appendChild(t);
    requestAnimationFrame(() => { 
      t.style.opacity = "1"; 
      t.style.transform = "translateY(0) scale(1)";
    });
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(20px) scale(0.95)";
      setTimeout(() => t.remove(), 400);
    }, 3000);
  }

  let observerActive = false;
  function startObserver() {
    if (observerActive) return;
    observerActive = true;
    new MutationObserver(mainLoop).observe(document.body, {
      childList: true,
      subtree: true,
    });
    mainLoop();
  }

  startObserver();
})();
