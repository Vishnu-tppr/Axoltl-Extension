/**
 * Axoltl Background Service Worker
 * Manages device identity, relay push, session handoff, message routing.
 * Fixed MV3 + crypto-safe TypeScript version.
 */

import {
  fromBase64,
  generateEphemeralX25519,
  hkdfAesKey,
  encryptAesGcm,
  signPayloadEd25519,
  toBase64,
} from "../crypto/noise";

const encoder = new TextEncoder();

const IDENTITY_KEY = "axoltl_identity";
const RELAY_URL_FALLBACK = "https://axoltl-relay.vishnu-tppr.workers.dev";

type SessionMessage = {
  role: string;
  content: string;
};

type SessionData = {
  messages?: SessionMessage[];
  provider?: string;
  messageCount?: number;
  [key: string]: unknown;
};

type DeviceIdentity = {
  did: string;
  privateKey: string;
  publicKey: string;
};

type AxoltlPrefs = {
  relayUrl?: string;
  toDid?: string;
  pairedPhoneDid?: string;
  pairedPhoneLabel?: string;
  toX25519PublicKey?: string;
  pairedPhoneKey?: string;
  [key: string]: unknown;
};

type RuntimeResult = {
  ok: boolean;
  success?: boolean;
  error?: string;
  [key: string]: unknown;
};

type PendingInjection = {
  text: string;
  provider: string;
  createdAt: number;
};

const PROVIDER_URLS: Record<string, string> = {
  claude: "https://claude.ai/new",
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/",
};

async function withKeepAlive<T>(promise: Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    // @ts-ignore
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 25000);

  try {
    return await promise;
  } finally {
    clearInterval(timer);
  }
}

async function assertCryptoSupport(): Promise<void> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable in this context.");
  }
}

async function getRelayUrl(): Promise<string> {
  const result = await chrome.storage.local.get(["relayUrl", "axoltlPrefs"]);
  const prefs = result.axoltlPrefs as AxoltlPrefs | undefined;
  return String(result.relayUrl || prefs?.relayUrl || RELAY_URL_FALLBACK);
}

async function hashDid(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource) as ArrayBuffer;
  const hashBytes = new Uint8Array(digest);
  return Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getDeviceIdentity(): Promise<DeviceIdentity> {
  await assertCryptoSupport();

  const data = await chrome.storage.local.get([IDENTITY_KEY]);
  if (data[IDENTITY_KEY]) {
    return data[IDENTITY_KEY] as DeviceIdentity;
  }

  const keypair = (await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const priv = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keypair.privateKey)
  );
  const pub = new Uint8Array(
    await crypto.subtle.exportKey("raw", keypair.publicKey)
  );

  const identity: DeviceIdentity = {
    did: await hashDid(pub),
    privateKey: toBase64(priv),
    publicKey: toBase64(pub),
  };

  await chrome.storage.local.set({ [IDENTITY_KEY]: identity });
  return identity;
}

async function encryptForRecipient(
  bundle: unknown,
  recipientKeyB64: string
): Promise<{
  eph_pub: string;
  iv: string;
  salt: string;
  ct: string;
}> {
  await assertCryptoSupport();

  const eph = await generateEphemeralX25519();
  const ephPub = new Uint8Array(
    await crypto.subtle.exportKey("raw", eph.publicKey)
  );

  const recipientKey = await crypto.subtle.importKey(
    "raw",
    fromBase64(recipientKeyB64) as BufferSource,
    { name: "X25519" },
    false,
    []
  );

  const shared = (await crypto.subtle.deriveBits(
    { name: "X25519", public: recipientKey },
    eph.privateKey,
    256
  )) as ArrayBuffer;

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await hkdfAesKey(shared, salt, "axolotl-session");
  const plaintext = encoder.encode(JSON.stringify(bundle));
  const ct = await encryptAesGcm(aesKey, plaintext, iv);

  return {
    eph_pub: toBase64(ephPub),
    iv: toBase64(iv),
    salt: toBase64(salt),
    ct: toBase64(ct),
  };
}

async function signEnvelope(
  identity: DeviceIdentity,
  envelope: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const privKey = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64(identity.privateKey) as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"]
  );

  const payload = encoder.encode(JSON.stringify(envelope));
  const sig = await signPayloadEd25519(privKey, payload);

  return {
    ...envelope,
    sig: toBase64(sig),
    from_pub: identity.publicKey,
  };
}

