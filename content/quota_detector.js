const QUOTA_PATTERNS = {
  claude: [/you\'ve reached your limit/i, /rate limit/i],
  openai: [/you\'ve reached the current usage cap/i, /too many requests/i],
  gemini: [/daily limit reached/i, /try again later/i]
};

function detectProvider() {
  if (location.hostname.includes("claude.ai")) return "claude";
  if (location.hostname.includes("chatgpt.com")) return "openai";
  if (location.hostname.includes("gemini.google.com")) return "gemini";
  return "unknown";
}

function scanForQuotaHits() {
  const provider = detectProvider();
  const patterns = QUOTA_PATTERNS[provider] || [];
  const text = document.body?.innerText || "";
  const hit = patterns.find((rx) => rx.test(text));
  if (!hit) return;
  chrome.runtime.sendMessage({
    action: "QUOTA_HIT",
    provider
  });
}

new MutationObserver(scanForQuotaHits).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true
});

scanForQuotaHits();
