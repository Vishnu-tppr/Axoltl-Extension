/** Axoltl Popup — local IndexedDB memory engine */

import { DOM } from './dom';
import { showToast } from './toast';
import { MEMORY_DB_NAME, MEMORY_DB_VERSION, MEMORY_STORE_NAME } from './constants';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEMORY_DB_NAME, MEMORY_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEMORY_STORE_NAME)) {
        db.createObjectStore(MEMORY_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(store: IDBObjectStore): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function refreshStats() {
  if (!DOM.memoryStats) return;
  try {
    const db = await openDB();
    const tx = db.transaction(MEMORY_STORE_NAME, 'readonly');
    const store = tx.objectStore(MEMORY_STORE_NAME);
    const all = await getAll(store);
    if (!all.length) { DOM.memoryStats.textContent = 'No memories saved yet'; return; }
    const counts: Record<string, number> = {};
    all.forEach((m: any) => { counts[m.provider] = (counts[m.provider] || 0) + 1; });
    DOM.memoryStats.innerHTML = `<div style="font-size:18px;font-weight:700;color:#10b981">${all.length} memories</div><div style="margin-top:2px;color:#52525b;font-size:11px">${Object.entries(counts).map(([p, n]) => `${p}: ${n}`).join(' · ')}</div>`;
  } catch { DOM.memoryStats.textContent = 'Memory stats unavailable'; }
}

export async function importFromFile(file: File) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error('Invalid format');
    const db = await openDB();
    const tx = db.transaction(MEMORY_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MEMORY_STORE_NAME);
    for (const item of data) store.put(item);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    showToast(`Imported ${data.length} memories`, 'success');
    refreshStats();
  } catch (err: any) { showToast('Import failed: ' + err.message, 'error'); }
}

export async function exportToFile() {
  try {
    const db = await openDB();
    const tx = db.transaction(MEMORY_STORE_NAME, 'readonly');
    const store = tx.objectStore(MEMORY_STORE_NAME);
    const all = await getAll(store);
    if (!all.length) { showToast('No memories to export', 'info'); return; }
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `axoltl-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Memories exported', 'success');
  } catch { showToast('Export failed', 'error'); }
}

export async function clearAll() {
  if (!confirm('Clear ALL local memories?')) return;
  try {
    const db = await openDB();
    const tx = db.transaction(MEMORY_STORE_NAME, 'readwrite');
    tx.objectStore(MEMORY_STORE_NAME).clear();
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    showToast('Local memories cleared', 'success');
    refreshStats();
  } catch { showToast('Clear failed', 'error'); }
}