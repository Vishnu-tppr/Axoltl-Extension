// ── DOM refs ──────────────────────────────────────────────
const statusTitle = document.getElementById('statusTitle');
const statusMeta = document.getElementById('statusMeta');
const statusDot = document.getElementById('statusDot');
const toast = document.getElementById('toast');
const mascotCanvas = document.getElementById('mascotCanvas');
const mascotStatus = document.getElementById('mascotStatus');
const settingsBtn = document.getElementById('settingsBtn');
const pairBtn = document.getElementById('pairBtn');
const settingsPanel = document.getElementById('settingsPanel');
const toDidInput = document.getElementById('toDidInput');
const toKeyInput = document.getElementById('toKeyInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const switchChatgpt = document.getElementById('switchChatgpt');
const switchGemini = document.getElementById('switchGemini');
const switchClaude = document.getElementById('switchClaude');
const quotaBanner = document.getElementById('quotaBanner');
const quotaText = document.getElementById('quotaText');
const quotaChatgpt = document.getElementById('quotaChatgpt');
const quotaGemini = document.getElementById('quotaGemini');
const sendPhone = document.getElementById('sendPhone');
const memoryStats = document.getElementById('memoryStats');

// ── Mascot ────────────────────────────────────────────────
const MASCOT = {
  sleep: '../assets/axoltl-sleep-animated.svg',
  thinking: '../assets/axoltl-thinking-animated.svg',
  success: '../assets/axoltl-success-animated.svg',
};
const ANIM = {
  sleep: 'anim-float',
  thinking: 'anim-wobble',
  success: 'anim-pop',
};

let currentMascotState = null;
let successTimer = 0;

function setMascot(state) {
  if (currentMascotState === state) return;
  currentMascotState = state;

  // Swap image
  const src = chrome.runtime.getURL(`${MASCOT[state]}?v=${Date.now()}`);
  const img = new Image();
  img.src = src;
  img.alt = `Axoltl ${state}`;
  mascotCanvas.replaceChildren(img);

  // Swap animation class
  mascotCanvas.classList.remove('anim-float', 'anim-wobble', 'anim-pop');
  void mascotCanvas.offsetWidth; // reflow to restart animation
  mascotCanvas.classList.add(ANIM[state] || 'anim-float');
}

function decideMascot(session, quota) {
  if (Date.now() < successTimer) { setMascot('success'); return; }
  if (!session) { setMascot('sleep'); return; }
  setMascot('thinking');
}

// ── Toast ─────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, type = 'info', duration = 2800) {
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = `toast type-${type}`;
  void toast.offsetWidth;
  toast.classList.add('show');
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// ── Ripple on chips ───────────────────────────────────────
document.querySelectorAll('.chip').forEach(btn => {
  btn.addEventListener('click', e => {
    const rect = btn.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width * 100).toFixed(1) + '%';
    const y = ((e.clientY - rect.top) / rect.height * 100).toFixed(1) + '%';
    btn.style.setProperty('--rx', x);
    btn.style.setProperty('--ry', y);
    btn.classList.add('rippling');
    setTimeout(() => btn.classList.remove('rippling'), 500);
  });
});