const CompressorSW = {
  compress(messages: SessionMessage[], mode: "inject" | "relay" = "inject"): string {
    if (!messages?.length) return "Continue from transferred context.";

    const charLimit = mode === "relay" ? 8000 : 2000;
    const recentCount = mode === "relay" ? 6 : 4;
    const fullText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

    if (fullText.length <= charLimit) {
      return this._buildPrompt(null, messages, null);
    }

    const first = messages[0];
    const recent = messages.slice(-recentCount);
    const middle = messages.slice(1, -recentCount);
    const topic = this._extractTopic(first);
    const midSummary = middle.length > 0 ? this._summarizeMiddle(middle) : null;

    let prompt = this._buildPrompt(topic, recent, midSummary);

    if (prompt.length > charLimit) {
      const trunc = recent.map((m) => ({
        role: m.role,
        content: m.content.slice(0, Math.floor(charLimit / recentCount / 2)),
      }));
      prompt = this._buildPrompt(topic, trunc, midSummary);
    }

    return prompt.slice(0, charLimit);
  },

  _extractTopic(msg: SessionMessage | undefined): string {
    if (!msg?.content) return "General conversation";
    const c = msg.content.trim();
    const s = c.match(/^[^.!?\n]+[.!?]?/);
    return ((s && s[0].length > 10 ? s[0] : c) || "").slice(0, 150);
  },

  _summarizeMiddle(messages: SessionMessage[]): string | null {
    const stopArr = [
      "the","a","an","is","are","was","were","be","have","has","had","do","does","did",
      "will","would","could","should","to","of","in","for","on","with","at","by","from",
      "as","and","but","or","not","no","so","if","then","than","that","this","it","its",
      "i","you","he","she","we","they","me","my","your","what","which","who","when",
      "where","how","all","just","about","very","also","get","got"
    ];

    const stopWords = new Set(stopArr);
    const counts: Record<string, number> = {};

    messages.forEach((m) => {
      (m.content || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w))
        .forEach((w) => {
          counts[w] = (counts[w] || 0) + 1;
        });
    });

    const kw = Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([w]) => w);

    return kw.length
      ? `[${messages.length} earlier turns discussing: ${kw.join(", ")}]`
      : null;
  },

  _buildPrompt(
    topic: string | null,
    recent: SessionMessage[] | null,
    mid: string | null
  ): string {
    const p: string[] = [];
    p.push("I'm continuing a conversation from another AI assistant. Here's the context:\n");
    if (topic) p.push(`Topic: ${topic}\n`);
    if (mid) p.push(`${mid}\n`);

    if (recent?.length) {
      p.push("Recent exchange:");
      recent.forEach((m) => {
        p.push(`${m.role === "user" ? "User" : "AI"}: ${m.content}`);
      });
    }

    p.push("\nPlease continue this conversation naturally. You have the context above.");
    return p.join("\n");
  },
};

async function getCurrentSession(): Promise<SessionData | null> {
  const sd = await chrome.storage.session.get(["activeSession", "currentSession"]);
  const fromSession = (sd.currentSession || sd.activeSession) as SessionData | undefined;
  if (fromSession) return fromSession;

  const loc = await chrome.storage.local.get(["activeSession", "currentSession"]);
  return (loc.currentSession || loc.activeSession || null) as SessionData | null;
}

