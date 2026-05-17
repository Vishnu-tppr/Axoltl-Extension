/**
 * Axoltl Memory Ghost Text — Inline memory suggestions in AI chat inputs.
 *
 * As you type, searches local and server-side memory via AxoltlMemory.
 * Shows ghost text at caret position with a premium Teal Glow aesthetic.
 * Tab to accept, Escape to dismiss.
 */

(function axoltlMemoryGhostText() {
  "use strict";

  const DEBOUNCE_MS = 300; // Snappier response
  const MIN_QUERY_LEN = 5;
  const MAX_GHOST_CHARS = 160;
  const MIN_RELEVANCE = 0.35; // Slightly lower to allow more completions
  const PRIMARY_TEAL = "#10b981"; // Emerald-500 from XMem
  const GLOW_COLOR = "rgba(16, 185, 129, 0.4)";
  
  let ghostEl = null;
  let ghostAnswer = "";
  let debounceTimer = null;
  let inflightReq = null;
  let prevQueryText = "";
  let chipEl = null;

  // ── Premium Styles ────────────────────────────────────────
  const STYLE_ID = "axoltl-premium-ghost-css";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes axoltl-ghost-shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }
      @keyframes axoltl-ghost-pulse {
        0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
        70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
        100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
      }
      @keyframes axoltl-badge-glow {
        0% { filter: brightness(1) drop-shadow(0 0 2px ${PRIMARY_TEAL}); }
        50% { filter: brightness(1.3) drop-shadow(0 0 6px ${PRIMARY_TEAL}); }
        100% { filter: brightness(1) drop-shadow(0 0 2px ${PRIMARY_TEAL}); }
      }
      @keyframes axoltl-ghost-rhythm {
        0% { opacity: 0.6; transform: translateY(0); }
        50% { opacity: 1.0; transform: translateY(-1px); }
        100% { opacity: 0.6; transform: translateY(0); }
      }
      .axoltl-ghost-container {
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        letter-spacing: -0.01em !important;
      }
      .axoltl-tab-badge {
        animation: axoltl-badge-glow 3s infinite ease-in-out;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Editor Detection ──────────────────────────────────────

  const EDITOR_SELECTORS = [
    "#prompt-textarea",                              // ChatGPT
    'div.ProseMirror[aria-label*="Write your prompt"]', // Claude
    'div.tiptap.ProseMirror',                         // Claude (generic)
    "div.ql-editor",                                  // Gemini (Quill)
    'rich-textarea [contenteditable="true"]',         // Gemini Legacy
    'div[id="ask-input"]',                            // Perplexity
    'textarea[placeholder*="Ask"]',                   // Perplexity Legacy
    '[contenteditable="true"][data-placeholder]',     // Generic contenteditable
    "textarea",                                       // Generic textarea
  ];

  function findEditor() {
    for (const sel of EDITOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    // Deep search fallback
    const ce = document.querySelector('[contenteditable="true"]');
    if (ce && ce.offsetParent !== null) return ce;
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
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (el.contains(range.commonAncestorContainer)) {
        const collapsed = range.cloneRange();
        collapsed.collapse(false);
        const rect = collapsed.getBoundingClientRect();
        if (rect.height > 0) return { x: rect.right, y: rect.top, h: rect.height };
      }
    }

    // Fallback to end of text or editor start
    const edRect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;

    return {
      x: edRect.left + padL,
      y: edRect.top + padT,
      h: lineH,
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

  function getCompletionSuffix(current, answer) {
    const cur = current.toLowerCase().trim();
    const ans = answer.toLowerCase().trim();
    
    // Find longest overlapping suffix of current that matches prefix of answer
    const words = cur.split(/\s+/);
    for (let i = Math.min(words.length, 10); i >= 1; i--) {
      const suffix = words.slice(-i).join(" ");
      if (ans.startsWith(suffix)) {
        return answer.trim().slice(suffix.length).trim();
      }
    }
    return answer;
  }

  function showGhost(resp, caret, editorRect, editor) {
    dismissGhost();
    
    const answer = resp.answer;
    const currentText = readEditorText(editor);
    const suffix = getCompletionSuffix(currentText, answer);
    
    if (!suffix || suffix.length < 2) return; 
    
    ghostAnswer = suffix;

    const display =
      suffix.length > MAX_GHOST_CHARS
        ? suffix.slice(0, MAX_GHOST_CHARS).trimEnd() + "..."
        : suffix;

    const endsWithSpace = /[\s\n]$/.test(currentText);
    const startsWithPunct = /^[.,?!:;]/.test(suffix);
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
      flex-direction: column;
      gap: 6px;
      padding: 10px 18px;
      border-radius: 14px;
      background: ${dark 
        ? "linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(15, 23, 42, 0.98) 100%)" 
        : "linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(255, 255, 255, 1.0) 100%)"};
      border: 1px solid ${dark ? "rgba(45, 212, 191, 0.2)" : "rgba(16, 185, 129, 0.15)"};
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      box-shadow: 0 16px 64px rgba(0, 0, 0, 0.4), 0 0 0 1px ${dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.02)"};
      opacity: 0;
      transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
      transform: translateY(10px) scale(0.95);
    `;

    // Content Row
    const contentRow = document.createElement("div");
    contentRow.style.cssText = "display:flex; align-items:center; gap:12px;";
    
    const textSpan = document.createElement("span");
    textSpan.textContent = `${prefix}${display}`;
    textSpan.style.cssText = `
      color: ${dark ? "#5eead4" : "#0d9488"};
      font-size: inherit;
      line-height: 1.5;
      font-weight: 500;
    `;
    contentRow.appendChild(textSpan);

    const tabBadge = document.createElement("span");
    tabBadge.className = "axoltl-tab-badge";
    tabBadge.innerHTML = `<span style="font-size:8px; margin-right:4px; opacity:0.6; font-weight:800">TAB</span>⇥`;
    tabBadge.style.cssText = `
      background: ${PRIMARY_TEAL};
      color: white;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 8px;
      flex-shrink: 0;
      box-shadow: 0 4px 12px ${GLOW_COLOR};
      display: flex;
      align-items: center;
    `;
    contentRow.appendChild(tabBadge);
    ghostEl.appendChild(contentRow);

    // Meta Row (Agentic details)
    const metaRow = document.createElement("div");
    metaRow.style.cssText = "display:flex; align-items:center; gap:8px; margin-top:2px;";
    
    const sourceCount = resp.sources?.length || 0;
    if (sourceCount > 0) {
      const sBadge = document.createElement("span");
      sBadge.textContent = `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`;
      sBadge.style.cssText = `
        font-size: 10px; color: ${dark ? "rgba(16, 185, 129, 0.6)" : "rgba(16, 185, 129, 0.7)"};
        background: ${dark ? "rgba(16, 185, 129, 0.08)" : "rgba(16, 185, 129, 0.05)"};
        padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.15);
      `;
      metaRow.appendChild(sBadge);
    }

    if (resp.confidence) {
      const conf = Math.round(resp.confidence * 100);
      const cBadge = document.createElement("span");
      cBadge.textContent = `${conf}% certain`;
      cBadge.style.cssText = `
        font-size: 10px; color: ${conf > 80 ? PRIMARY_TEAL : "#94a3b8"};
        font-weight: 700;
      `;
      metaRow.appendChild(cBadge);
    }

    if (resp.fromServer) {
      const agentBadge = document.createElement("span");
      agentBadge.textContent = "AGENTIC";
      agentBadge.style.cssText = `
        font-size: 9px; font-weight: 900; letter-spacing: 0.05em;
        color: ${PRIMARY_TEAL}; opacity: 0.8; margin-left: auto;
      `;
      metaRow.appendChild(agentBadge);
    }

    ghostEl.appendChild(metaRow);

    const cs = getComputedStyle(editor);
    ghostEl.style.fontFamily = cs.fontFamily;
    ghostEl.style.fontSize = cs.fontSize;

    // Position logic
    const spaceRight = editorRect.right - caret.x - 30;
    if (spaceRight > 220) {
      ghostEl.style.left = `${caret.x}px`;
      ghostEl.style.top = `${caret.y - 10}px`;
      ghostEl.style.maxWidth = `${spaceRight}px`;
    } else {
      const padL = parseFloat(cs.paddingLeft) || 0;
      ghostEl.style.left = `${editorRect.left + padL}px`;
      ghostEl.style.top = `${caret.y + caret.h + 12}px`;
      ghostEl.style.maxWidth = `${editorRect.width - padL * 2 - 30}px`;
    }

    document.body.appendChild(ghostEl);
    requestAnimationFrame(() => { 
      if (ghostEl) {
        ghostEl.style.opacity = "1";
        ghostEl.style.transform = "translateY(0) scale(1)";
      }
    });
  }

  function showLoadingGhost(caret, editor) {
    dismissGhost();
    const dark = isDarkBackground(editor);

    // Inject shimmer keyframes once
    if (!document.getElementById('axoltl-ghost-keyframes')) {
      const style = document.createElement('style');
      style.id = 'axoltl-ghost-keyframes';
      style.textContent = `
        @keyframes axoltl-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes axoltl-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.9; }
        }
      `;
      document.head.appendChild(style);
    }

    ghostEl = document.createElement("div");
    ghostEl.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      pointer-events: none;
      left: ${caret.x}px;
      top: ${caret.y}px;
      display: flex;
      align-items: center;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.25s ease;
    `;
    const cs = getComputedStyle(editor);
    ghostEl.style.fontFamily = cs.fontFamily;
    ghostEl.style.fontSize = cs.fontSize;
    ghostEl.style.lineHeight = `${caret.h}px`;

    // Animated dots
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.style.cssText = `
        display: inline-block;
        width: 5px; height: 5px;
        border-radius: 50%;
        background: ${dark ? "#2dd4bf" : "#0d9488"};
        animation: axoltl-pulse 1.2s ease-in-out ${i * 0.2}s infinite;
      `;
      ghostEl.appendChild(dot);
    }

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
      // 60-second timeout for retrieval (local model can be slow)
      const searchTask = window.AxoltlMemory.search(queryText, 5);
      const timeoutTask = new Promise((_, r) => setTimeout(() => r("timeout"), 60000));
      
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
      showGhost(resp, caret, edRect, ed);
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
    if (editor) hookEditor(editor);
  }

  // Periodic check for SPA navigation
  setInterval(mainLoop, 1000);

  function showToast(msg) {
    const t = document.createElement("div");
    t.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      display: flex; align-items: center; gap: 10px;
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
      color: #5eead4;
      padding: 14px 20px; border-radius: 12px;
      border: 1px solid rgba(45, 212, 191, 0.25);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; font-weight: 500;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(45, 212, 191, 0.1);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      opacity: 0; transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      transform: translateY(20px) scale(0.92);
    `;

    // Icon
    const icon = document.createElement("span");
    icon.textContent = "🧠";
    icon.style.cssText = "font-size: 16px; flex-shrink: 0;";
    t.appendChild(icon);

    // Text
    const text = document.createElement("span");
    text.textContent = msg;
    t.appendChild(text);

    document.body.appendChild(t);
    requestAnimationFrame(() => { 
      t.style.opacity = "1"; 
      t.style.transform = "translateY(0) scale(1)";
    });
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(-8px) scale(0.95)";
      setTimeout(() => t.remove(), 500);
    }, 2500);
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
