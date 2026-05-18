/** Axoltl Content Script — Ghost text, slash commands, IDE panel, highlight, ingest banners. TS conversion. */

const Z_HIGHEST = '2147483647';
const DEBOUNCE_MS = 600;
const MIN_QUERY_LEN = 8;
const MAX_GHOST_CHARS = 150;
const MIN_RELEVANCE = 0.4;

type Mode = 'ingest' | 'search' | 'repo';

const EDITORS = ['#prompt-textarea','div.ProseMirror[contenteditable="true"]','div[contenteditable="true"]','textarea[placeholder]','rich-textarea textarea','textarea'];

const AX_CSS = `.axoltl-ghost{display:inline-flex;align-items:center;gap:8px;opacity:0;animation:axoltl-ghost-appear .2s ease forwards;white-space:nowrap;overflow:hidden}
.axoltl-ghost-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.axoltl-dark .axoltl-ghost-text{color:rgba(79,196,183,.35)}
.axoltl-light .axoltl-ghost-text{color:rgba(1,105,111,.4)}
.axoltl-ghost-tab{flex-shrink:0;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap}
.axoltl-dark .axoltl-ghost-tab{background:rgba(79,196,183,.12);color:rgba(79,196,183,.5)}
#axoltl-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:${Z_HIGHEST};opacity:0;transition:opacity .3s,transform .3s;pointer-events:none}
.axoltl-toast-visible{opacity:1;transform:translateX(-50%) translateY(0)}
.axoltl-toast-success{background:rgba(79,196,183,.08);color:#4fc4b7;border:1px solid rgba(79,196,183,.15)}
.axoltl-toast-error{background:rgba(232,150,122,.08);color:#e8967a;border:1px solid rgba(232,150,122,.15)}
#axoltl-slash-dropdown{display:none;background:#141416;border:1px solid rgba(79,196,183,.15);border-radius:8px;padding:4px;box-shadow:0 4px 24px rgba(0,0,0,.45);min-width:240px;animation:axoltl-fade-in .15s ease;backdrop-filter:blur(16px);z-index:${Z_HIGHEST};position:fixed}
.axoltl-slash-option{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:6px;cursor:pointer;transition:background .12s ease}
.axoltl-slash-option:hover,.axoltl-slash-selected{background:rgba(79,196,183,.08)}
.axoltl-slash-cmd{font-family:monospace;font-size:12.5px;font-weight:500;color:#f5ede8}
.axoltl-slash-desc{font-size:11px;color:rgba(245,237,232,.48)}
.axoltl-slash-icon{width:26px;height:26px;border-radius:5px;background:rgba(79,196,183,.1);color:#4fc4b7;display:flex;align-items:center;justify-content:center;flex-shrink:0}
#axoltl-ide-panel{position:fixed;top:0;right:-420px;width:400px;height:100vh;background:#0c0b09;border-left:1px solid rgba(79,196,183,.1);z-index:${Z_HIGHEST};display:flex;flex-direction:column;transition:right .4s cubic-bezier(.16,1,.3,1);box-shadow:-12px 0 50px rgba(0,0,0,.6);color:#f5ede8}
.axoltl-ide-open{right:0}
.axoltl-ide-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(245,237,232,.06)}
.axoltl-ide-title{font-family:'Bricolage Grotesque',sans-serif;font-size:15px;font-weight:700;color:#4fc4b7}
.axoltl-ide-body{flex:1;overflow-y:auto;padding:16px 20px}
.axoltl-ide-repo{padding:10px 12px;background:rgba(255,255,255,.02);border:1px solid rgba(245,237,232,.06);border-radius:8px;margin-bottom:8px;cursor:pointer;font-size:12px;color:rgba(245,237,232,.72)}
.axoltl-ide-repo:hover{border-color:rgba(79,196,183,.3)}
.axoltl-ide-repo-name{font-weight:600;color:#f5ede8}
.axoltl-highlight-btn{position:fixed;display:none;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;z-index:${Z_HIGHEST};box-shadow:0 4px 12px rgba(0,0,0,.15);animation:axoltl-pop .2s cubic-bezier(.16,1,.3,1);background:#1e1d1a;border:1px solid rgba(79,196,183,.2);color:#4fc4b7}
.axoltl-highlight-btn:hover{background:rgba(79,196,183,.1)}
.axoltl-ingest-status{position:fixed;bottom:24px;right:24px;display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;font-size:12px;font-weight:500;z-index:${Z_HIGHEST};opacity:0;transform:translateY(10px);transition:all .3s ease}
.axoltl-status-visible{opacity:1;transform:translateY(0)}
.axoltl-ingest-success{background:rgba(79,196,183,.1);color:#4fc4b7;border:1px solid rgba(79,196,183,.2)}
.axoltl-ingest-pending{background:rgba(240,176,66,.08);color:#f0b042;border:1px solid rgba(240,176,66,.15)}
.axoltl-ingest-error{background:rgba(232,150,122,.08);color:#e8967a;border:1px solid rgba(232,150,122,.15)}
@keyframes axoltl-ghost-appear{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}
@keyframes axoltl-fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes axoltl-pop{from{opacity:0;transform:translate(-50%,10px)scale(.9)}to{opacity:1;transform:translate(-50%,0)scale(1)}}`;

