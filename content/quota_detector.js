/**
 * Axoltl — Quota Detector
 *
 * Detects when an AI provider shows a usage limit / quota wall.
 * Debounced, provider-specific, with false-positive prevention.
 *
 * Improvements over the original:
 *   - Debounced (500ms minimum between checks)
 *   - Checks for quota UI containers, not arbitrary body text
 *   - Ignores text inside AI response bubbles (prevents false positives)
 *   - Provider-specific detection with targeted selectors
 */

(function axoltlQuotaDetector() {
  "use strict";

  const DEBOUNCE_MS = 500;
  let debounceTimer = null;
  let lastQuotaFiredAt = 0;
  const COOLDOWN_MS = 30000; // Don't fire more than once per 30s

  // ── Provider detection ─────────────────────────────────

  function detectProvider() {
    const h = location.hostname;
    if (h.includes("claude.ai")) return "claude";
    if (h.includes("chatgpt.com") || h.includes("chat.openai.com")) return "openai";
    if (h.includes("gemini.google.com")) return "gemini";
    if (h.includes("perplexity.ai")) return "perplexity";
    return "unknown";
  }

  // ── Provider-specific quota detection ──────────────────

  const QUOTA_STRATEGIES = {
    claude: {
      // Claude shows a modal/banner when limit is hit
      selectors: [
        "[class*='rate-limit']",
        "[class*='usage-limit']",
        "[class*='RateLimit']",
        "[class*='UsageLimit']",
        "[role='dialog'][class*='limit']",
        "[role='alertdialog']",
      ],
      textPatterns: [
        /you.ve (hit|reached) (your|the) (free |)(usage |message |)limit/i,
        /rate limit(ed)?/i,
        /too many (messages|requests)/i,
        /usage cap/i,
        /come back (in|at|after)/i,
        /limit resets? (in|at)/i,
      ],
    },
    openai: {
      selectors: [
        "[class*='rate-limit']",
        "[class*='usage-cap']",
        "[role='dialog']",
        "[role='alertdialog']",
      ],
      textPatterns: [
        /you.ve (hit|reached) the (current )?usage cap/i,
        /too many (messages|requests) in/i,
        /rate limit/i,
        /please try again (later|in)/i,
        /upgrade to (plus|pro|team)/i,
        /message limit/i,
      ],
    },
    gemini: {
      selectors: [
        "[class*='error-message']",
        "[class*='limit-reached']",
        "[role='alert']",
      ],
      textPatterns: [
        /daily limit reached/i,
        /too many requests/i,
        /try again (later|in|after)/i,
        /quota exceeded/i,
        /rate limit/i,
      ],
    },
    perplexity: {
      selectors: [
        "[class*='rate-limit']",
        "[class*='upgrade']",
        "[role='dialog']",
      ],
      textPatterns: [
        /you.ve reached/i,
        /upgrade to pro/i,
        /rate limit/i,
        /too many (queries|requests|searches)/i,
        /daily (search |query |)limit/i,
      ],
    },
  };

  // ── Selectors for "AI response bubbles" to EXCLUDE ─────

  const RESPONSE_SELECTORS = [
    "[data-message-author-role='assistant']",
    ".font-claude-message",
    "[class*='AssistantMessage']",
    ".markdown",
    ".prose",
    "model-response",
    "[class*='response-content']",
    "[class*='AnswerText']",
    "[class*='answer-text']",
    "code",
    "pre",
  ].join(", ");

  // ── Core detection logic ───────────────────────────────

  function isInsideResponse(element) {
    // Walk up the DOM to check if this element is inside an AI response
    let current = element;
    while (current && current !== document.body) {
      if (current.matches && current.matches(RESPONSE_SELECTORS)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function checkForQuota() {
    const provider = detectProvider();
    if (provider === "unknown") return;

    const config = QUOTA_STRATEGIES[provider];
    if (!config) return;

    // Cooldown check
    if (Date.now() - lastQuotaFiredAt < COOLDOWN_MS) return;

    // Strategy 1: Check for quota-specific UI elements
    for (const sel of config.selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetHeight > 0 && !isInsideResponse(el)) {
          fireQuotaHit(provider);
          return;
        }
      } catch (e) {}
    }

    // Strategy 2: Check for quota text in non-response areas
    // Only check dialogs, banners, alerts — NOT the entire body
    const quotaContainers = document.querySelectorAll(
      "[role='dialog'], [role='alert'], [role='alertdialog'], [role='banner'], " +
      "[class*='modal'], [class*='banner'], [class*='notification'], [class*='toast'], " +
      "[class*='error'], [class*='warning']"
    );

    for (const container of quotaContainers) {
      if (isInsideResponse(container)) continue;

      const text = container.innerText || "";
      for (const pattern of config.textPatterns) {
        if (pattern.test(text)) {
          fireQuotaHit(provider);
          return;
        }
      }
    }
  }

  function fireQuotaHit(provider) {
    lastQuotaFiredAt = Date.now();
    chrome.runtime.sendMessage({
      type: "AXOLTL_QUOTA_HIT",
      payload: { provider, detectedAt: Date.now() },
    });
  }

  // ── Debounced observer ───────────────────────────────────

  function onDomChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkForQuota, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(onDomChange);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Initial check after page load
  setTimeout(checkForQuota, 3000);
})();
