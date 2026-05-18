/** Axoltl Popup — XMem server connection manager */

import { DOM } from './dom';
import { XMEM_KEYS, XMEM_TIMEOUT_MS, XMEM_DEFAULTS } from './constants';
import { showToast } from './toast';

function updateStatus(connected: boolean | null, text: string) {
  if (DOM.xmemStatusDot) {
    DOM.xmemStatusDot.style.background = connected === null ? '#f59e0b' : connected ? '#10b981' : '#ef4444';
  }
  if (DOM.xmemStatusText) DOM.xmemStatusText.textContent = text || '';
}

export async function testConnection(apiUrl?: string, apiKey?: string) {
  if (!apiUrl) { updateStatus(false, 'No URL configured'); return; }
  updateStatus(null, 'Testing...');
  try {
    const url = `${apiUrl.replace(/\/+$/, '')}/health`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), XMEM_TIMEOUT_MS);
    const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    clearTimeout(id);
    if (resp.ok) {
      const data = await resp.json();
      const ready = data?.data?.pipelines_ready === true;
      updateStatus(ready, ready ? 'Connected' : 'Server loading');
    } else {
      updateStatus(false, `HTTP ${resp.status}`);
    }
  } catch {
    updateStatus(false, 'Unreachable');
  }
}

export async function saveConfig() {
  const config: Record<string, string> = {};
  config[XMEM_KEYS.API_URL] = (DOM.xmemApiUrl?.value || '').trim();
  config[XMEM_KEYS.API_KEY] = (DOM.xmemApiKey?.value || '').trim();
  config[XMEM_KEYS.USER_ID] = (DOM.xmemUserId?.value || '').trim() || XMEM_DEFAULTS.USER_ID;
  await chrome.storage.sync.set(config);
  showToast('XMem saved', 'success');
  testConnection(config[XMEM_KEYS.API_URL], config[XMEM_KEYS.API_KEY]);
}

export async function loadConfig() {
  const res = await chrome.storage.sync.get([XMEM_KEYS.API_URL, XMEM_KEYS.API_KEY, XMEM_KEYS.USER_ID]);
  if (DOM.xmemApiUrl) DOM.xmemApiUrl.value = res[XMEM_KEYS.API_URL] || XMEM_DEFAULTS.API_URL;
  if (DOM.xmemApiKey) DOM.xmemApiKey.value = res[XMEM_KEYS.API_KEY] || '';
  if (DOM.xmemUserId) DOM.xmemUserId.value = res[XMEM_KEYS.USER_ID] || XMEM_DEFAULTS.USER_ID;
  if (res[XMEM_KEYS.API_URL]) testConnection(res[XMEM_KEYS.API_URL], res[XMEM_KEYS.API_KEY]);
}