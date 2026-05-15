import {
  fromBase64,
  generateEphemeralX25519,
  hkdfAesKey,
  encryptAesGcm,
  signPayloadEd25519,
  toBase64
} from "../crypto/noise.js";

const IDENTITY_KEY = "axoltl_identity";
const RELAY_URL_FALLBACK = "https://axoltl-relay.vishnu-tppr.workers.dev";

let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
}

chrome.runtime.onStartup.addListener(startKeepAlive);
chrome.runtime.onInstalled.addListener(startKeepAlive);
startKeepAlive();

async function getRelayUrl() {
  const result = await chrome.storage.local.get(["relayUrl", "axoltlPrefs"]);
  return result.relayUrl || result.axoltlPrefs?.relayUrl || RELAY_URL_FALLBACK;
}

async function getDeviceIdentity() {
  const data = await chrome.storage.local.get([IDENTITY_KEY]);
  if (data[IDENTITY_KEY]) return data[IDENTITY_KEY];

  const keypair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const priv = await crypto.subtle.exportKey("pkcs8", keypair.privateKey);
  const pub = await crypto.subtle.exportKey("raw", keypair.publicKey);
  const identity = {
    did: await hashDid(new Uint8Array(pub)),
    privateKey: toBase64(new Uint8Array(priv)),
    publicKey: toBase64(new Uint8Array(pub))
  };
  await chrome.storage.local.set({ [IDENTITY_KEY]: identity });
  return identity;
}