let mode: Mode = 'search', enabled = true;
let ghostEl: HTMLElement | null = null, ghostAnswer = '', debouncer: ReturnType<typeof setTimeout> | null = null, prevQuery = '', savedText = '';
let ideOpen = false, ideEl: HTMLElement | null = null, slashEl: HTMLElement | null = null, slashIdx = 0, hlBtn: HTMLElement | null = null;

function injectStyles(): void {
  if (document.getElementById('axoltl-css')) return;
  const s = document.createElement('style'); s.id = 'axoltl-css'; s.textContent = AX_CSS;
  document.head.appendChild(s);
}

function findEd(): HTMLElement | null {
  for (const sel of EDITORS) { const el = document.querySelector<HTMLElement>(sel); if (el?.offsetParent) return el; }
  return null;
}
function readText(el: HTMLElement): string { return el instanceof HTMLTextAreaElement ? el.value : (el.textContent || ''); }

function isEnd(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return el.selectionEnd >= el.value.trimEnd().length;
  const s = window.getSelection(); if (!s?.rangeCount) return true;
  const r = s.getRangeAt(0); const t = document.createRange(); t.selectNodeContents(el); t.setStart(r.endContainer, r.endOffset);
  return !t.toString().trim();
}

function caretXY(el: HTMLElement): { x: number; y: number; h: number } | null {
  if (el instanceof HTMLTextAreaElement) {
    const cs = getComputedStyle(el), m = document.createElement('div');
    for (const p of ['font-family','font-size','font-weight','line-height','padding','border','box-sizing']) m.style.setProperty(p, cs.getPropertyValue(p));
    m.style.position = 'absolute'; m.style.top = m.style.left = '-9999px'; m.style.width = `${el.clientWidth}px`;
    m.style.whiteSpace = 'pre-wrap'; m.style.visibility = 'hidden';
    m.textContent = el.value.substring(0, el.selectionEnd);
    const mk = document.createElement('span'); mk.textContent = '\u200b'; m.appendChild(mk);
    document.body.appendChild(m);
    const mr = m.getBoundingClientRect(), mkr = mk.getBoundingClientRect(), er = el.getBoundingClientRect();
    const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
    const r = { x: er.left + bl + (mkr.left - mr.left) - el.scrollLeft, y: er.top + bt + (mkr.top - mr.top) - el.scrollTop, h: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 };
    m.remove(); return r;
  }
  const s = window.getSelection(); if (!s?.rangeCount) return null;
  const r = s.getRangeAt(0); if (!el.contains(r.commonAncestorContainer)) return null;
  const c = r.cloneRange(); c.collapse(false); const rect = c.getBoundingClientRect();
  if (rect.height > 0) return { x: rect.right, y: rect.top, h: rect.height };
  const er = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { x: er.left + parseFloat(cs.paddingLeft), y: er.top + parseFloat(cs.paddingTop), h: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 };
}

