/** Axoltl Quota Detector — Detects AI provider rate-limit / quota walls. TS conversion. */

declare const chrome: any;

const QUOTA_PATTERNS: Record<string, RegExp[]> = {
  claude: [/limit.{0,20}reach/i, /you've reached/i, /try again/i, /out of (free )?messages/i, /free plan/i, /usage limit/i],
  chatgpt: [/limit.{0,20}reach/i, /you've reached/i, /try again/i, /upgrade/i, /too many requests/i],
  gemini: [/limit.{0,20}reach/i, /try again later/i, /rate limit/i],
};

function detectQuota(text: string, provider: string): boolean {
  const patterns = QUOTA_PATTERNS[provider] || QUOTA_PATTERNS.claude;
  return patterns.some(p => p.test(text));
}

export function setupQuotaDetection(provider: string): MutationObserver {
  const observer = new MutationObserver(() => {
    const body = document.body?.innerText || '';
    if (detectQuota(body, provider)) {
      chrome.runtime.sendMessage({ action: 'QUOTA_HIT', provider });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return observer;
}