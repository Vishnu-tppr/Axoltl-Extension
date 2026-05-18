/** Axoltl Popup — mascot state machine */

import { DOM } from './dom';
import { MASCOT_ASSETS, MASCOT_ANIMS, SUCCESS_DURATION_MS } from './constants';

let currentState: string | null = null;
let successTimer = 0;

export function setMascot(state: string): void {
  if (currentState === state || !DOM.mascotCanvas) return;
  currentState = state;

  const key = state.toUpperCase() as keyof typeof MASCOT_ASSETS;
  const src = chrome.runtime.getURL(
    `${MASCOT_ASSETS[key] || MASCOT_ASSETS.SLEEP}?v=${Date.now()}`
  );
  const img = new Image();
  img.src = src;
  img.alt = `Axoltl ${state}`;
  DOM.mascotCanvas.replaceChildren(img);

  DOM.mascotCanvas.classList.remove('anim-float', 'anim-wobble', 'anim-pop');
  void DOM.mascotCanvas.offsetWidth;
  DOM.mascotCanvas.classList.add(MASCOT_ANIMS[state] || 'anim-float');
}

export function decideMascot(session: unknown, _quota: unknown): void {
  if (Date.now() < successTimer) { setMascot('success'); return; }
  if (!session) { setMascot('sleep'); return; }
  setMascot('thinking');
}

export function markSuccess(durationMs?: number): void {
  successTimer = Date.now() + (durationMs ?? SUCCESS_DURATION_MS);
  setMascot('success');
}