// ── Helpers ───────────────────────────────────────────────
function formatAgo(ts) {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function providerLabel(p) {
  if (p === 'openai' || p === 'chatgpt') return 'chatgpt.com';
  if (p === 'gemini') return 'gemini.google.com';
  if (p === 'claude') return 'claude.ai';
  return p || 'claude.ai';
}

function setEnabled(on) {
  [switchChatgpt, switchGemini, switchClaude, sendPhone,
    quotaChatgpt, quotaGemini].forEach(el => {
      if (el) el.disabled = !on;
    });
}

// ── Settings panel (slide animation) ─────────────────────
let settingsOpen = false;

function openSettings() {
  settingsOpen = true;
  settingsPanel.classList.add('open');
  settingsPanel.setAttribute('aria-hidden', 'false');
  settingsBtn.classList.add('active');
  document.body.classList.add('popup-expanded');
}
function closeSettings() {
  settingsOpen = false;
  settingsPanel.classList.remove('open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsBtn.classList.remove('active');
  document.body.classList.remove('popup-expanded');
}
function toggleSettings() {
  settingsOpen ? closeSettings() : openSettings();
}

async function loadSettings() {
  const { axoltlPrefs } = await chrome.storage.local.get(['axoltlPrefs']);
  if (toDidInput) toDidInput.value = axoltlPrefs?.toDid || '';
  if (toKeyInput) toKeyInput.value = axoltlPrefs?.toX25519PublicKey || '';
}

// ── Quota banner ──────────────────────────────────────────
function renderQuota(quota) {
  if (!quotaBanner) return;
  if (!quota?.quotaHit) { quotaBanner.classList.add('hidden'); return; }
  quotaText.textContent = `⚠ Quota reached on ${quota.provider || 'current provider'}`;
  quotaBanner.classList.remove('hidden');
}

// ── Main UI refresh ───────────────────────────────────────
async function refreshUi() {
  const [sess, loc] = await Promise.all([
    chrome.storage.session.get(['activeSession', 'quotaState']),
    chrome.storage.local.get(['activeSession', 'quotaState']),
  ]);
  const session = sess.activeSession || loc.activeSession;
  const quota = sess.quotaState || loc.quotaState;

  renderQuota(quota);
  decideMascot(session, quota);

  if (!session) {
    if (statusTitle) statusTitle.textContent = 'No session';
    if (statusMeta) statusMeta.textContent = 'Waiting for conversation activity.';
    if (statusDot) statusDot.className = 'dot idle';
    if (mascotStatus) mascotStatus.classList.remove('session-active');
    if (mascotCanvas) mascotCanvas.classList.remove('glow');
    setEnabled(false);
    return;
  }

  if (statusTitle) statusTitle.textContent = 'Active session';
  if (statusMeta) statusMeta.textContent =
    `${providerLabel(session.provider)} · ${session.messageCount || 0} msgs · ${formatAgo(session.updatedAt || Date.now())}`;
  if (statusDot) statusDot.className = 'dot active';
  if (mascotStatus) mascotStatus.classList.add('session-active');
  if (mascotCanvas) mascotCanvas.classList.add('glow');
  setEnabled(true);
}

// ── Actions ───────────────────────────────────────────────
async function dispatchSwitch(provider) {
  const btn = document.querySelector(`[data-provider="${provider}"]`);
  if (btn) { btn.style.opacity = '0.6'; }

  const res = await chrome.runtime.sendMessage({ action: 'SWITCH_PROVIDER', provider });

  if (btn) { btn.style.opacity = ''; }

  if (res?.ok) { window.close(); return; }
  showToast(res?.error || 'Switch failed', 'error');
}

async function dispatchPushToPhone() {
  sendPhone.classList.add('loading');
  sendPhone.disabled = true;

  const res = await chrome.runtime.sendMessage({ action: 'PUSH_TO_PHONE' });

  sendPhone.classList.remove('loading');
  sendPhone.disabled = false;

  if (res?.ok) {
    successTimer = Date.now() + 5000;
    setMascot('success');
    showToast('Session sent to phone ✓', 'success');
    await refreshUi();
    return;
  }
  showToast(res?.error || 'Send failed', 'error');
}

// ── Event listeners ───────────────────────────────────────
if (settingsBtn) {
  settingsBtn.addEventListener('click', async () => {
    if (!settingsOpen) await loadSettings();
    toggleSettings();
  });
}

// ── QR Pairing Modal ─────────────────────────────────
const qrModal = document.getElementById('qrModal');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const qrCloseBtn = document.getElementById('qrCloseBtn');
const qrRegenerateBtn = document.getElementById('qrRegenerateBtn');
const qrDoneBtn = document.getElementById('qrDoneBtn');

let currentQRInstance = null;

function closeQrModal() {
  if (!qrModal) return;
  qrModal.classList.add('hidden');
  qrModal.setAttribute('aria-hidden', 'true');
  if (currentQRInstance) {
    currentQRInstance = null;
    qrCodeContainer.innerHTML = '';
  }
}

function openQrModal() {
  if (!qrModal) return;
  qrModal.classList.remove('hidden');
  qrModal.setAttribute('aria-hidden', 'false');
}

async function generateAndShowQR() {
  try {
    if (typeof QRCode === 'undefined') {
      showToast('QR library not loaded', 'error');
      return;
    }

    openQrModal();
    if (qrCodeContainer) qrCodeContainer.innerHTML = '<div style="color:var(--teal);font-size:20px;margin-top:80px">Loading Identity...</div>';

    console.log('QR: Fetching identity from storage');
    let res = await chrome.storage.local.get(['axoltl_identity']);
    let identity = res.axoltl_identity;

    if (!identity) {
      console.log('QR: Identity missing, requesting via SW');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Identity request timed out')), 4000));
      try {
        identity = await Promise.race([
          chrome.runtime.sendMessage({ action: 'GET_DEVICE_IDENTITY' }),
          timeoutPromise
        ]);
      } catch (e) {
        console.error('QR: SW Identity request failed', e);
      }
    }

    console.log('QR: Identity received', !!identity);
    if (!identity || !identity.did) {
      showToast('Identity not ready. Please reload.', 'error');
      closeQrModal();
      return;
    }

    const pairingData = JSON.stringify({
      app: 'axoltl',
      version: 1,
      did: identity.did,
      key: identity.publicKey,
      label: 'Axoltl Browser',
      relay: 'https://axoltl-relay.vishnu-tppr.workers.dev',
      ts: Date.now()
    });

    // Clear previous QR code
    if (qrCodeContainer) qrCodeContainer.innerHTML = '';
    currentQRInstance = null;

    // Generate QR code
    if (qrCodeContainer && typeof QRCode !== 'undefined') {
      console.log('QR: Instantiating QRCode');
      currentQRInstance = new QRCode(qrCodeContainer, {
        text: pairingData,
        width: 192,
        height: 192,
        colorDark: '#1ab8b8',
        colorLight: '#080c0c',
        correctLevel: (QRCode.CorrectLevel && QRCode.CorrectLevel.H) ? QRCode.CorrectLevel.H : 4
      });
    } else {
      showToast('QR library not loaded', 'error');
    }
  } catch (error) {
    showToast('QR generation failed: ' + String(error), 'error');
  }
}

if (pairBtn) pairBtn.addEventListener('click', generateAndShowQR);
if (qrCloseBtn) qrCloseBtn.addEventListener('click', closeQrModal);
if (qrDoneBtn) qrDoneBtn.addEventListener('click', closeQrModal);
if (qrRegenerateBtn) qrRegenerateBtn.addEventListener('click', generateAndShowQR);
if (qrModal) {
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) closeQrModal();
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener('click', async () => {
    const prefs = {
      toDid: toDidInput.value.trim(),
      toX25519PublicKey: toKeyInput.value.trim(),
    };
    await chrome.storage.local.set({ axoltlPrefs: prefs });
    closeSettings();
    showToast('Settings saved', 'success');
  });
}

if (switchChatgpt) switchChatgpt.addEventListener('click', () => dispatchSwitch('chatgpt'));
if (switchGemini) switchGemini.addEventListener('click', () => dispatchSwitch('gemini'));
if (switchClaude) switchClaude.addEventListener('click', () => dispatchSwitch('claude'));
if (quotaChatgpt) quotaChatgpt.addEventListener('click', () => dispatchSwitch('chatgpt'));
if (quotaGemini) quotaGemini.addEventListener('click', () => dispatchSwitch('gemini'));
if (sendPhone) sendPhone.addEventListener('click', dispatchPushToPhone);

// ── Memory Controls ───────────────────────────────────────
const memoryImportBtn = document.getElementById('memory-import-btn');
const memoryExportBtn = document.getElementById('memory-export-btn');
const memoryClearBtn  = document.getElementById('memory-clear-btn');
const memoryFileInput = document.getElementById('memoryFileInput');

if (memoryImportBtn && memoryFileInput) {
  memoryImportBtn.addEventListener('click', () => memoryFileInput.click());
}

if (memoryFileInput) {
  memoryFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('Invalid format');
      
      const db = await openMemoryDB();
      const tx = db.transaction('memories', 'readwrite');
      const store = tx.objectStore('memories');
      for (const item of data) {
        store.put(item);
      }
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = rej;
      });
      showToast(`Imported ${data.length} memories`, 'success');
      refreshMemoryStats();
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
    memoryFileInput.value = '';
  });
}

