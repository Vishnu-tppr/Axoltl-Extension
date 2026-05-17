/**
 * Axoltl Memory Commands — Slash commands for interacting with local memory.
 * Premium UI & Caret-aware positioning ported from XMem.
 */

(function axoltlMemoryCommands() {
  "use strict";

  // ─── State ────────────────────────────────────────────────────────────────

  let inputElement = null;
  let slashDropdownEl = null;
  let slashSelectedIdx = 0;
  let isActive = false;
  let sidebarEl = null;

  const COMMANDS = [
    { 
      cmd: "Xingest", 
      desc: "Save this conversation to memory", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      action: doIngest 
    },
    { 
      cmd: "Xsearch", 
      desc: "Search your memory for results", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      action: doSearch 
    },
    { 
      cmd: "mem", 
      desc: "Search your memory (alias)", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      action: doSearch 
    },
    { 
      cmd: "memory", 
      desc: "Search your memory (alias)", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
      action: doSearch 
    },
    { 
      cmd: "Xretrieve", 
      desc: "Ask memory a question (LLM)", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 3-2 5.5-4 7l-3 3.5L9 16c-2-1.5-4-4-4-7a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>',
      action: doRetrieve 
    },
    { 
      cmd: "Xstats", 
      desc: "Show memory statistics", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      action: doStats 
    },
    { 
      cmd: "Xexport", 
      desc: "Export memories as JSON", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
      action: doExport 
    },
    { 
      cmd: "Xclear", 
      desc: "Clear all memories", 
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
      action: doClear 
    },
  ];

  // ─── Editor Detection ─────────────────────────────────────────────────────

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

  // ─── Caret Position (Ported from XMem) ────────────────────────────────────

  function getCaretXY(el) {
    return el instanceof HTMLTextAreaElement
      ? textareaCaretXY(el)
      : contentEditableCaretXY(el);
  }

  function contentEditableCaretXY(el) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
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
      "font-family", "font-size", "font-weight", "font-style", "line-height",
      "letter-spacing", "word-spacing", "text-indent", "overflow-wrap",
      "word-break", "padding-top", "padding-right", "padding-bottom",
      "padding-left", "border-top-width", "border-right-width",
      "border-bottom-width", "border-left-width", "box-sizing",
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

    const mirrorRect = mirror.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
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

  // ─── Theme Detection ──────────────────────────────────────────────────────

  function getElementBackground(el) {
    if (!el) return null;
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/\d+/g);
    if (!m) return getElementBackground(el.parentElement);
    if (m.length >= 4 && parseFloat(m[3]) === 0)
      return getElementBackground(el.parentElement);
    return [+m[0], +m[1], +m[2]];
  }

  function isDarkBackground(el) {
    const m = getElementBackground(el);
    if (!m) return true;
    return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255 < 0.5;
  }

  // ─── Slash Command Dropdown (Ported from XMem) ────────────────────────────

  function getSlashPrefix(editor) {
    const text = readEditorText(editor);
    if (!text) return "";

    const words = text.split(/\s+/);
    const lastWord = words[words.length - 1] || "";
    if (!lastWord) return "";

    const upperLast = lastWord.toUpperCase();

    // Support /X, X, or +X triggers (case insensitive)
    if (upperLast.startsWith("/X") || upperLast.startsWith("+X")) {
      return "X" + lastWord.substring(2);
    } else if (upperLast.startsWith("X")) {
      return lastWord;
    }
    
    // Special check for "+ X" (with space)
    if (upperLast === "X" && words.length >= 2 && words[words.length - 2] === "+") {
      return "X";
    }

    return "";
  }

  function ensureDropdownStyles() {
    if (document.getElementById("axoltl-slash-styles")) return;
    const style = document.createElement("style");
    style.id = "axoltl-slash-styles";
    style.textContent = `
      #axoltl-slash-dropdown {
        font-family: 'Outfit', 'Inter', system-ui, -apple-system, sans-serif;
        display: none;
        background: rgba(20, 20, 22, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        padding: 6px;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.3);
        min-width: 260px;
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        z-index: 2147483647;
        animation: axoltl-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      
      @keyframes axoltl-fade-in {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .axoltl-slash-option {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s ease;
        margin-bottom: 2px;
        color: #e4e4e7;
      }
      .axoltl-slash-option:last-child { margin-bottom: 0; }
      .axoltl-slash-option:hover,
      .axoltl-slash-option.axoltl-slash-selected {
        background: rgba(255, 255, 255, 0.08);
        transform: translateX(4px);
        color: #ffffff;
      }
      
      .axoltl-slash-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px; height: 30px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        color: #a1a1aa;
        flex-shrink: 0;
      }
      .axoltl-slash-selected .axoltl-slash-icon {
        background: rgba(255, 255, 255, 0.15);
        color: #ffffff;
      }

      .axoltl-slash-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .axoltl-slash-cmd {
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
      }
      .axoltl-slash-desc {
        font-size: 11px;
        color: #88888f;
        opacity: 0.9;
      }

      #axoltl-slash-dropdown.axoltl-slash-light {
        background: rgba(255, 255, 255, 0.9);
        border-color: rgba(0, 0, 0, 0.08);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
        color: #18181b;
      }
      .axoltl-slash-light .axoltl-slash-option:hover,
      .axoltl-slash-light .axoltl-slash-option.axoltl-slash-selected {
        background: rgba(0, 0, 0, 0.05);
        color: #000000;
      }
      .axoltl-slash-light .axoltl-slash-icon {
        background: rgba(0, 0, 0, 0.04);
        color: #52525b;
      }
      .axoltl-slash-light .axoltl-slash-desc { color: #71717a; }
    `;
    document.head.appendChild(style);
  }

  function showSlashDropdown(options, caret, editor, prefix) {
    ensureDropdownStyles();
    if (!slashDropdownEl) {
      slashDropdownEl = document.createElement("div");
      slashDropdownEl.id = "axoltl-slash-dropdown";
      document.body.appendChild(slashDropdownEl);
    }

    slashDropdownEl.classList.toggle("axoltl-slash-light", !isDarkBackground(editor));
    slashSelectedIdx = Math.min(slashSelectedIdx, options.length - 1);

    slashDropdownEl.innerHTML = options.map((opt, i) => `
      <div class="axoltl-slash-option ${i === slashSelectedIdx ? "axoltl-slash-selected" : ""}" data-idx="${i}">
        <div class="axoltl-slash-icon">${opt.icon}</div>
        <div class="axoltl-slash-text">
          <span class="axoltl-slash-cmd">${opt.cmd}</span>
          <span class="axoltl-slash-desc">${opt.desc}</span>
        </div>
      </div>
    `).join("");

    slashDropdownEl.style.position = "fixed";
    slashDropdownEl.style.left = `${Math.max(8, caret.x - 8)}px`;
    slashDropdownEl.style.top = "-9999px"; // Measure height
    slashDropdownEl.style.display = "block";
    isActive = true;

    const dropH = slashDropdownEl.offsetHeight || options.length * 52;
    const spaceBelow = window.innerHeight - (caret.y + caret.h);
    const spaceAbove = caret.y;

    if (spaceBelow >= dropH + 8 || spaceAbove < dropH + 8) {
      slashDropdownEl.style.top = `${caret.y + caret.h + 4}px`;
    } else {
      slashDropdownEl.style.top = `${caret.y - dropH - 4}px`;
    }

    // Add click listeners
    slashDropdownEl.querySelectorAll(".axoltl-slash-option").forEach(el => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        executeCommand(options[idx]);
      });
    });
  }

  function dismissSlashDropdown() {
    isActive = false;
    if (slashDropdownEl) slashDropdownEl.style.display = "none";
    slashSelectedIdx = 0;
  }

  function executeCommand(cmd) {
    const editor = inputElement || findEditor();
    dismissSlashDropdown();
    if (editor) clearEditor(editor);
    cmd.action();
  }

  function clearEditor(el) {
    if (el instanceof HTMLTextAreaElement) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, "value"
      )?.set;
      if (nativeSetter) nativeSetter.call(el, "");
      else el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    }
  }

  function handleSlashKeydown(e, editor) {
    if (!isActive || !slashDropdownEl || slashDropdownEl.style.display === "none")
      return false;

    const prefix = getSlashPrefix(editor);
    const options = COMMANDS.filter(o => o.cmd.toLowerCase().includes(prefix.toLowerCase()));
    if (options.length === 0) return false;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      slashSelectedIdx = (slashSelectedIdx + 1) % options.length;
      showSlashDropdown(options, getCaretXY(editor), editor, prefix);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      slashSelectedIdx = (slashSelectedIdx - 1 + options.length) % options.length;
      showSlashDropdown(options, getCaretXY(editor), editor, prefix);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      const selected = options[slashSelectedIdx];
      if (selected) executeCommand(selected);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dismissSlashDropdown();
      return true;
    }
    return false;
  }

  // ─── Command Implementations ──────────────────────────────────────────────

  async function doIngest() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }
    const messages = scrapeCurrentConversation();
    if (!messages.length) { showToast("No conversation found"); return; }

    showToast("Saving conversation...");
    let saved = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        const nextAi = messages.find((m, i) => i > messages.indexOf(msg) && m.role === "assistant");
        try {
          const result = await window.AxoltlMemory.ingest(msg.content, nextAi?.content || "", { source: "manual" });
          if (result) saved++;
        } catch (e) {}
      }
    }
    showToast(`Saved ${saved} memories ⚡`);
  }

  async function doSearch() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }
    const query = prompt("Search memory for:");
    if (!query?.trim()) return;
    const results = await window.AxoltlMemory.search(query.trim(), 10);
    if (!results.length) { showToast("No memories found"); return; }
    
    showSidebar("Search Results", results.map(r => `
      <div style="padding:10px;border-bottom:1px solid #27272a">
        <div style="font-size:11px;color:#71717a;margin-bottom:4px">
          <span style="background:#27272a;color:#a1a1aa;padding:1px 6px;border-radius:4px;font-size:10px">${r.domain || "local"}</span>
          <span style="margin-left:6px">${new Date(r.timestamp).toLocaleDateString()} · Score: ${r.score}</span>
        </div>
        <div style="color:#e4e4e7;font-size:13px"><strong style="color:#10b981">Q:</strong> ${escapeHtml(r.content?.slice(0, 150))}</div>
      </div>
    `).join(""));
  }

  async function doRetrieve() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }
    const query = prompt("Ask memory a question:");
    if (!query?.trim()) return;
    showToast("Thinking...");
    const result = await window.AxoltlMemory.retrieve(query.trim());
    if (!result.answer) { showToast("No answer found"); return; }
    showSidebar("Memory Answer", `<div style="padding:16px;color:#e4e4e7;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(result.answer)}</div>`);
  }

  async function doStats() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }
    const stats = await window.AxoltlMemory.getStats();
    showSidebar("Memory Stats", `
      <div style="padding:16px">
        <div style="font-size:36px;font-weight:700;color:#10b981">${stats.totalMemories}</div>
        <div style="color:#71717a;font-size:13px">Stored local memories</div>
      </div>
    `);
  }

  async function doExport() {
    if (!window.AxoltlMemory) return;
    const data = await window.AxoltlMemory.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `axoltl-memories.json`; a.click();
    URL.revokeObjectURL(url);
  }

  async function doClear() {
    if (!window.AxoltlMemory) return;
    if (confirm("Permanently delete ALL memories?")) {
      await window.AxoltlMemory.clear();
      showToast("Cleared 🗑️");
    }
  }

  // ─── Scraper ──────────────────────────────────────────────────────────────

  function scrapeCurrentConversation() {
    const h = window.location.hostname;
    const messages = [];
    if (h.includes("chatgpt.com")) {
      document.querySelectorAll("[data-message-id]").forEach(n => {
        const role = n.getAttribute("data-message-author-role");
        const text = n.innerText?.trim();
        if (role && text) messages.push({ role: role === "user" ? "user" : "assistant", content: text });
      });
    } else if (h.includes("claude.ai")) {
      document.querySelectorAll('[data-testid*="message"]').forEach(n => {
        const tid = n.getAttribute("data-testid") || "";
        const text = n.innerText?.trim();
        if (text) messages.push({ role: /user/i.test(tid) ? "user" : "assistant", content: text });
      });
    }
    return messages;
  }

  // ─── UI Helpers ───────────────────────────────────────────────────────────

  function showSidebar(title, htmlContent) {
    if (sidebarEl) sidebarEl.remove();
    sidebarEl = document.createElement("div");
    sidebarEl.style.cssText = "position:fixed;top:0;right:0;width:360px;height:100vh;background:#09090b;border-left:1px solid #27272a;z-index:2147483647;display:flex;flex-direction:column;box-shadow:-8px 0 24px rgba(0,0,0,0.5);transform:translateX(100%);transition:transform 0.25s ease";
    sidebarEl.innerHTML = `
      <div style="padding:14px 16px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;color:#e4e4e7;font-size:14px">${title}</span>
        <span id="axoltl-sidebar-close" style="cursor:pointer;color:#71717a;font-size:18px">✕</span>
      </div>
      <div style="flex:1;overflow-y:auto">${htmlContent}</div>
    `;
    document.body.appendChild(sidebarEl);
    requestAnimationFrame(() => sidebarEl.style.transform = "translateX(0)");
    sidebarEl.querySelector("#axoltl-sidebar-close").onclick = () => {
      sidebarEl.style.transform = "translateX(100%)";
      setTimeout(() => sidebarEl.remove(), 250);
    };
  }

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function showToast(msg) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#18181b;color:#10b981;padding:8px 16px;border-radius:8px;border:1px solid #27272a;font-family:sans-serif;font-size:13px;opacity:0;transition:opacity 0.2s";
    document.body.appendChild(t);
    requestAnimationFrame(() => t.style.opacity = "1");
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 200); }, 2500);
  }

  // ─── Input Listeners ──────────────────────────────────────────────────────

  function setupInputListener() {
    EDITOR_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(editor => {
        if (editor.offsetParent === null || editor.dataset.axoltlCmdHooked) return;
        editor.dataset.axoltlCmdHooked = "1";
        
        editor.addEventListener("focus", () => inputElement = editor, true);

        editor.addEventListener("input", () => {
          inputElement = editor;
          const prefix = getSlashPrefix(editor);
          if (prefix) {
            const filtered = COMMANDS.filter(o => o.cmd.toLowerCase().includes(prefix.toLowerCase()));
            if (filtered.length) {
              showSlashDropdown(filtered, getCaretXY(editor), editor, prefix);
            } else {
              dismissSlashDropdown();
            }
          } else {
            dismissSlashDropdown();
          }
        }, true);

        editor.addEventListener("keydown", (e) => {
          if (handleSlashKeydown(e, editor)) return;
          if (e.altKey && (e.key === "x" || e.key === "X")) {
             e.preventDefault(); e.stopPropagation();
             inputElement = editor;
             showSlashDropdown(COMMANDS, getCaretXY(editor), editor, "");
          }
        }, true);
      });
    });
  }

  setInterval(setupInputListener, 1500);
  setupInputListener();
})();
