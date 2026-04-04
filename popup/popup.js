// ── DOM refs ──────────────────────────────────────────────
const statusTitle   = document.getElementById('statusTitle');
const statusMeta    = document.getElementById('statusMeta');
const statusDot     = document.getElementById('statusDot');
const toast         = document.getElementById('toast');
const mascotCanvas  = document.getElementById('mascotCanvas');
const mascotStatus  = document.getElementById('mascotStatus');
const settingsBtn   = document.getElementById('settingsBtn');
const pairBtn       = document.getElementById('pairBtn');
const settingsPanel = document.getElementById('settingsPanel');
const toDidInput    = document.getElementById('toDidInput');
const toKeyInput    = document.getElementById('toKeyInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const switchChatgpt = document.getElementById('switchChatgpt');
const switchGemini  = document.getElementById('switchGemini');
const switchClaude  = document.getElementById('switchClaude');
const quotaBanner   = document.getElementById('quotaBanner');
const quotaText     = document.getElementById('quotaText');
const quotaChatgpt  = document.getElementById('quotaChatgpt');
const quotaGemini   = document.getElementById('quotaGemini');
const sendPhone     = document.getElementById('sendPhone');

// ── Mascot ────────────────────────────────────────────────
const MASCOT = {
  sleep:    '../assets/axoltl-sleep-animated.svg',
  thinking: '../assets/axoltl-thinking-animated.svg',
  success:  '../assets/axoltl-success-animated.svg',
};
const ANIM = {
  sleep:    'anim-float',
  thinking: 'anim-wobble',
  success:  'anim-pop',
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
    const x = ((e.clientX - rect.left) / rect.width  * 100).toFixed(1) + '%';
    const y = ((e.clientY - rect.top)  / rect.height * 100).toFixed(1) + '%';
    btn.style.setProperty('--rx', x);
    btn.style.setProperty('--ry', y);
    btn.classList.add('rippling');
    setTimeout(() => btn.classList.remove('rippling'), 500);
  });
});

// ── Helpers ───────────────────────────────────────────────
function formatAgo(ts) {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60)  return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function providerLabel(p) {
  if (p === 'openai' || p === 'chatgpt') return 'chatgpt.com';
  if (p === 'gemini')                    return 'gemini.google.com';
  if (p === 'claude')                    return 'claude.ai';
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
}
function closeSettings() {
  settingsOpen = false;
  settingsPanel.classList.remove('open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  settingsBtn.classList.remove('active');
}
function toggleSettings() {
  settingsOpen ? closeSettings() : openSettings();
}

async function loadSettings() {
  const { axoltlPrefs } = await chrome.storage.local.get(['axoltlPrefs']);
  toDidInput.value  = axoltlPrefs?.toDid             || '';
  toKeyInput.value  = axoltlPrefs?.toX25519PublicKey || '';
}

// ── Quota banner ──────────────────────────────────────────
function renderQuota(quota) {
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
  const quota   = sess.quotaState   || loc.quotaState;

  renderQuota(quota);
  decideMascot(session, quota);

  if (!session) {
    statusTitle.textContent = 'No session';
    statusMeta.textContent  = 'Waiting for conversation activity.';
    statusDot.className     = 'dot idle';
    mascotStatus.classList.remove('session-active');
    mascotCanvas.classList.remove('glow');
    setEnabled(false);
    return;
  }

  statusTitle.textContent = 'Active session';
  statusMeta.textContent  =
    `${providerLabel(session.provider)} · ${session.messageCount || 0} msgs · ${formatAgo(session.updatedAt || Date.now())}`;
  statusDot.className = 'dot active';
  mascotStatus.classList.add('session-active');
  mascotCanvas.classList.add('glow');
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
settingsBtn.addEventListener('click', async () => {
  if (!settingsOpen) await loadSettings();
  toggleSettings();
});

// ── QR Pairing Modal ─────────────────────────────────
const qrModal        = document.getElementById('qrModal');
const qrCodeContainer = document.getElementById('qrCodeContainer');
const qrCloseBtn     = document.getElementById('qrCloseBtn');
const qrRegenerateBtn = document.getElementById('qrRegenerateBtn');
const qrDoneBtn      = document.getElementById('qrDoneBtn');

let currentQRInstance = null;

function closeQrModal() {
  qrModal.classList.add('hidden');
  qrModal.setAttribute('aria-hidden', 'true');
  if (currentQRInstance) {
    currentQRInstance = null;
    qrCodeContainer.innerHTML = '';
  }
}

function openQrModal() {
  qrModal.classList.remove('hidden');
  qrModal.setAttribute('aria-hidden', 'false');
}

async function generateAndShowQR() {
  try {
    const identity = await chrome.runtime.sendMessage({ action: 'GET_DEVICE_IDENTITY' });
    if (!identity || !identity.did || !identity.publicKey) {
      showToast('Failed to load device identity', 'error');
      return;
    }

    const pairingData = JSON.stringify({
      did: identity.did,
      key: identity.publicKey,
      ts: Date.now()
    });

    // Clear previous QR code
    qrCodeContainer.innerHTML = '';
    currentQRInstance = null;

    // Generate QR code
    currentQRInstance = new QRCode(qrCodeContainer, {
      text: pairingData,
      width: 182,
      height: 182,
      colorDark: '#1ab8b8',
      colorLight: '#080c0c',
      correctLevel: QRCode.CorrectLevel.H
    });

    openQrModal();
  } catch (error) {
    showToast('QR generation failed: ' + String(error), 'error');
  }
}

pairBtn.addEventListener('click', generateAndShowQR);
qrCloseBtn.addEventListener('click', closeQrModal);
qrDoneBtn.addEventListener('click', closeQrModal);
qrRegenerateBtn.addEventListener('click', generateAndShowQR);
qrModal.addEventListener('click', (e) => {
  if (e.target === qrModal) closeQrModal();
});

saveSettingsBtn.addEventListener('click', async () => {
  const prefs = {
    toDid:            toDidInput.value.trim(),
    toX25519PublicKey: toKeyInput.value.trim(),
  };
  await chrome.storage.local.set({ axoltlPrefs: prefs });
  closeSettings();
  showToast('Settings saved', 'success');
});

switchChatgpt.addEventListener('click', () => dispatchSwitch('chatgpt'));
switchGemini.addEventListener('click',  () => dispatchSwitch('gemini'));
switchClaude.addEventListener('click',  () => dispatchSwitch('claude'));
quotaChatgpt.addEventListener('click',  () => dispatchSwitch('chatgpt'));
quotaGemini.addEventListener('click',   () => dispatchSwitch('gemini'));
sendPhone.addEventListener('click', dispatchPushToPhone);

// Close settings on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && settingsOpen) closeSettings();
});

// ── Init ──────────────────────────────────────────────────
refreshUi();
chrome.storage.onChanged.addListener(refreshUi);
