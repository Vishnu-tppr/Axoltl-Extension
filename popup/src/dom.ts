/** Axoltl Popup — typed DOM element references */

export interface AxoltlDOM {
  statusTitle: HTMLElement | null;
  statusMeta: HTMLElement | null;
  statusDot: HTMLElement | null;
  toast: HTMLElement | null;
  mascotCanvas: HTMLElement | null;
  mascotStatus: HTMLElement | null;
  settingsBtn: HTMLElement | null;
  settingsPanel: HTMLElement | null;
  toDidInput: HTMLInputElement | null;
  toKeyInput: HTMLInputElement | null;
  saveSettingsBtn: HTMLElement | null;
  switchChatgpt: HTMLElement | null;
  switchGemini: HTMLElement | null;
  switchClaude: HTMLElement | null;
  quotaBanner: HTMLElement | null;
  quotaText: HTMLElement | null;
  quotaChatgpt: HTMLElement | null;
  quotaGemini: HTMLElement | null;
  sendPhone: HTMLElement | null;
  pairBtn: HTMLElement | null;
  qrModal: HTMLElement | null;
  qrCodeContainer: HTMLElement | null;
  qrCloseBtn: HTMLElement | null;
  qrRegenerateBtn: HTMLElement | null;
  qrDoneBtn: HTMLElement | null;
  memoryStats: HTMLElement | null;
  memoryImportBtn: HTMLElement | null;
  memoryExportBtn: HTMLElement | null;
  memoryClearBtn: HTMLElement | null;
  memoryFileInput: HTMLInputElement | null;
  memoryGhostToggle: HTMLInputElement | null;
  memoryAutosaveToggle: HTMLInputElement | null;
  xmemApiUrl: HTMLInputElement | null;
  xmemApiKey: HTMLInputElement | null;
  xmemUserId: HTMLInputElement | null;
  xmemSaveBtn: HTMLElement | null;
  xmemTestBtn: HTMLElement | null;
  xmemStatusDot: HTMLElement | null;
  xmemStatusText: HTMLElement | null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

export const DOM: AxoltlDOM = {
  statusTitle: $('statusTitle'),
  statusMeta: $('statusMeta'),
  statusDot: $('statusDot'),
  toast: $('toast'),
  mascotCanvas: $('mascotCanvas'),
  mascotStatus: $('mascotStatus'),
  settingsBtn: $('settingsBtn'),
  settingsPanel: $('settingsPanel'),
  toDidInput: $<HTMLInputElement>('toDidInput'),
  toKeyInput: $<HTMLInputElement>('toKeyInput'),
  saveSettingsBtn: $('saveSettingsBtn'),
  switchChatgpt: $('switchChatgpt'),
  switchGemini: $('switchGemini'),
  switchClaude: $('switchClaude'),
  quotaBanner: $('quotaBanner'),
  quotaText: $('quotaText'),
  quotaChatgpt: $('quotaChatgpt'),
  quotaGemini: $('quotaGemini'),
  sendPhone: $('sendPhone'),
  pairBtn: $('pairBtn'),
  qrModal: $('qrModal'),
  qrCodeContainer: $('qrCodeContainer'),
  qrCloseBtn: $('qrCloseBtn'),
  qrRegenerateBtn: $('qrRegenerateBtn'),
  qrDoneBtn: $('qrDoneBtn'),
  memoryStats: $('memoryStats'),
  memoryImportBtn: $('memory-import-btn'),
  memoryExportBtn: $('memory-export-btn'),
  memoryClearBtn: $('memory-clear-btn'),
  memoryFileInput: $<HTMLInputElement>('memoryFileInput'),
  memoryGhostToggle: $<HTMLInputElement>('memory-ghost-toggle'),
  memoryAutosaveToggle: $<HTMLInputElement>('memory-autosave-toggle'),
  xmemApiUrl: $<HTMLInputElement>('xmemApiUrl'),
  xmemApiKey: $<HTMLInputElement>('xmemApiKey'),
  xmemUserId: $<HTMLInputElement>('xmemUserId'),
  xmemSaveBtn: $('xmemSaveBtn'),
  xmemTestBtn: $('xmemTestBtn'),
  xmemStatusDot: $('xmemStatusDot'),
  xmemStatusText: $('xmemStatusText'),
};