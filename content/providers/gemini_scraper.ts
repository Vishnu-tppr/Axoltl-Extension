/** Axoltl — gemini.google.com DOM watcher. TS conversion. */
declare const chrome: any;

export function setupGeminiScraper(): MutationObserver {
  const observer = new MutationObserver(() => {
    const messages: Array<{ role: string; content: string }> = [];
    document.querySelectorAll('model-response, user-query').forEach(el => {
      const text = (el as HTMLElement).innerText?.trim();
      if (!text) return;
      const role = el.tagName.toLowerCase() === 'user-query' ? 'user' : 'assistant';
      messages.push({ role, content: text });
    });
    if (messages.length > 0)
      chrome.storage.session.set({ activeSession: { provider: 'gemini', messages, messageCount: messages.length, updatedAt: Date.now() } });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return observer;
}