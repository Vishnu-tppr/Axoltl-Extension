/** Axoltl Memory Commands — Slash commands: /recall, /forget, /search. TS conversion. */
import { searchMemory, ingestMemory } from './memory_engine';
declare const chrome: any;

const SLASH_COMMANDS = ['/recall', '/search', '/forget', '/help'] as const;

export function setupSlashCommands(editor: HTMLElement) {
  editor.addEventListener('keydown', (e: KeyboardEvent) => {
    const text = (editor as HTMLTextAreaElement).value || editor.textContent || '';
    if (!text.startsWith('/')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = text.trim().split(' ')[0];
      if (SLASH_COMMANDS.includes(cmd as any)) executeCommand(cmd, text.slice(cmd.length).trim(), editor);
    }
  });
}

async function executeCommand(cmd: string, rest: string, editor: HTMLElement) {
  switch (cmd) {
    case '/recall': {
      const results = await searchMemory(rest, 5);
      const out = results.length ? results.map(r => `[${r.domain}] ${r.content}`).join('\n') : 'No memories found.';
      insertResponse(editor, out);
      break;
    }
    case '/forget': {
      chrome.storage.sync.clear();
      insertResponse(editor, 'Memory cleared.');
      break;
    }
    case '/search': {
      const results = await searchMemory(rest, 10);
      const out = results.length ? results.map(r => `[${r.domain}] ${r.content}`).join('\n') : 'No matches.';
      insertResponse(editor, out);
      break;
    }
    case '/help': {
      insertResponse(editor, 'Commands: /recall <q>, /search <q>, /forget, /help');
      break;
    }
  }
}

function insertResponse(editor: HTMLElement, text: string) {
  if (editor instanceof HTMLTextAreaElement) {
    const pos = editor.selectionEnd;
    editor.value = editor.value.slice(0, pos) + '\n' + text + editor.value.slice(pos);
    editor.selectionStart = editor.selectionEnd = pos + text.length + 1;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    editor.focus();
    document.execCommand('insertText', false, '\n' + text);
  }
}

(window as any).AxoltlMemoryCommands = { setupSlashCommands };