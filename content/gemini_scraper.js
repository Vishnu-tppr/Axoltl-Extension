/**
 * Axoltl — Gemini (gemini.google.com) Conversation Scraper
 *
 * Captures conversation messages from Gemini using web component
 * selectors, ARIA roles, and structural fallbacks.
 */

(function axoltlGeminiScraper() {
  "use strict";

  const PROVIDER = "gemini";
  const MAX_MESSAGES = 50;
  const DEBOUNCE_MS = 800;
  let debounceTimer = null;
  let lastHash = "";

  function strategyWebComponents() {
    const userQ = document.querySelectorAll("user-query, [class*='user-query'], [class*='query-content']");
    const modelR = document.querySelectorAll("model-response, [class*='model-response'], [class*='response-content']");
    if (!userQ.length && !modelR.length) return null;
    const turns = [];
    userQ.forEach(n => {
      const t = n.innerText?.trim();
      if (t && t.length >= 2) turns.push({ role: "user", content: t, top: n.getBoundingClientRect().top });
    });
    modelR.forEach(n => {
      const t = n.innerText?.trim();
      if (t && t.length >= 2) turns.push({ role: "assistant", content: t, top: n.getBoundingClientRect().top });
    });
    turns.sort((a, b) => a.top - b.top);
    const msgs = turns.map(t => ({ role: t.role, content: t.content }));
    return msgs.length >= 2 ? msgs : null;
  }

  function strategyAria() {
    const turns = document.querySelectorAll('[data-turn-id], [aria-label*="message"], [aria-label*="response"]');
    if (turns.length < 2) return null;
    const msgs = [];
    turns.forEach(n => {
      const t = n.innerText?.trim();
      if (!t || t.length < 2) return;
      const lbl = (n.getAttribute("aria-label") || "").toLowerCase();
      const isUser = /user|you|query|prompt/i.test(lbl);
      msgs.push({ role: isUser ? "user" : "assistant", content: t });
    });
    return msgs.length >= 2 ? msgs : null;
  }

  function strategyFallback() {
    const main = document.querySelector("main, [role='main'], [class*='chat-container']");
    if (!main) return null;
    const kids = Array.from(main.querySelectorAll(":scope > div")).filter(el => {
      const t = el.innerText?.trim();
      return t && t.length > 10 && el.offsetHeight > 30;
    });
    if (kids.length < 2) return null;
    return kids.map((n, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: n.innerText.trim() }));
  }

  function collect() {
    for (const fn of [strategyWebComponents, strategyAria, strategyFallback]) {
      try { const r = fn(); if (r?.length >= 2) return r.slice(-MAX_MESSAGES); } catch (e) {}
    }
    return [];
  }

  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return String(h); }

  function publish() {
    const msgs = collect();
    if (!msgs.length) return;
    const h = hash(JSON.stringify(msgs));
    if (h === lastHash) return;
    lastHash = h;
    chrome.runtime.sendMessage({
      type: "AXOLTL_SESSION_UPDATE",
      payload: { provider: PROVIDER, updatedAt: Date.now(), messageCount: msgs.length, messages: msgs }
    });
  }

  const obs = new MutationObserver(() => { clearTimeout(debounceTimer); debounceTimer = setTimeout(publish, DEBOUNCE_MS); });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(publish, 2000);
})();
