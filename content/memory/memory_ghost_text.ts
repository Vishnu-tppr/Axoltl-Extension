/** Axoltl Memory Ghost Text — Real-time autocomplete overlay. TS conversion. */
import { searchMemory } from './memory_engine';
import { compress } from '../lib/context_compressor';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 5;
const MAX_GHOST_CHARS = 160;

let ghostEl: HTMLElement | null = null;
let ghostAnswer = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let prevQueryText = '';
let chipEl: HTMLElement | null = null;

const EDITORS = ['#prompt-textarea','div.ProseMirror[contenteditable="true"]','div[contenteditable="true"]','textarea[placeholder]','textarea'];

function findEditor(): HTMLElement | null {
  for (const sel of EDITORS) { const el = document.querySelector<HTMLElement>(sel); if (el?.offsetParent) return el; }
  return null;
}

function dismiss() { ghostEl?.remove(); ghostEl = null; ghostAnswer = ''; }

function show(answer: string, caret: { x: number; y: number; h: number }, editor: HTMLElement) {
  dismiss(); ghostAnswer = answer;
  const d = answer.length > MAX_GHOST_CHARS ? answer.slice(0, MAX_GHOST_CHARS).trimEnd() + '\u2026' : answer;
  ghostEl = document.createElement('div');
  ghostEl.textContent = d;
  const cs = getComputedStyle(editor);
  ghostEl.style.cssText = `position:fixed;left:${caret.x}px;top:${caret.y}px;font-family:${cs.fontFamily};font-size:${cs.fontSize};color:rgba(79,196,183,0.35);pointer-events:none;z-index:2147483647;white-space:nowrap`;
  document.body.appendChild(ghostEl);
}

function accept(): boolean {
  if (!ghostAnswer) return false;
  const ed = findEditor();
  if (!ed) return false;
  if (ed instanceof HTMLTextAreaElement) {
    const pos = ed.selectionEnd;
    ed.value = ed.value.slice(0, pos) + ghostAnswer + ed.value.slice(pos);
    ed.selectionStart = ed.selectionEnd = pos + ghostAnswer.length;
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  } else { ed.focus(); document.execCommand('insertText', false, ghostAnswer); }
  dismiss(); return true;
}

export async function runAutocomplete(query: string, editor: HTMLElement) {
  if (query.length < MIN_QUERY_LEN || query === prevQueryText) return;
  prevQueryText = query;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const results = await searchMemory(query, 5);
    dismiss();
    if (results.length > 0 && results[0].score >= 0.35) {
      const rect = editor.getBoundingClientRect();
      const cs = getComputedStyle(editor);
      const caret = { x: rect.left + 8, y: rect.top + 8, h: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 };
      show(results[0].content, caret, editor);
    }
  }, DEBOUNCE_MS);
}

export function dismissGhost() { dismiss(); }

document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (ghostEl && e.key === 'Tab') { e.preventDefault(); accept(); }
  if (ghostEl && e.key === 'Escape') { dismiss(); }
});

(window as any).AxoltlGhostText = { runAutocomplete, dismissGhost, accept };