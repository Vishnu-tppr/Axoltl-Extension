/** Axoltl — chatgpt.com / chat.openai.com DOM watcher. TS conversion. */
declare const chrome: any;

export function setupOpenaiScraper(): MutationObserver {
  const observer = new MutationObserver(() => {
    const messages: Array<{ role: string; content: string }> = [];
    document.querySelectorAll('[data-message-author-role]').forEach(el => {
      const text = (el as HTMLElement).innerText?.trim();
      if (!text) return;
      const role = el.getAttribute('data-message-author-role') || '';
      messages.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
    });
    if (messages.length > 0)
      chrome.storage.session.set({ activeSession: { provider: 'chatgpt', messages, messageCount: messages.length, updatedAt: Date.now() } });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return observer;
}