function isDark(el: HTMLElement): boolean {
  const m = getComputedStyle(el).backgroundColor.match(/\d+/g);
  return !m || (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255 < 0.5;
}

function dismissG(): void { ghostEl?.remove(); ghostEl = null; ghostAnswer = ''; }

function showGhost(ans: string, c: { x: number; y: number; h: number }, er: DOMRect, ed: HTMLElement): void {
  dismissG(); ghostAnswer = ans;
  const d = ans.length > MAX_GHOST_CHARS ? ans.slice(0, MAX_GHOST_CHARS).trimEnd() + '\u2026' : ans;
  const t = readText(ed), p = (!/[\s\n]$/.test(t) && t.length > 0) ? ' ' : '';
  ghostEl = document.createElement('div'); ghostEl.className = 'axoltl-ghost ' + (isDark(ed) ? 'axoltl-dark' : 'axoltl-light');
  const ts = document.createElement('span'); ts.className = 'axoltl-ghost-text'; ts.textContent = p + d;
  ghostEl.appendChild(ts);
  const tb = document.createElement('span'); tb.className = 'axoltl-ghost-tab'; tb.textContent = 'Tab';
  ghostEl.appendChild(tb);
  const cs = getComputedStyle(ed);
  ghostEl.style.fontFamily = cs.fontFamily; ghostEl.style.fontSize = cs.fontSize; ghostEl.style.lineHeight = c.h + 'px';
  ghostEl.style.position = 'fixed'; ghostEl.style.zIndex = Z_HIGHEST; ghostEl.style.pointerEvents = 'none';
  ghostEl.style.left = c.x + 'px'; ghostEl.style.top = c.y + 'px'; ghostEl.style.maxWidth = (er.right - c.x - 16) + 'px';
  document.body.appendChild(ghostEl);
}

function insText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    const pos = el.selectionEnd; const nv = el.value.slice(0, pos) + text + el.value.slice(pos);
    if (setter) setter.call(el, nv); else el.value = nv;
    el.selectionStart = el.selectionEnd = pos + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else { el.focus(); document.execCommand('insertText', false, text); }
}

function acceptG(): boolean {
  if (!ghostAnswer) return false;
  const ed = findEd(); if (!ed) return false;
  insText(ed, ghostAnswer.startsWith(' ') ? ghostAnswer : ' ' + ghostAnswer);
  dismissG(); toast('Memory context added'); return true;
}

const CMDS = [
  { cmd: 'X:ingest', desc: 'Ingest', icon: '\u2B06' },
  { cmd: 'X:search', desc: 'Search', icon: '\uD83D\uDD0D' },
  { cmd: 'X:repo', desc: 'Repo panel', icon: '\uD83D\uDCC1' },
];

function showSlash(ed: HTMLElement): void {
  dismissSlash();
  const d = document.createElement('div'); d.id = 'axoltl-slash-dropdown'; slashIdx = 0;
  d.innerHTML = CMDS.map((sc, i) => `<div class="axoltl-slash-option${i === slashIdx ? ' axoltl-slash-selected' : ''}"><div style="display:flex;align-items:center;gap:10px"><span class="axoltl-slash-icon">${sc.icon}</span><div><div class="axoltl-slash-cmd">${sc.cmd}</div><div class="axoltl-slash-desc">${sc.desc}</div></div></div></div>`).join('');
  document.body.appendChild(d); slashEl = d;
  const r = ed.getBoundingClientRect(); d.style.left = (r.left + 10) + 'px'; d.style.top = (r.top - 10) + 'px'; d.style.display = 'block';
}

function dismissSlash(): void { slashEl?.remove(); slashEl = null; }

function execSlash(idx: number): void {
  const c = CMDS[idx].cmd;
  if (c === 'X:ingest') mode = 'ingest'; else if (c === 'X:search') mode = 'search'; else if (c === 'X:repo') { mode = 'repo'; openIde(); }
  dismissSlash(); dismissG(); toast('Mode: ' + c.slice(2));
}

