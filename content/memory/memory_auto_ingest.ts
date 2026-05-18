/** Axoltl Memory Auto-Ingest — Converts conversation turns into memories. TS conversion. */
import { ingestMemory } from './memory_engine';
declare const chrome: any;

const ASSISTANT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  '.font-claude-message',
  'model-response',
  '.prose',
];

export function setupAutoIngest() {
  let lastUserMsg = '';
  let ingestedCount = 0;

  function findUserQuery(): string {
    const sels = ['[data-message-author-role="user"]', 'user-query', '[data-testid="user-message"]'];
    for (const sel of sels) {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      if (nodes.length > 0) {
        const last = nodes[nodes.length - 1];
        const text = last.innerText?.trim() || '';
        if (text.length > 5) return text;
      }
    }
    return '';
  }

  function findLatestResponse(): string {
    for (const sel of ASSISTANT_SELECTORS) {
      const nodes = document.querySelectorAll<HTMLElement>(sel);
      if (nodes.length > 0) {
        const last = nodes[nodes.length - 1];
        return last.innerText?.trim() || '';
      }
    }
    return '';
  }

  const observer = new MutationObserver(async () => {
    const user = findUserQuery();
    if (user === lastUserMsg || user.length < 5) return;
    lastUserMsg = user;

    // Wait for response to stabilize
    let prev = '', stable = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const curr = findLatestResponse();
      if (curr === prev) { stable++; if (stable >= 3) break; }
      else { prev = curr; stable = 0; }
    }

    const response = findLatestResponse();
    if (response.length > 10) {
      const ok = await ingestMemory(user, response, 'low');
      ingestedCount++;
      if (ok) console.log(`[Axoltl] Auto-ingested turn #${ingestedCount}`);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

(window as any).AxoltlAutoIngest = { setupAutoIngest };