async function handleSwitchProvider(
  provider: string
): Promise<{ success: boolean; ok: boolean; error?: string }> {
  try {
    const session = await getCurrentSession();
    const pageUrl = PROVIDER_URLS[provider];
    if (!pageUrl) throw new Error(`Unknown provider: ${provider}`);

    if (!session || !session.messages?.length) {
      await chrome.tabs.create({ url: pageUrl });
      return { success: true, ok: true };
    }

    const compressedContext = CompressorSW.compress(session.messages, "inject");

    const pendingInjection: PendingInjection = {
      text: compressedContext,
      provider,
      createdAt: Date.now(),
    };

    await chrome.storage.session.set({ pendingInjection });

    const tab = await chrome.tabs.create({ url: pageUrl });
    if (!tab.id) throw new Error("Tab creation failed");

    chrome.tabs.onUpdated.addListener(function listener(tabId: number, changeInfo: Record<string, any>) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);

        chrome.scripting
          .executeScript({
            target: { tabId: tab.id as number },
            func: injectContextIntoPage as any,
            args: [compressedContext, provider],
          })
          .catch((err: unknown) => {
            console.error("[Axoltl] Injection failed:", err);
          });
      }
    });

    return { success: true, ok: true };
  } catch (error: unknown) {
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// This function runs in page context — must be self-contained
function injectContextIntoPage(text: string, provider: string): void {
  const INPUT_SELECTORS: Record<string, string[]> = {
    claude: [
      "div.ProseMirror[contenteditable='true']",
      "[contenteditable='true'][data-placeholder]",
      "fieldset [contenteditable='true']",
      "textarea",
    ],
    chatgpt: [
      "#prompt-textarea",
      "[id='prompt-textarea']",
      "div[contenteditable='true'][data-placeholder]",
      "textarea",
    ],
    gemini: [
      "rich-textarea [contenteditable='true']",
      "rich-textarea > div[contenteditable]",
      "textarea",
    ],
    perplexity: [
      "textarea[placeholder*='Ask']",
      "textarea[placeholder*='ask']",
      "textarea",
    ],
  };

  const showToast = (msg: string, bg: string) => {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = [
      "position:fixed",
      "bottom:24px",
      "right:24px",
      "z-index:99999",
      `background:${bg}`,
      "color:#fff",
      "padding:12px 20px",
      "border-radius:10px",
      "font-size:14px",
      "font-family:-apple-system,sans-serif",
      "box-shadow:0 4px 16px rgba(0,0,0,0.3)",
    ].join(";");
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  };

  let attempts = 0;

  const iv = setInterval(() => {
    attempts += 1;
    const selectors = INPUT_SELECTORS[provider] || ["textarea"];
    let input: HTMLElement | null = null;

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && (el as HTMLElement).offsetHeight > 0) {
        input = el as HTMLElement;
        break;
      }
    }

    if (input) {
      input.focus();
      let ok = false;

      try {
        ok = document.execCommand("insertText", false, text);
      } catch {
        ok = false;
      }

      if (!ok) {
        if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
          input.value = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          input.textContent = text;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        ok = true;
      }

      if (ok) showToast("🦎 Context injected! Press Enter.", "#065f46");
      clearInterval(iv);
      return;
    }

    if (attempts >= 15) {
      clearInterval(iv);
      navigator.clipboard
        .writeText(text)
        .then(() => showToast("📋 Copied! Ctrl+V.", "#1e3a5f"))
        .catch(() => showToast("⚠ Could not inject.", "#78350f"));
    }
  }, 1000);
}

