/** Axoltl — perplexity.ai DOM watcher. TS conversion. */
declare const chrome: any;

export function setupPerplexityScraper(): MutationObserver {
  const observer = new MutationObserver(() => {
    const messages: Array<{ role: string; content: string }> = [];
    document.querySelectorAll('.prose, [data-testid="thread-user-query"], [data-testid="thread-ai-answer"]').forEach(el => {
      const text = (el as HTMLElement).innerText?.trim();
      if (!text) return;
      const role = el.matches('[data-testid="thread-user-query"]') ? 'user' : 'assistant';
      messages.push({ role, content: text });
    });
    if (messages.length > 0)
      chrome.storage.session.set({ activeSession: { provider: 'perplexity', messages, messageCount: messages.length, updatedAt: Date.now() } });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return observer;
}