/** Axoltl Popup — QR pairing modal */

import { DOM } from './dom';
import { QR_SIZE } from './constants';
import { showToast } from './toast';
import { QRCode } from '../../crypto/qrcode';

let instance: QRCode | null = null;

export function close() {
  if (!DOM.qrModal) return;
  DOM.qrModal.classList.add('hidden');
  DOM.qrModal.setAttribute('aria-hidden', 'true');
  if (instance) {
    instance = null;
    if (DOM.qrCodeContainer) DOM.qrCodeContainer.innerHTML = '';
  }
}

export function open() {
  if (!DOM.qrModal) return;
  DOM.qrModal.classList.remove('hidden');
  DOM.qrModal.setAttribute('aria-hidden', 'false');
}

export async function generate() {
  try {
    open();
    if (DOM.qrCodeContainer) DOM.qrCodeContainer.innerHTML = '<div style="color:var(--teal);font-size:20px;margin-top:80px">Loading Identity...</div>';

    let res = await chrome.storage.local.get(['axoltl_identity']);
    let identity = res.axoltl_identity;
    if (!identity) {
      try {
        identity = await Promise.race([
          chrome.runtime.sendMessage({ action: 'GET_DEVICE_IDENTITY' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
        ]);
      } catch { /* SW unresponsive */ }
    }
    if (!identity?.did) { showToast('Identity not ready', 'error'); close(); return; }

    const data = JSON.stringify({ app: 'axoltl', version: 1, did: identity.did, key: identity.publicKey, label: 'Axoltl Browser', relay: 'https://axoltl-relay.vishnu-tppr.workers.dev', ts: Date.now() });
    if (DOM.qrCodeContainer) DOM.qrCodeContainer.innerHTML = '';
    instance = null;
    if (DOM.qrCodeContainer) {
      instance = new QRCode(DOM.qrCodeContainer, { text: data, width: QR_SIZE, height: QR_SIZE, colorDark: '#1ab8b8', colorLight: '#080c0c', correctLevel: QRCode.CorrectLevel.H });
    }
  } catch (e) {
    showToast('QR failed: ' + String(e), 'error');
  }
}