async function hashDid(publicKeyBytes) {
  const digest = await crypto.subtle.digest("SHA-256", publicKeyBytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function encryptForRecipient(bundle, recipientX25519RawB64) {
  const eph = await generateEphemeralX25519();
  const ephPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const recipientKey = await crypto.subtle.importKey(
    "raw",
    fromBase64(recipientX25519RawB64),
    { name: "X25519" },
    false,
    []
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: recipientKey },
    eph.privateKey,
    256
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const aes = await hkdfAesKey(shared, salt);
  const ciphertext = await encryptAesGcm(aes, JSON.stringify(bundle), iv);
  return {
    eph_pub: toBase64(ephPub),
    iv: toBase64(iv),
    salt: toBase64(salt),
    ct: toBase64(ciphertext)
  };
}

async function signEnvelope(identity, envelope) {
  const priv = await crypto.subtle.importKey(
    "pkcs8",
    fromBase64(identity.privateKey),
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const payload = new TextEncoder().encode(JSON.stringify(envelope));
  const sig = await signPayloadEd25519(priv, payload);
  return { ...envelope, sig: toBase64(sig), from_pub: identity.publicKey };
}

// ── Context Compression (runs in service worker context) ──

const CompressorSW = {
  compress(messages, mode = "inject") {
    if (!Array.isArray(messages) || !messages.length) {
      return "Continue from transferred context.";
    }
    const charLimit = mode === "relay" ? 8000 : 2000;
    const recentCount = mode === "relay" ? 6 : 4;
    const fullText = messages.map(m => `${m.role}: ${m.content}`).join("\n");
    if (fullText.length <= charLimit) {
      return this._buildPrompt(null, messages, null);
    }
    const first = messages[0];
    const recent = messages.slice(-recentCount);
    const middle = messages.slice(1, -recentCount);
    const topic = this._extractTopic(first);
    const middleSummary = middle.length > 0 ? this._summarizeMiddle(middle) : null;
    let prompt = this._buildPrompt(topic, recent, middleSummary);
    if (prompt.length > charLimit) {
      const trunc = recent.map(m => ({
        role: m.role,
        content: m.content.slice(0, Math.floor(charLimit / recentCount / 2))
      }));
      prompt = this._buildPrompt(topic, trunc, middleSummary);
    }
    return prompt.slice(0, charLimit);
  },

  _extractTopic(msg) {
    if (!msg?.content) return "General conversation";
    const c = msg.content.trim();
    const s = c.match(/^[^.!?\n]+[.!?]?/);
    return (s && s[0].length > 10 ? s[0] : c).slice(0, 150);
  },

  _summarizeMiddle(messages) {
    const stopWords = new Set(["the","a","an","is","are","was","were","be","have","has","had","do","does","did","will","would","could","should","to","of","in","for","on","with","at","by","from","as","and","but","or","not","no","so","if","then","than","that","this","it","its","i","you","he","she","we","they","me","my","your","what","which","who","when","where","how","all","just","about","very","also","get","got"]);
    const counts = {};
    messages.forEach(m => {
      (m.content || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter(w => w.length > 3 && !stopWords.has(w))
        .forEach(w => { counts[w] = (counts[w] || 0) + 1; });
    });
    const kw = Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 10).map(([w]) => w);
    if (!kw.length) return null;
    return `[${messages.length} earlier turns discussing: ${kw.join(", ")}]`;
  },

  _buildPrompt(topic, recent, mid) {
    const p = ["I'm continuing a conversation from another AI assistant. Here's the context:\n"];
    if (topic) p.push(`Topic: ${topic}\n`);
    if (mid) p.push(`${mid}\n`);
    if (recent?.length) {
      p.push("Recent exchange:");
      recent.forEach(m => p.push(`${m.role === "user" ? "User" : "AI"}: ${m.content}`));
    }
    p.push("\nPlease continue this conversation naturally. You have the context above.");
    return p.join("\n");
  }
};

// ── Provider URLs (fallback, used only if injection fails) ──

const PROVIDER_URLS = {
  claude: "https://claude.ai/new",
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/",
};

async function getCurrentSession() {
  const sessionData = await chrome.storage.session.get(["activeSession", "currentSession"]);
  const fromSession = sessionData.currentSession || sessionData.activeSession;
  if (fromSession) return fromSession;
  const localData = await chrome.storage.local.get(["activeSession", "currentSession"]);
  return localData.currentSession || localData.activeSession || null;
}

// ── Switch Provider (DOM injection approach) ──────────────

async function handleSwitchProvider(provider) {
  try {
    const session = await getCurrentSession();
    const url = PROVIDER_URLS[provider];
    if (!url) throw new Error(`Unknown provider: ${provider}`);

    if (!session || !session.messages?.length) {
      await chrome.tabs.create({ url });
      return { success: true, ok: true };
    }

    // Compress the context for injection
    const compressedContext = CompressorSW.compress(session.messages, "inject");

    // Store the context for the injector to pick up
    await chrome.storage.session.set({
      pendingInjection: {
        text: compressedContext,
        provider,
        createdAt: Date.now(),
      }
    });

    // Open the target provider page
    const url = PROVIDER_URLS[provider];
    if (!url) throw new Error(`Unknown provider: ${provider}`);

    const tab = await chrome.tabs.create({ url });

    // Wait for the tab to load, then inject the context via scripting API
    chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
      if (tabId === tab.id && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);

        // Inject the provider_injector script and execute injection
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: injectContextIntoPage,
          args: [compressedContext, provider],
        }).catch(err => {
          console.error("[Axoltl] Injection failed:", err);
        });
      }
    });

    return { success: true, ok: true };
  } catch (error) {
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// This function runs in the PAGE context via chrome.scripting.executeScript
function injectContextIntoPage(text, provider) {
  const INPUT_SELECTORS = {
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

  function showToast(msg, bgColor) {
    const t = document.createElement("div");
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:99999;background:${bgColor};color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-family:-apple-system,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.3);`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  function tryInject() {
    const selectors = INPUT_SELECTORS[provider] || ["textarea"];
    let input = null;

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetHeight > 0) { input = el; break; }
    }

    if (!input) return false;

    input.focus();

    // Strategy 1: execCommand
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) {}

    // Strategy 2: direct value/textContent
    if (!ok) {
      if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        input.textContent = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      ok = true;
    }

    if (ok) {
      showToast("🦎 Context injected! Press Enter to continue.", "#065f46");
    }
    return ok;
  }

  // Retry with increasing delays (page may still be rendering)
  let attempts = 0;
  const maxAttempts = 15;
  const interval = setInterval(() => {
    attempts++;
    if (tryInject() || attempts >= maxAttempts) {
      clearInterval(interval);
      if (attempts >= maxAttempts) {
        // Final fallback: copy to clipboard
        navigator.clipboard.writeText(text).then(() => {
          showToast("📋 Context copied! Press Ctrl+V to paste.", "#1e3a5f");
        }).catch(() => {
          showToast("⚠ Could not inject. Copy context from popup.", "#78350f");
        });
      }
    }
  }, 1000);
}

// ── Relay Push ────────────────────────────────────────────

async function pushToRelay(bundle, recipientDid) {
  const { axoltlPrefs } = await chrome.storage.local.get(["axoltlPrefs"]);
  const recipientKey = axoltlPrefs?.toX25519PublicKey?.trim() || axoltlPrefs?.pairedPhoneKey?.trim();
  const toDid = (recipientDid || axoltlPrefs?.toDid || "").trim();

  try {
    if (!bundle) throw new Error("No active session");
    if (!toDid || !recipientKey) throw new Error("Missing paired phone settings");

    // Compress the bundle before encrypting
    const compressedBundle = {
      summary: CompressorSW.compress(bundle.messages || [], "relay"),
      messages: (bundle.messages || []).slice(-10),
      provider: bundle.provider,
      messageCount: bundle.messageCount || bundle.messages?.length || 0,
      compressedAt: Date.now(),
    };

    const relayUrl = await getRelayUrl();
    if (!relayUrl) throw new Error("Relay URL not configured");

    const identity = await getDeviceIdentity();
    const encrypted = await encryptForRecipient(compressedBundle, recipientKey);
    const signed = await signEnvelope(identity, encrypted);
    const blob = btoa(JSON.stringify(signed));

    const pushResponse = await fetch(`${relayUrl}/push`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from_did: identity.did,
        to_did: toDid,
        blob,
        ttl: 300
      })
    });

    if (!pushResponse.ok) {
      throw new Error(`Relay returned ${pushResponse.status}`);
    }

    const pushBody = await pushResponse.json();
    const blobId = pushBody.id;

    if (blobId) {
      try {
        await fetch(`${relayUrl}/notify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to_did: toDid,
            blob_id: blobId,
            from_did: identity.did
          })
        });
      } catch (notifyError) {
        console.error("[Axoltl] notify failed:", notifyError);
      }
    }

    return { success: true, ok: true, id: blobId };
  } catch (error) {
    console.error("[Axoltl] pushToRelay failed:", error);
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ── Quota Handling ────────────────────────────────────────

async function onQuotaHit(provider) {
  const quotaState = {
    quotaHit: true,
    provider,
    detectedAt: Date.now()
  };
  await chrome.storage.session.set({ quotaState });
  await chrome.storage.local.set({ quotaState });
  await chrome.action.setBadgeText({ text: "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  return { ok: true };
}

async function handleIncomingHandoff(bundle) {
  await chrome.storage.session.set({ incomingHandoff: bundle, incomingAt: Date.now() });
  return { ok: true };
}

async function getCurrentStatus() {
  const [identity, session, quota] = await Promise.all([
    getDeviceIdentity(),
    getCurrentSession(),
    chrome.storage.session.get(["quotaState"])
  ]);

  return {
    ok: true,
    identity,
    hasSession: Boolean(session),
    session,
    quota: quota.quotaState || null
  };
}

// ── Init ──────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  getDeviceIdentity();
});

// ── Message Router ────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "AXOLTL_SESSION_UPDATE") {
        await chrome.storage.session.set({ activeSession: msg.payload, currentSession: msg.payload });
        await chrome.storage.local.set({ activeSession: msg.payload, currentSession: msg.payload });
        sendResponse({ ok: true, success: true });
        return;
      }

      if (msg.action === "SESSION_UPDATE") {
        const payload = msg.session || msg.payload;
        await chrome.storage.session.set({ activeSession: payload, currentSession: payload });
        await chrome.storage.local.set({ activeSession: payload, currentSession: payload });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "AXOLTL_QUOTA_HIT") {
        const provider = msg.payload?.provider || "unknown";
        sendResponse(await onQuotaHit(provider));
        return;
      }

      if (msg.action === "PUSH_TO_PHONE") {
        const bundle = await getCurrentSession();
        sendResponse(await pushToRelay(bundle, msg.recipientDid || ""));
        return;
      }

      if (msg.action === "SWITCH_PROVIDER") {
        sendResponse(await handleSwitchProvider(msg.provider));
        return;
      }

      if (msg.action === "QUOTA_HIT") {
        sendResponse(await onQuotaHit(msg.provider));
        return;
      }

      if (msg.action === "HANDLE_INCOMING_HANDOFF") {
        sendResponse(await handleIncomingHandoff(msg.bundle));
        return;
      }

      if (msg.action === "GET_DEVICE_IDENTITY") {
        sendResponse(await getDeviceIdentity());
        return;
      }

      if (msg.action === "GET_STATUS") {
        sendResponse(await getCurrentStatus());
        return;
      }

      if (msg.action === "PAIR_PHONE_DID") {
        const did = String(msg.did || "").trim();
        if (!did) {
          sendResponse({ ok: false, success: false, error: "Missing DID" });
          return;
        }
        const current = await chrome.storage.local.get(["axoltlPrefs"]);
        const updatedPrefs = {
          ...(current.axoltlPrefs || {}),
          toDid: did,
          pairedPhoneDid: did,
          pairedPhoneLabel: msg.label || "Your Phone"
        };
        await chrome.storage.local.set({ axoltlPrefs: updatedPrefs });
        sendResponse({ ok: true, success: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown action" });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  })();

  return true;
});
