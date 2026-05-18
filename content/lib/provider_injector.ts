/** Axoltl Provider Injector — Injects context into AI provider input fields. TS conversion. */

const INPUT_SELECTORS: Record<string, string[]> = {
  claude: ['div.ProseMirror[contenteditable="true"]','[contenteditable="true"][data-placeholder]','fieldset [contenteditable="true"]','div[contenteditable="true"]','textarea'],
  chatgpt: ['#prompt-textarea','div[contenteditable="true"][data-placeholder]','textarea'],
  gemini: ['rich-textarea [contenteditable="true"]','rich-textarea > div[contenteditable]','div[contenteditable="true"][aria-label*="prompt"]','textarea'],
  perplexity: ['textarea[placeholder*="Ask"]','textarea[placeholder*="ask"]','[contenteditable="true"]','textarea'],
};

function showToast(msg: string, bg: string) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;background:${bg};color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-family:-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.3)`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

export function injectContext(text: string, provider: string): Promise<boolean> {
  return new Promise(resolve => {
    let attempts = 0;
    const maxAttempts = 15;
    const interval = setInterval(() => {
      attempts++;
      const selectors = INPUT_SELECTORS[provider] || INPUT_SELECTORS.claude;
      let input: HTMLElement | null = null;
      for (const sel of selectors) {
        const el = document.querySelector<HTMLElement>(sel);
        if (el && el.offsetHeight > 0) { input = el; break; }
      }
      if (input) {
        clearInterval(interval);
        input.focus();
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch {}
        if (!ok) {
          if (input instanceof HTMLTextAreaElement) {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.textContent = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        showToast('\u{1F98E} Context injected! Press Enter.', '#065f46');
        resolve(true);
        return;
      }
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        navigator.clipboard.writeText(text)
          .then(() => showToast('\u{1F4CB} Copied! Ctrl+V.', '#1e3a5f'))
          .catch(() => showToast('\u26A0 Could not inject.', '#78350f'));
        resolve(false);
      }
    }, 1000);
  });
}

(window as any).AxoltlInjector = { injectContext };