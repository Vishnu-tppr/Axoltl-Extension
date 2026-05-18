/** Axoltl Popup — entry point */

import { DOM } from './dom';
import * as Mascot from './mascot';
import { showToast } from './toast';
import { formatAgo, providerLabel, setEnabled } from './helpers';
import * as Settings from './settings';
import * as QR from './qr';
import * as Memory from './memory';
import * as XMem from './xmem';

// ── Quota Banner ──────────────────────────────────
function renderQuota(quota: any) {
  if (!DOM.quotaBanner) return;
  if (!quota?.quotaHit) { DOM.quotaBanner.classList.add('hidden'); return; }
  if (DOM.quotaText) DOM.quotaText.textContent = `⚠ Quota reached on ${quota.provider || 'current provider'}`;
  DOM.quotaBanner.classList.remove('hidden');
}

// ── Main UI Refresh ───────────────────────────────
async function refreshUi() {
  const [sess, loc] = await Promise.all([
    chrome.storage.session.get(['activeSession', 'quotaState']),
    chrome.storage.local.get(['activeSession', 'quotaState']),
  ]);
  const session = sess.activeSession || loc.activeSession;
  const quota = sess.quotaState || loc.quotaState;

  renderQuota(quota);
  Mascot.decideMascot(session, quota);

  if (!session) {
    if (DOM.statusTitle) DOM.statusTitle.textContent = 'No session';
    if (DOM.statusMeta) DOM.statusMeta.textContent = 'Waiting for conversation activity.';
    if (DOM.statusDot) DOM.statusDot.className = 'dot idle';
    DOM.mascotStatus?.classList.remove('session-active');
    DOM.mascotCanvas?.classList.remove('glow');
    setEnabled(false, DOM.switchChatgpt, DOM.switchGemini, DOM.switchClaude, DOM.sendPhone, DOM.quotaChatgpt, DOM.quotaGemini);
    return;
  }

  if (DOM.statusTitle) DOM.statusTitle.textContent = 'Active session';
  if (DOM.statusMeta) DOM.statusMeta.textContent =
    `${providerLabel(session.provider)} · ${session.messageCount || 0} msgs · ${formatAgo(session.updatedAt || Date.now())}`;
  if (DOM.statusDot) DOM.statusDot.className = 'dot active';
  DOM.mascotStatus?.classList.add('session-active');
  DOM.mascotCanvas?.classList.add('glow');
  setEnabled(true, DOM.switchChatgpt, DOM.switchGemini, DOM.switchClaude, DOM.sendPhone, DOM.quotaChatgpt, DOM.quotaGemini);
}

// ── Provider Switch ───────────────────────────────
async function dispatchSwitch(provider: string) {
  const btn = document.querySelector<HTMLElement>(`[data-provider="${provider}"]`);
  if (btn) btn.style.opacity = '0.6';
  const res = await chrome.runtime.sendMessage({ action: 'SWITCH_PROVIDER', provider });
  if (btn) btn.style.opacity = '';
  if (res?.ok) { window.close(); return; }
  showToast(res?.error || 'Switch failed', 'error');
}

async function dispatchPushToPhone() {
  if (DOM.sendPhone) DOM.sendPhone.classList.add('loading');
  if (DOM.sendPhone) (DOM.sendPhone as HTMLButtonElement).disabled = true;
  const res = await chrome.runtime.sendMessage({ action: 'PUSH_TO_PHONE' });
  if (DOM.sendPhone) DOM.sendPhone.classList.remove('loading');
  if (DOM.sendPhone) (DOM.sendPhone as HTMLButtonElement).disabled = false;
  if (res?.ok) {
    Mascot.markSuccess();
    showToast('Session sent to phone ✓', 'success');
    await refreshUi();
    return;
  }
  showToast(res?.error || 'Send failed', 'error');
}