function openIde(): void {
  if (ideEl) { ideEl.style.display = 'flex'; }
  else {
    ideEl = document.createElement('div'); ideEl.id = 'axoltl-ide-panel';
    ideEl.innerHTML = '<div class="axoltl-ide-header"><span class="axoltl-ide-title">\u2751 Repos</span><button class="axoltl-ide-close" id="ax-ide-close">\u2715</button></div><div class="axoltl-ide-body"><div class="axoltl-ide-repo"><div class="axoltl-ide-repo-name">axoltl-extension</div><div>247 files</div></div><div class="axoltl-ide-repo"><div class="axoltl-ide-repo-name">axoltl-app</div><div>89 files</div></div></div>';
    document.body.appendChild(ideEl);
    ideEl.querySelector('#ax-ide-close')!.addEventListener('click', closeIde);
  }
  requestAnimationFrame(() => ideEl?.classList.add('axoltl-ide-open'));
  ideOpen = true;
}

function closeIde(): void { ideEl?.classList.remove('axoltl-ide-open'); ideOpen = false; }

function toast(msg: string, isError = false): void {
  document.getElementById('axoltl-toast')?.remove();
  const t = document.createElement('div'); t.id = 'axoltl-toast';
  t.className = isError ? 'axoltl-toast-error' : 'axoltl-toast-success';
  t.textContent = msg; document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('axoltl-toast-visible'));
  setTimeout(() => { t.classList.remove('axoltl-toast-visible'); setTimeout(() => t.remove(), 300); }, 2500);
}

function banner(status: 'pending' | 'success' | 'error'): HTMLElement {
  document.querySelectorAll('.axoltl-ingest-status').forEach(e => e.remove());
  const b = document.createElement('div'); b.className = `axoltl-ingest-status axoltl-ingest-${status}`;
  b.innerHTML = status === 'pending' ? '<span>Memorizing\u2026</span>' : status === 'success' ? '<span>\u2713 Done</span>' : '<span>\u2717 Failed</span>';
  document.body.appendChild(b);
  requestAnimationFrame(() => b.classList.add('axoltl-status-visible'));
  return b;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('axoltl-memory', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('memories')) r.result.createObjectStore('memories', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error!);
  });
}

async function searchLocal(q: string): Promise<Array<{ content: string; score: number }>> {
  try {
    const db = await openDB();
    const all: any[] = await new Promise((res, rej) => {
      const r = db.transaction('memories', 'readonly').objectStore('memories').getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error!);
    });
    const lq = q.toLowerCase();
    return all.filter(m => m.content?.toLowerCase().includes(lq))
      .map(m => ({ content: m.content, score: 0.5 + (m.content?.toLowerCase().includes(lq) ? 0.3 : 0) }))
      .sort((a, b) => b.score - a.score).slice(0, 5);
  } catch { return []; }
}

async function saveHl(text: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('memories', 'readwrite');
    tx.objectStore('memories').put({ id: 'hl-' + Date.now(), content: text, provider: 'highlight', domain: 'profile', score: 1.0, createdAt: Date.now() });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error!); });
    toast('Highlight saved');
  } catch { toast('Failed', true); }
  if (hlBtn) hlBtn.style.display = 'none';
}

function handleKey(e: KeyboardEvent): void {
  const ed = findEd();
  if (e.ctrlKey && e.shiftKey && e.key === 'M') { e.preventDefault(); if (mode === 'repo') { ideOpen ? closeIde() : openIde(); } return; }
  if (slashEl && document.activeElement === ed) {
    if (e.key === 'ArrowDown') { e.preventDefault(); slashIdx = Math.min(slashIdx + 1, CMDS.length - 1); dismissSlash(); showSlash(ed!); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashIdx = Math.max(slashIdx - 1, 0); dismissSlash(); showSlash(ed!); return; }
    if (e.key === 'Enter') { e.preventDefault(); execSlash(slashIdx); return; }
    if (e.key === 'Escape') { dismissSlash(); return; }
  }
  if (ghostEl) { if (e.key === 'Tab') { e.preventDefault(); acceptG(); return; } if (e.key === 'Escape') { dismissG(); return; } }
  if (e.key === 'Enter' && !e.shiftKey && ed) { savedText = readText(ed); dismissG(); }
  if (ed?.textContent?.trim() === 'X:') showSlash(ed);
  if (ed?.textContent && !ed.textContent.includes('X:')) dismissSlash();
}

