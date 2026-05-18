/** Axoltl Popup — typed constants (pattern: src/utils/context.ts) */

// ── Mascot ──────────────────────────────────
export const MASCOT_ASSETS = {
  SLEEP:    '../assets/axoltl-sleep-animated.svg',
  THINKING: '../assets/axoltl-thinking-animated.svg',
  SUCCESS:  '../assets/axoltl-success-animated.svg',
} as const;

export const MASCOT_ANIMS: Record<string, string> = {
  sleep:    'anim-float',
  thinking: 'anim-wobble',
  success:  'anim-pop',
};

export const SUCCESS_DURATION_MS = 5000;

// ── Toast ───────────────────────────────────
export const TOAST_DURATION_MS = 2800;

// ── Editor / Ghost Text ─────────────────────
export const DEBOUNCE_MS = 600;
export const MIN_QUERY_LEN = 8;
export const MAX_GHOST_CHARS = 150;
export const MIN_RELEVANCE_SCORE = 0.4;

export const EDITOR_SELECTORS = [
  '#prompt-textarea',
  'div.ProseMirror[contenteditable="true"]',
  'div[contenteditable="true"]',
  'textarea[placeholder]',
  'rich-textarea textarea',
  'textarea',
] as const;

// ── XMem Storage Keys ───────────────────────
export const XMEM_KEYS = {
  API_URL: 'axoltlXMemApiUrl',
  API_KEY: 'axoltlXMemApiKey',
  USER_ID: 'axoltlXMemUserId',
} as const;

export const XMEM_TIMEOUT_MS = 5000;

export const XMEM_DEFAULTS = {
  API_URL: 'http://localhost:8000',
  USER_ID: 'axoltl-user',
} as const;

// ── QR ──────────────────────────────────────
export const QR_SIZE = 192;

// ── Provider Labels ─────────────────────────
export const PROVIDER_LABELS: Record<string, string> = {
  openai:  'chatgpt.com',
  chatgpt: 'chatgpt.com',
  gemini:  'gemini.google.com',
  claude:  'claude.ai',
};

export const PROVIDER_DEFAULT = 'claude.ai';

// ── IDB ─────────────────────────────────────
export const MEMORY_DB_NAME = 'axoltl-memory';
export const MEMORY_DB_VERSION = 1;
export const MEMORY_STORE_NAME = 'memories';