/** Axoltl Popup — settings panel state */

import { DOM } from './dom';

let _open = false;

export function open() {
  _open = true;
  DOM.settingsPanel?.classList.add('open');
  DOM.settingsPanel?.setAttribute('aria-hidden', 'false');
  DOM.settingsBtn?.classList.add('active');
  document.body.classList.add('popup-expanded');
}

export function close() {
  _open = false;
  DOM.settingsPanel?.classList.remove('open');
  DOM.settingsPanel?.setAttribute('aria-hidden', 'true');
  DOM.settingsBtn?.classList.remove('active');
  document.body.classList.remove('popup-expanded');
}

export function toggle() {
  _open ? close() : open();
}

export function isOpen(): boolean {
  return _open;
}

export async function loadPrefs() {
  const { axoltlPrefs, axoltlGhostEnabled, axoltlAutosaveEnabled } = await chrome.storage.local.get([
    'axoltlPrefs',
    'axoltlGhostEnabled',
    'axoltlAutosaveEnabled',
  ]);
  if (DOM.toDidInput) DOM.toDidInput.value = axoltlPrefs?.toDid || '';
  if (DOM.toKeyInput) DOM.toKeyInput.value = axoltlPrefs?.toX25519PublicKey || '';
  if (DOM.memoryGhostToggle) {
    DOM.memoryGhostToggle.checked = axoltlGhostEnabled !== false;
  }
  if (DOM.memoryAutosaveToggle) {
    DOM.memoryAutosaveToggle.checked = axoltlAutosaveEnabled !== false;
  }
}

export async function savePrefs() {
  const prefs = {
    toDid: DOM.toDidInput?.value.trim() || '',
    toX25519PublicKey: DOM.toKeyInput?.value.trim() || '',
  };
  const ghostEnabled = DOM.memoryGhostToggle ? DOM.memoryGhostToggle.checked : true;
  const autosaveEnabled = DOM.memoryAutosaveToggle ? DOM.memoryAutosaveToggle.checked : true;

  await chrome.storage.local.set({
    axoltlPrefs: prefs,
    axoltlGhostEnabled: ghostEnabled,
    axoltlAutosaveEnabled: autosaveEnabled,
  });
  close();
  const { showToast } = await import('./toast');
  showToast('Settings saved', 'success');
}