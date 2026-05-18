/** Axoltl Popup — toast notification */

import { DOM } from './dom';
import { TOAST_DURATION_MS } from './constants';

let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string, type: 'info' | 'success' | 'error' = 'info', durationMs?: number): void {
  if (!DOM.toast) return;
  if (timer) clearTimeout(timer);
  DOM.toast.textContent = msg;
  DOM.toast.className = `toast type-${type}`;
  void DOM.toast.offsetWidth;
  DOM.toast.classList.add('show');
  timer = setTimeout(() => DOM.toast?.classList.remove('show'), durationMs ?? TOAST_DURATION_MS);
}