async function pushToRelay(bundle: SessionData | null, recipientDid?: string): Promise<RuntimeResult> {
  const { axoltlPrefs } = await chrome.storage.local.get(["axoltlPrefs"]);
  const prefs = (axoltlPrefs || {}) as AxoltlPrefs;

  const recipientKey =
    String(prefs.toX25519PublicKey || "").trim() ||
    String(prefs.pairedPhoneKey || "").trim();

  const toDid = String(recipientDid || prefs.toDid || "").trim();

  try {
    if (!bundle) throw new Error("No active session");
    if (!toDid || !recipientKey) throw new Error("Missing paired phone settings");

    const messages = Array.isArray(bundle.messages) ? bundle.messages : [];

    const compressed = {
      summary: CompressorSW.compress(messages, "relay"),
      messages: messages.slice(-10),
      provider: bundle.provider,
      messageCount: bundle.messageCount || messages.length || 0,
      compressedAt: Date.now(),
    };

    const relayUrl = await getRelayUrl();
    if (!relayUrl) throw new Error("Relay URL not configured");

    const identity = await getDeviceIdentity();
    const encrypted = await encryptForRecipient(compressed, recipientKey);
    const signed = await signEnvelope(identity, encrypted);
    const blob = btoa(JSON.stringify(signed));

    const resp = await fetch(`${relayUrl}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from_did: identity.did,
        to_did: toDid,
        blob,
        ttl: 300,
      }),
    });

    if (!resp.ok) throw new Error(`Relay returned ${resp.status}`);

    const body = (await resp.json()) as { id?: string };

    if (body.id) {
      fetch(`${relayUrl}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to_did: toDid,
          blob_id: body.id,
          from_did: identity.did,
        }),
      }).catch(() => void 0);
    }

    return { success: true, ok: true, id: body.id };
  } catch (error: unknown) {
    console.error("[Axoltl] pushToRelay failed:", error);
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function onQuotaHit(provider: string): Promise<RuntimeResult> {
  const quotaState = {
    quotaHit: true,
    provider,
    detectedAt: Date.now(),
  };

  await chrome.storage.session.set({ quotaState });
  await chrome.storage.local.set({ quotaState });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

  return { ok: true };
}

async function getCurrentStatus(): Promise<RuntimeResult> {
  const [identity, session, quota] = await Promise.all([
    getDeviceIdentity(),
    getCurrentSession(),
    chrome.storage.session.get(["quotaState"]),
  ]);

  return {
    ok: true,
    identity,
    hasSession: Boolean(session),
    session,
    quota: quota.quotaState || null,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void getDeviceIdentity().catch((err) => {
    console.error("[Axoltl] Failed to initialize identity:", err);
  });
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender: any, sendResponse: (response?: any) => void) => {
  void (async () => {
    try {
      const m = msg as Record<string, any>;

      if (m.type === "AXOLTL_SESSION_UPDATE" || m.action === "SESSION_UPDATE") {
        const payload = (m.payload || m.session) as SessionData;
        await chrome.storage.session.set({
          activeSession: payload,
          currentSession: payload,
        });
        await chrome.storage.local.set({
          activeSession: payload,
          currentSession: payload,
        });
        sendResponse({ ok: true, success: true });
        return;
      }

      if (m.type === "AXOLTL_QUOTA_HIT") {
        sendResponse(await onQuotaHit(m.payload?.provider || "unknown"));
        return;
      }

      if (m.action === "PUSH_TO_PHONE") {
        const result = await withKeepAlive(
          pushToRelay(await getCurrentSession(), m.recipientDid)
        );
        sendResponse(result);
        return;
      }

      if (m.action === "SWITCH_PROVIDER") {
        sendResponse(await handleSwitchProvider(String(m.provider || "")));
        return;
      }

      if (m.action === "QUOTA_HIT") {
        sendResponse(await onQuotaHit(String(m.provider || "unknown")));
        return;
      }

      if (m.action === "GET_DEVICE_IDENTITY") {
        sendResponse(await getDeviceIdentity());
        return;
      }

      if (m.action === "GET_STATUS") {
        sendResponse(await getCurrentStatus());
        return;
      }

      if (m.action === "PAIR_PHONE_DID") {
        const did = String(m.did || "").trim();
        if (!did) {
          sendResponse({ ok: false, error: "Missing DID" });
          return;
        }

        const current = await chrome.storage.local.get(["axoltlPrefs"]);
        const currentPrefs = (current.axoltlPrefs || {}) as AxoltlPrefs;

        await chrome.storage.local.set({
          axoltlPrefs: {
            ...currentPrefs,
            toDid: did,
            pairedPhoneDid: did,
            pairedPhoneLabel: m.label || "Your Phone",
          },
        });

        sendResponse({ ok: true, success: true });
        return;
      }

      if (m.action === "XMEM_PROXY_FETCH") {
        const { url, options = {} } = m.payload || {};
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        try {
          const fetchOpts: RequestInit = {
            method: options.method || "GET",
            headers: options.headers || {},
            signal: controller.signal,
          };

          if (options.body) {
            fetchOpts.body =
              typeof options.body === "string"
                ? options.body
                : JSON.stringify(options.body);
          }

          const resp = await fetch(url, fetchOpts);
          clearTimeout(timeout);

          const ct = resp.headers.get("content-type") || "";
          const data = ct.includes("application/json")
            ? await resp.json().catch(() => ({}))
            : { text: await resp.text().catch(() => "") };

          sendResponse({
            ok: resp.ok,
            status: resp.status,
            data,
          });
        } catch (err: unknown) {
          clearTimeout(timeout);
          sendResponse({
            ok: false,
            error:
              err instanceof Error && err.name === "AbortError"
                ? "Timeout"
                : err instanceof Error
                ? err.message
                : String(err),
          });
        }
        return;
      }

      sendResponse({ ok: false, error: "Unknown action" });
    } catch (error: unknown) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});