/** Axoltl Popup — pure utility helpers */

import { PROVIDER_LABELS, PROVIDER_DEFAULT } from './constants';

export function formatAgo(ts: number): string {
  const sec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function providerLabel(p?: string): string {
  return (p && PROVIDER_LABELS[p]) || p || PROVIDER_DEFAULT;
}

type Disableable = (HTMLElement & { disabled?: boolean }) | null;

export function setEnabled(on: boolean, ...elements: Disableable[]): void {
  elements.forEach(el => { if (el && 'disabled' in el) el.disabled = !on; });
}

export function escapeHtml(text: string): string {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}