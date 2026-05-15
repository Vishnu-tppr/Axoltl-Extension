/**
 * Axoltl Memory Commands — Slash commands for interacting with local memory.
 *
 * Commands:
 *   /Xingest   — Save current visible conversation to memory
 *   /Xsearch   — Search memory and show results
 *   /Xstats    — Show memory statistics
 *   /Xclear    — Clear all memories (with confirmation)
 *   /Xexport   — Download memories as JSON
 */

(function axoltlMemoryCommands() {
  "use strict";

  let inputElement = null;
  let dropdownEl = null;
  let selectedIndex = 0;
  let isActive = false;
  let sidebarEl = null;

  const COMMANDS = [
    { cmd: "/Xingest", desc: "Save this conversation to memory", icon: "💾", action: doIngest },
    { cmd: "/Xsearch", desc: "Search your memory", icon: "🔍", action: doSearch },
    { cmd: "/Xretrieve", desc: "Ask memory a question (LLM answer)", icon: "🧠", action: doRetrieve },
    { cmd: "/Xstats", desc: "Show memory statistics", icon: "📊", action: doStats },
    { cmd: "/Xexport", desc: "Export memories as JSON", icon: "📦", action: doExport },
    { cmd: "/Xclear", desc: "Clear all memories", icon: "🗑️", action: doClear },
  ];

  // ── Editor Detection ──────────────────────────────────────

  const EDITOR_SELECTORS = [
    "#prompt-textarea",
    'div.ProseMirror[contenteditable="true"]',
    'rich-textarea [contenteditable="true"]',
    'rich-textarea > div[contenteditable]',
    'textarea[placeholder*="Ask"]',
    'textarea[placeholder*="ask"]',
    '[contenteditable="true"][data-placeholder]',
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

  // ── Dropdown ──────────────────────────────────────────────

  function createDropdown() {
    if (dropdownEl) dropdownEl.remove();

    dropdownEl = document.createElement("div");
    dropdownEl.id = "axoltl-cmd-dropdown";
    dropdownEl.style.cssText = `
      position: fixed;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.6);
      z-index: 2147483647;
      display: none;
      flex-direction: column;
      width: 280px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    document.body.appendChild(dropdownEl);
  }

  function renderDropdown(filter = "") {
    if (!dropdownEl) createDropdown();
    dropdownEl.innerHTML = "";

    const lf = filter.toLowerCase();
    const filtered = COMMANDS.filter(
      (c) => !lf || c.cmd.toLowerCase().includes(lf) || c.desc.toLowerCase().includes(lf)
    );

    if (!filtered.length) {
      hideDropdown();
      return;
    }

    selectedIndex = Math.min(selectedIndex, filtered.length - 1);

    filtered.forEach((item, idx) => {
      const div = document.createElement("div");
      div.style.cssText = `
        padding: 10px 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: background 0.1s ease;
        background: ${idx === selectedIndex ? "#27272a" : "transparent"};
      `;

      div.innerHTML = `
        <span style="font-size:18px;flex-shrink:0">${item.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:#10b981;font-size:13px">${item.cmd}</div>
          <div style="font-size:11px;color:#71717a;margin-top:1px">${item.desc}</div>
        </div>
      `;

      div.onmouseover = () => {
        selectedIndex = idx;
        renderDropdown(filter);
      };
      div.onclick = (e) => {
        e.preventDefault();
        executeCommand(filtered[idx]);
      };
      dropdownEl.appendChild(div);
    });

    // Position above editor
    const editor = inputElement || findEditor();
    if (editor) {
      const rect = editor.getBoundingClientRect();
      dropdownEl.style.left = `${rect.left}px`;
      dropdownEl.style.top = `${Math.max(8, rect.top - dropdownEl.offsetHeight - 10)}px`;
    }

    dropdownEl.style.display = "flex";
    isActive = true;
  }

  function hideDropdown() {
    isActive = false;
    if (dropdownEl) dropdownEl.style.display = "none";
  }

  function executeCommand(cmd) {
    hideDropdown();
    clearEditor(inputElement || findEditor());
    cmd.action();
  }

  // ── Command Implementations ───────────────────────────────

  async function doIngest() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }

    // Scrape the current page for conversation
    const messages = scrapeCurrentConversation();
    if (!messages.length) {
      showToast("No conversation found to save");
      return;
    }

    showToast("Saving conversation to memory...");
    let saved = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        const nextAi = messages.find(
          (m, i) => i > messages.indexOf(msg) && m.role === "assistant"
        );
        try {
          const result = await window.AxoltlMemory.ingest(
            msg.content,
            nextAi?.content || "",
            { source: "manual" }
          );
          if (result) saved++;
        } catch (e) { /* skip duplicates */ }
      }
    }
    showToast(`Saved ${saved} new memories ⚡`);
  }

  async function doSearch() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }

    const query = prompt("Search your memory for:");
    if (!query?.trim()) return;

    const results = await window.AxoltlMemory.search(query.trim(), 10);
    if (!results.length) {
      showToast("No memories found for: " + query);
      return;
    }

    const domainColors = {
      profile: "#f59e0b",
      temporal: "#8b5cf6",
      summary: "#06b6d4",
      code: "#22c55e",
      snippet: "#ec4899",
    };

    showSidebar("Search Results", results.map((r, i) => {
      const domain = r.domain || r.provider || "local";
      const domainColor = domainColors[domain] || "#71717a";
      const isServer = r.source === "xmem-server";
      return `
      <div style="padding:10px;border-bottom:1px solid #27272a">
        <div style="font-size:11px;color:#71717a;margin-bottom:4px;display:flex;align-items:center;gap:6px">
          <span style="background:${domainColor}22;color:${domainColor};padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600">${domain}</span>
          ${isServer ? '<span style="color:#10b981;font-size:10px">server</span>' : ''}
          <span>${r.provider || domain} · ${new Date(r.timestamp).toLocaleDateString()} · Score: ${r.score}</span>
        </div>
        <div style="color:#e4e4e7;font-size:13px;line-height:1.5">
          <strong style="color:#10b981">Q:</strong> ${escapeHtml(r.userQuery?.slice(0, 150) || r.content?.slice(0, 150) || "—")}
        </div>
        ${r.aiResponse ? `<div style="color:#a1a1aa;font-size:12px;margin-top:4px;line-height:1.4">
          <strong>A:</strong> ${escapeHtml(r.aiResponse.slice(0, 200))}${r.aiResponse.length > 200 ? "…" : ""}
        </div>` : ""}
      </div>
    `;
    }).join(""));
  }

  async function doRetrieve() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }

    const query = prompt("Ask your memory a question:");
    if (!query?.trim()) return;

    showToast("Thinking...");
    const result = await window.AxoltlMemory.retrieve(query.trim());

    if (!result.answer) {
      showToast("No answer found in memory for: " + query);
      return;
    }

    const sourceHtml = (result.sources || []).map((s) => {
      const domain = s.domain || "local";
      return `
        <div style="padding:8px;border-bottom:1px solid #1e1e22">
          <span style="background:#27272a;color:#a1a1aa;padding:1px 6px;border-radius:4px;font-size:10px">${domain}</span>
          <span style="color:#71717a;font-size:11px;margin-left:6px">score: ${s.score || ""}</span>
          <div style="color:#a1a1aa;font-size:12px;margin-top:4px">${escapeHtml((s.content || "").slice(0, 150))}</div>
        </div>
      `;
    }).join("");

    showSidebar("❁ Memory Answer", `
      <div style="padding:16px">
        <div style="color:#71717a;font-size:11px;margin-bottom:8px">
          ${result.fromServer ? '⚡ via XMem server' : '💾 local memory'}
          ${result.confidence ? ` · confidence: ${Math.round(result.confidence * 100)}%` : ""}
          ${result.model ? ` · model: ${result.model}` : ""}
        </div>
        <div style="color:#e4e4e7;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(result.answer)}</div>
        ${sourceHtml ? `<div style="margin-top:16px;border-top:1px solid #27272a;padding-top:12px">
          <div style="color:#71717a;font-size:11px;margin-bottom:8px">Sources</div>
          ${sourceHtml}
        </div>` : ""}
      </div>
    `);
  }

  async function doStats() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }

    const stats = await window.AxoltlMemory.getStats();
    const providers = Object.entries(stats.byProvider || {})
      .map(([p, n]) => `${p}: ${n}`)
      .join(" · ") || "No data";

    // Check server status
    const serverConnected = await window.AxoltlMemory.isServerConnected();
    const serverStatusHtml = serverConnected
      ? '<span style="color:#10b981">● Connected</span>'
      : '<span style="color:#ef4444">○ Offline</span>';

    showSidebar("Memory Stats", `
      <div style="padding:16px">
        <div style="font-size:36px;font-weight:700;color:#10b981;margin-bottom:4px">${stats.totalMemories}</div>
        <div style="color:#71717a;font-size:13px;margin-bottom:16px">Total local memories stored</div>

        <div style="background:#27272a;padding:10px;border-radius:8px;margin-bottom:16px;display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:#71717a">❁ XMem Server:</span>
          ${serverStatusHtml}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:#27272a;padding:10px;border-radius:8px">
            <div style="color:#71717a;font-size:11px">Oldest</div>
            <div style="color:#e4e4e7;font-size:13px;margin-top:2px">${stats.oldestDate || "—"}</div>
          </div>
          <div style="background:#27272a;padding:10px;border-radius:8px">
            <div style="color:#71717a;font-size:11px">Newest</div>
            <div style="color:#e4e4e7;font-size:13px;margin-top:2px">${stats.newestDate || "—"}</div>
          </div>
        </div>

        <div style="color:#71717a;font-size:11px;margin-bottom:4px">By Provider</div>
        <div style="color:#e4e4e7;font-size:13px">${providers}</div>
      </div>
    `);
  }

  async function doExport() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }

    showToast("Preparing export...");
    const data = await window.AxoltlMemory.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `axoltl-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${data.count} memories 📦`);
  }

  async function doClear() {
    if (!window.AxoltlMemory) { showToast("Memory engine not ready"); return; }

    const sure = confirm(
      "This will permanently delete ALL your Axoltl memories.\n\nContinue?"
    );
    if (!sure) return;

    await window.AxoltlMemory.clear();
    showToast("All memories cleared 🗑️");
  }

  // ── Conversation Scraper (provider-agnostic) ──────────────

  function scrapeCurrentConversation() {
    const h = window.location.hostname;
    const messages = [];

    // Try provider-specific selectors first
    if (h.includes("chatgpt.com") || h.includes("openai.com")) {
      document.querySelectorAll("[data-message-id]").forEach((n) => {
        const role = n.getAttribute("data-message-author-role");
        const text = n.innerText?.trim();
        if (role && text) messages.push({ role: role === "user" ? "user" : "assistant", content: text });
      });
    } else if (h.includes("claude.ai")) {
      document.querySelectorAll('[data-testid*="message"], [data-testid*="conversation-turn"]').forEach((n) => {
        const tid = n.getAttribute("data-testid") || "";
        const text = n.innerText?.trim();
        if (text) messages.push({ role: /user|human/i.test(tid) ? "user" : "assistant", content: text });
      });
    } else if (h.includes("gemini.google.com")) {
      const uq = document.querySelectorAll("user-query, [class*='user-query']");
      const mr = document.querySelectorAll("model-response, [class*='model-response']");
      const turns = [];
      uq.forEach(n => { const t = n.innerText?.trim(); if (t) turns.push({ role: "user", content: t, top: n.getBoundingClientRect().top }); });
      mr.forEach(n => { const t = n.innerText?.trim(); if (t) turns.push({ role: "assistant", content: t, top: n.getBoundingClientRect().top }); });
      turns.sort((a, b) => a.top - b.top);
      turns.forEach(t => messages.push({ role: t.role, content: t.content }));
    } else if (h.includes("perplexity.ai")) {
      document.querySelectorAll('[class*="QueryText"], [class*="query-text"]').forEach((n) => {
        const t = n.innerText?.trim();
        if (t) messages.push({ role: "user", content: t });
      });
      document.querySelectorAll('[class*="AnswerText"], [class*="answer-text"], .prose').forEach((n) => {
        const t = n.innerText?.trim();
        if (t && t.length > 10) messages.push({ role: "assistant", content: t });
      });
    }

    // Generic fallback
    if (!messages.length) {
      const main = document.querySelector("main, [role='main']");
      if (main) {
        Array.from(main.children).forEach((n, i) => {
          const t = n.innerText?.trim();
          if (t && t.length > 5) {
            messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: t });
          }
        });
      }
    }

    return messages;
  }

  // ── Sidebar Panel ─────────────────────────────────────────

  function showSidebar(title, htmlContent) {
    if (sidebarEl) sidebarEl.remove();

    sidebarEl = document.createElement("div");
    sidebarEl.id = "axoltl-sidebar";
    sidebarEl.style.cssText = `
      position: fixed;
      top: 0; right: 0;
      width: 360px; height: 100vh;
      background: #09090b;
      border-left: 1px solid #27272a;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: -8px 0 24px rgba(0,0,0,0.5);
      transform: translateX(100%);
      transition: transform 0.25s ease;
    `;

    sidebarEl.innerHTML = `
      <div style="padding:14px 16px;border-bottom:1px solid #27272a;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:18px">🦎</span>
          <span style="font-weight:700;color:#e4e4e7;font-size:14px">${escapeHtml(title)}</span>
        </div>
        <div id="axoltl-sidebar-close" style="cursor:pointer;color:#71717a;font-size:18px;padding:4px 8px;border-radius:4px;transition:background 0.1s">✕</div>
      </div>
      <div style="flex:1;overflow-y:auto">${htmlContent}</div>
    `;

    document.body.appendChild(sidebarEl);
    requestAnimationFrame(() => { sidebarEl.style.transform = "translateX(0)"; });

    sidebarEl.querySelector("#axoltl-sidebar-close").onclick = () => {
      sidebarEl.style.transform = "translateX(100%)";
      setTimeout(() => { sidebarEl.remove(); sidebarEl = null; }, 250);
    };
  }

  // ── Utilities ─────────────────────────────────────────────

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

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

  // ── Input Listener ────────────────────────────────────────

  function setupInputListener() {
    EDITOR_SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(editor => {
        if (editor.offsetParent === null) return; // ignore hidden
        if (editor.dataset.axoltlCmdHooked) return;
        
        editor.dataset.axoltlCmdHooked = "1";
        
        // Track the active editor
        editor.addEventListener("focus", () => {
          inputElement = editor;
        }, true);

        // Capture phase to ensure React/frameworks don't swallow the event
        editor.addEventListener("input", () => {
          inputElement = editor; // ensure we use this editor
          const text = readEditorText(editor).trim();
          const words = text.split(/\s+/);
          const lastWord = words[words.length - 1] || "";

          if (lastWord.startsWith("/X") || lastWord.startsWith("/x")) {
            renderDropdown(lastWord);
          } else {
            hideDropdown();
          }
        }, true);

        editor.addEventListener("keydown", (e) => {
          if (!isActive) return;

          // Provide filter logic using the last typed word
          const text = readEditorText(editor).trim();
          const words = text.split(/\s+/);
          const lastWord = words[words.length - 1] || "";
          const lf = (lastWord.startsWith("/X") || lastWord.startsWith("/x")) ? lastWord.toLowerCase() : "";
          
          const filtered = COMMANDS.filter(
            (c) => !lf || c.cmd.toLowerCase().includes(lf) || c.desc.toLowerCase().includes(lf)
          );

          if (!filtered.length) {
            hideDropdown();
            return;
          }

          if (e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            selectedIndex = (selectedIndex + 1) % filtered.length;
            renderDropdown(lastWord);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
            renderDropdown(lastWord);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            e.stopPropagation();
            executeCommand(filtered[selectedIndex]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            hideDropdown();
          }
        }, true);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────

  createDropdown();
  setInterval(setupInputListener, 1500);
  setTimeout(setupInputListener, 800);
})();