function runAC(): void {
  const ed = findEd(); if (!ed) return;
  const t = readText(ed);
  if (t.length < MIN_QUERY_LEN || !isEnd(ed) || !enabled || mode !== 'search') { dismissG(); return; }
  if (t === prevQuery) return; prevQuery = t;
  if (debouncer) clearTimeout(debouncer);
  debouncer = setTimeout(async () => {
    const c = caretXY(ed); if (c) { dismissG(); const g = document.createElement('div'); g.className = 'axoltl-ghost ' + (isDark(ed) ? 'axoltl-dark' : 'axoltl-light'); const ds = document.createElement('span'); ds.className = 'axoltl-ghost-text'; ds.textContent = '  ...'; g.appendChild(ds); const cs = getComputedStyle(ed); g.style.fontFamily = cs.fontFamily; g.style.fontSize = cs.fontSize; g.style.lineHeight = c.h + 'px'; g.style.position = 'fixed'; g.style.left = c.x + 'px'; g.style.top = c.y + 'px'; g.style.zIndex = Z_HIGHEST; g.style.pointerEvents = 'none'; document.body.appendChild(g); ghostEl = g; }
    const results = await searchLocal(t); dismissG();
    if (results.length > 0 && results[0].score >= MIN_RELEVANCE) {
      const c2 = caretXY(ed); const er = ed.getBoundingClientRect();
      if (c2 && er) showGhost(results[0].content, c2, er, ed);
    }
  }, DEBOUNCE_MS);
}

function hookSend(): void {
  for (const sel of ['button[data-testid="send-button"]','button[aria-label="Send Message"]','button[type="submit"]']) {
    const btn = document.querySelector<HTMLButtonElement>(sel);
    if (btn && !btn.dataset.axoltlHooked) {
      btn.dataset.axoltlHooked = '1';
      btn.addEventListener('click', () => {
        if (mode === 'search' && savedText) { const b = banner('pending'); setTimeout(() => { b.classList.remove('axoltl-status-visible'); b.remove(); banner('success'); }, 2000); }
        dismissG();
      }, true);
    }
  }
}

function init(): void {
  injectStyles();
  document.addEventListener('keydown', handleKey);
  document.addEventListener('mouseup', (e: MouseEvent) => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel || sel.length < 3) { if (hlBtn) hlBtn.style.display = 'none'; return; }
    if (!hlBtn) {
      hlBtn = document.createElement('div'); hlBtn.className = 'axoltl-highlight-btn';
      hlBtn.innerHTML = '<span>\uD83D\uDCBE</span><span>Remember</span>';
      hlBtn.addEventListener('click', () => { const t = window.getSelection()?.toString().trim(); if (t) saveHl(t); });
      document.body.appendChild(hlBtn);
    }
    hlBtn.style.display = 'flex'; hlBtn.style.left = Math.max(10, e.clientX - 50) + 'px'; hlBtn.style.top = Math.max(10, e.clientY - 40) + 'px';
  });
  const obs = new MutationObserver(() => {
    const ed = findEd();
    if (ed && !ed.dataset.axoltlInpHooked) { ed.dataset.axoltlInpHooked = '1'; ed.addEventListener('input', runAC); ed.addEventListener('keydown', (ke: KeyboardEvent) => { if (ke.key === 'Enter' && !ke.shiftKey) { dismissG(); setTimeout(hookSend, 100); } }); }
    hookSend();
  });
  obs.observe(document.body, { childList: true, subtree: true });
  chrome.storage.sync.get(['xmem_enabled'], (d: any) => { enabled = d.xmem_enabled !== false; });
  chrome.storage.onChanged.addListener((c: any) => { if (c.xmem_enabled) enabled = c.xmem_enabled.newValue !== false; });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();