/**
 * Axoltl — Perplexity (perplexity.ai) Conversation Scraper
 *
 * Captures conversation messages from perplexity.ai using
 * query/answer block selectors and structural fallbacks.
 */

(function axoltlPerplexityScraper() {
  "use strict";

  const PROVIDER = "perplexity";
  const MAX_MESSAGES = 50;
  const DEBOUNCE_MS = 800;
  let debounceTimer = null;
  let lastHash = "";

  function strategyQueryAnswer() {
    // Perplexity separates user queries from AI answers with distinct containers
    const queries = document.querySelectorAll(
      '[class*="QueryText"], [class*="query-text"], [class*="UserQuery"], [data-testid*="query"]'
    );
    const answers = document.querySelectorAll(
      '[class*="AnswerText"], [class*="answer-text"], [class*="AnswerBlock"], .prose, [data-testid*="answer"]'
    );
    if (!queries.length && !answers.length) return null;

    const turns = [];
    queries.forEach(n => {
      const t = n.innerText?.trim();
      if (t && t.length >= 2) turns.push({ role: "user", content: t, top: n.getBoundingClientRect().top });
    });
    answers.forEach(n => {
      const t = n.innerText?.trim();
      if (t && t.length >= 5) turns.push({ role: "assistant", content: t, top: n.getBoundingClientRect().top });
    });
    turns.sort((a, b) => a.top - b.top);
    const msgs = turns.map(t => ({ role: t.role, content: t.content }));
    return msgs.length >= 2 ? msgs : null;
  }

  function strategyThreadBlocks() {
    // Perplexity threads show as sequential blocks in a scrollable container
    const blocks = document.querySelectorAll(
      '[class*="ThreadBlock"], [class*="thread-block"], [class*="ConversationPair"]'
    );
    if (blocks.length < 1) return null;

    const msgs = [];
    blocks.forEach(block => {
      // Each block typically contains a question then an answer
      const children = Array.from(block.children).filter(c => c.innerText?.trim().length > 2);
      if (children.length >= 2) {
        msgs.push({ role: "user", content: children[0].innerText.trim() });
        msgs.push({ role: "assistant", content: children[1].innerText.trim() });
      } else if (children.length === 1) {
        msgs.push({ role: "assistant", content: children[0].innerText.trim() });
      }
    });
    return msgs.length >= 2 ? msgs : null;
  }

  function strategyFallback() {
    const main = document.querySelector("main, [role='main'], [class*='thread']");
    if (!main) return null;
    const kids = Array.from(main.querySelectorAll(":scope > div, :scope > section")).filter(el => {
      const t = el.innerText?.trim();
      return t && t.length > 10 && el.offsetHeight > 30;
    });
    if (kids.length < 2) return null;
    return kids.map((n, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: n.innerText.trim() }));
  }

  function collect() {
    for (const fn of [strategyQueryAnswer, strategyThreadBlocks, strategyFallback]) {
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