if (memoryExportBtn) {
  memoryExportBtn.addEventListener('click', async () => {
    try {
      const db = await openMemoryDB();
      const tx = db.transaction('memories', 'readonly');
      const store = tx.objectStore('memories');
      const all = await idbGetAll(store);
      if (!all.length) {
        showToast('No memories to export', 'info');
        return;
      }
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `axoltl-memories-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Memories exported', 'success');
    } catch (err) {
      showToast('Export failed', 'error');
    }
  });
}

if (memoryClearBtn) {
  memoryClearBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear ALL local memories?')) return;
    try {
      const db = await openMemoryDB();
      const tx = db.transaction('memories', 'readwrite');
      tx.objectStore('memories').clear();
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = rej;
      });
      showToast('Local memories cleared', 'success');
      refreshMemoryStats();
    } catch (err) {
      showToast('Clear failed', 'error');
    }
  });
}

// Close settings on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && settingsOpen) closeSettings();
});

// ── IndexedDB Helpers ─────────────────────────────────────
function openMemoryDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('axoltl-memory', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('memories')) {
        db.createObjectStore('memories', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function refreshMemoryStats() {
  if (!memoryStats) return;

  try {
    const db = await openMemoryDB();
    const tx = db.transaction('memories', 'readonly');
    const store = tx.objectStore('memories');
    const all = await idbGetAll(store);

    if (!all.length) {
      memoryStats.textContent = 'No memories saved yet';
      return;
    }

    const byProvider = {};
    all.forEach(m => { byProvider[m.provider] = (byProvider[m.provider] || 0) + 1; });
    const providerStr = Object.entries(byProvider).map(([p, n]) => `${p}: ${n}`).join(' · ');

    memoryStats.innerHTML = `
      <div style="font-size:18px;font-weight:700;color:#10b981">${all.length} memories</div>
      <div style="margin-top:2px;color:#52525b;font-size:11px">${providerStr}</div>
    `;
  } catch (e) {
    memoryStats.textContent = 'Memory stats unavailable';
  }
}

// ── XMem Server Settings ──────────────────────────────────
const xmemApiUrl = document.getElementById('xmemApiUrl');
const xmemApiKey = document.getElementById('xmemApiKey');
const xmemUserId = document.getElementById('xmemUserId');
const xmemSaveBtn = document.getElementById('xmemSaveBtn');
const xmemTestBtn = document.getElementById('xmemTestBtn');
const xmemStatusDot = document.getElementById('xmemStatusDot');
const xmemStatusText = document.getElementById('xmemStatusText');

const XMEM_KEYS = {
  apiUrl: 'axoltlXMemApiUrl',
  apiKey: 'axoltlXMemApiKey',
  userId: 'axoltlXMemUserId',
};

async function testXMemConnection(apiUrl, apiKey) {
  if (!apiUrl) {
    updateXMemStatus(false, 'No URL configured');
    return;
  }
  updateXMemStatus(null, 'Testing...');
  try {
    const url = `${apiUrl.replace(/\/+$/, '')}/health`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(timeoutId);
    if (resp.ok) {
      const data = await resp.json();
      const serverData = data?.data || {};
      const ready = serverData.pipelines_ready === true;
      updateXMemStatus(ready, ready ? 'Connected' : 'Server loading');
    } else {
      updateXMemStatus(false, `HTTP ${resp.status}`);
    }
  } catch (err) {
    updateXMemStatus(false, 'Unreachable');
  }
}

function updateXMemStatus(connected, text) {
  if (xmemStatusDot) {
    if (connected === null) xmemStatusDot.style.background = '#f59e0b';
    else xmemStatusDot.style.background = connected ? '#10b981' : '#ef4444';
  }
  if (xmemStatusText) xmemStatusText.textContent = text || '';
}

// ── Init ──────────────────────────────────────────────────
refreshUi();
refreshMemoryStats();
chrome.storage.onChanged.addListener(refreshUi);

// Load XMem config
chrome.storage.sync.get([XMEM_KEYS.apiUrl, XMEM_KEYS.apiKey, XMEM_KEYS.userId], (res) => {
  if (xmemApiUrl) xmemApiUrl.value = res[XMEM_KEYS.apiUrl] || 'http://localhost:8000';
  if (xmemApiKey) xmemApiKey.value = res[XMEM_KEYS.apiKey] || '';
  if (xmemUserId) xmemUserId.value = res[XMEM_KEYS.userId] || 'axoltl-user';
  if (res[XMEM_KEYS.apiUrl]) testXMemConnection(res[XMEM_KEYS.apiUrl], res[XMEM_KEYS.apiKey]);
});

if (xmemSaveBtn) {
  xmemSaveBtn.addEventListener('click', async () => {
    const config = {};
    config[XMEM_KEYS.apiUrl] = (xmemApiUrl?.value || '').trim();
    config[XMEM_KEYS.apiKey] = (xmemApiKey?.value || '').trim();
    config[XMEM_KEYS.userId] = (xmemUserId?.value || '').trim() || 'axoltl-user';
    await chrome.storage.sync.set(config);
    showToast('XMem saved', 'success');
    testXMemConnection(config[XMEM_KEYS.apiUrl], config[XMEM_KEYS.apiKey]);
  });
}
if (xmemTestBtn) {
  xmemTestBtn.addEventListener('click', () => {
    testXMemConnection(xmemApiUrl?.value, xmemApiKey?.value);
  });
}