// ── Ripple on chips ───────────────────────────────
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', (e: Event) => {
    const me = e as MouseEvent;
    const rect = btn.getBoundingClientRect();
    const x = ((me.clientX - rect.left) / rect.width * 100).toFixed(1) + '%';
    const y = ((me.clientY - rect.top) / rect.height * 100).toFixed(1) + '%';
    (btn as HTMLElement).style.setProperty('--rx', x);
    (btn as HTMLElement).style.setProperty('--ry', y);
    btn.classList.add('rippling');
    setTimeout(() => btn.classList.remove('rippling'), 500);
  });
});

// ── Wire Event Listeners ──────────────────────────
if (DOM.settingsBtn) {
  DOM.settingsBtn.addEventListener('click', async () => {
    if (!Settings.isOpen()) await Settings.loadPrefs();
    Settings.toggle();
  });
}

if (DOM.pairBtn) DOM.pairBtn.addEventListener('click', QR.generate);
if (DOM.qrCloseBtn) DOM.qrCloseBtn.addEventListener('click', QR.close);
if (DOM.qrDoneBtn) DOM.qrDoneBtn.addEventListener('click', QR.close);
if (DOM.qrRegenerateBtn) DOM.qrRegenerateBtn.addEventListener('click', QR.generate);
if (DOM.qrModal) DOM.qrModal.addEventListener('click', e => { if (e.target === DOM.qrModal) QR.close(); });

if (DOM.saveSettingsBtn) DOM.saveSettingsBtn.addEventListener('click', Settings.savePrefs);

if (DOM.switchChatgpt) DOM.switchChatgpt.addEventListener('click', () => dispatchSwitch('chatgpt'));
if (DOM.switchGemini) DOM.switchGemini.addEventListener('click', () => dispatchSwitch('gemini'));
if (DOM.switchClaude) DOM.switchClaude.addEventListener('click', () => dispatchSwitch('claude'));
if (DOM.quotaChatgpt) DOM.quotaChatgpt.addEventListener('click', () => dispatchSwitch('chatgpt'));
if (DOM.quotaGemini) DOM.quotaGemini.addEventListener('click', () => dispatchSwitch('gemini'));
if (DOM.sendPhone) DOM.sendPhone.addEventListener('click', dispatchPushToPhone);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && Settings.isOpen()) Settings.close();
});

// ── Memory Controls ───────────────────────────────
if (DOM.memoryImportBtn && DOM.memoryFileInput) {
  DOM.memoryImportBtn.addEventListener('click', () => DOM.memoryFileInput?.click());
}
if (DOM.memoryFileInput) {
  DOM.memoryFileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await Memory.importFromFile(file);
    if (DOM.memoryFileInput) DOM.memoryFileInput.value = '';
  });
}
if (DOM.memoryExportBtn) DOM.memoryExportBtn.addEventListener('click', Memory.exportToFile);
if (DOM.memoryClearBtn) DOM.memoryClearBtn.addEventListener('click', Memory.clearAll);

if (DOM.memoryGhostToggle) {
  DOM.memoryGhostToggle.addEventListener('change', async () => {
    const checked = DOM.memoryGhostToggle?.checked !== false;
    await chrome.storage.local.set({ axoltlGhostEnabled: checked });
    showToast(`Ghost suggestions ${checked ? 'enabled' : 'disabled'}`, 'success');
  });
}
if (DOM.memoryAutosaveToggle) {
  DOM.memoryAutosaveToggle.addEventListener('change', async () => {
    const checked = DOM.memoryAutosaveToggle?.checked !== false;
    await chrome.storage.local.set({ axoltlAutosaveEnabled: checked });
    showToast(`Auto-save ${checked ? 'enabled' : 'disabled'}`, 'success');
  });
}

// ── XMem Controls ─────────────────────────────────
if (DOM.xmemSaveBtn) DOM.xmemSaveBtn.addEventListener('click', XMem.saveConfig);
if (DOM.xmemTestBtn) {
  DOM.xmemTestBtn.addEventListener('click', () => XMem.testConnection(DOM.xmemApiUrl?.value, DOM.xmemApiKey?.value));
}

// ── Init ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  refreshUi();
  Memory.refreshStats();
  XMem.loadConfig();
  Settings.loadPrefs();
});

chrome.storage.onChanged.addListener(refreshUi);