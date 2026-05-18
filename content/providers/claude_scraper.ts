/** Axoltl — claude.ai DOM MutationObserver. TS conversion. */

declare const chrome: any;

export function setupClaudeScraper(): MutationObserver {
  const observer = new MutationObserver(() => {
    const messages: Array<{ role: string; content: string }> = [];
    const articleEls = document.querySelectorAll('[data-testid="user-message"], .font-claude-message');
    articleEls.forEach(el => {
      const text = (el as HTMLElement).innerText?.trim();
      if (!text) return;
      const role = el.matches('[data-testid="user-message"]') ? 'user' : 'assistant';
      messages.push({ role, content: text });
    });
    if (messages.length > 0) {
      chrome.storage.session.set({ activeSession: { provider: 'claude', messages, messageCount: messages.length, updatedAt: Date.now() } });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  console.log('[Axoltl] Claude scraper initialized');
  return observer;
}