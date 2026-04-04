import {
  fromBase64,
  generateEphemeralX25519,
  hkdfAesKey,
  encryptAesGcm,
  signPayloadEd25519,
  toBase64
} from "../crypto/noise.js";

const IDENTITY_KEY = "axoltl_identity";
const RELAY_URL_FALLBACK = "https://axoltl-relay.workers.dev";

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

function buildInjectionContext(bundle) {
  const messages = Array.isArray(bundle?.messages) ? bundle.messages : [];
  const lastTwo = messages.slice(-2).map((m) => {
    const role = typeof m.role === "string" ? m.role : "assistant";
    const content = typeof m.content === "string" ? m.content : "";
    return `${role}: ${content.slice(0, 200)}`;
  }).join("\n");
  const summary = typeof bundle?.summary === "string" && bundle.summary.trim().length
    ? bundle.summary.trim()
    : "Continue from transferred context.";
  return `Context: ${summary}\n\nRecent:\n${lastTwo}\n\nPlease continue.`.slice(0, 2000);
}

function buildProviderUrl(provider, bundle) {
  const encoded = encodeURIComponent(buildInjectionContext(bundle));
  if (provider === "chatgpt") return `https://chat.openai.com/?q=${encoded}`;
  if (provider === "gemini") return `https://gemini.google.com/app?q=${encoded}`;
  if (provider === "perplexity") return `https://www.perplexity.ai/?q=${encoded}`;
  if (provider === "claude") return `https://claude.ai/new?q=${encoded}`;
  throw new Error(`Unknown provider: ${provider}`);
}

async function getCurrentSession() {
  const sessionData = await chrome.storage.session.get(["activeSession", "currentSession"]);
  const fromSession = sessionData.currentSession || sessionData.activeSession;
  if (fromSession) {
    return fromSession;
  }

  const localData = await chrome.storage.local.get(["activeSession", "currentSession"]);
  return localData.currentSession || localData.activeSession || null;
}

async function pushToRelay(bundle, recipientDid) {
  const { axoltlPrefs } = await chrome.storage.local.get(["axoltlPrefs"]);
  const recipientKey = axoltlPrefs?.toX25519PublicKey?.trim() || axoltlPrefs?.pairedPhoneKey?.trim();
  const toDid = (recipientDid || axoltlPrefs?.toDid || "").trim();

  try {
    if (!bundle) throw new Error("No active session");
    if (!toDid || !recipientKey) throw new Error("Missing paired phone settings");

    const relayUrl = await getRelayUrl();
    if (!relayUrl) throw new Error("Relay URL not configured");

    const identity = await getDeviceIdentity();
    const encrypted = await encryptForRecipient(bundle, recipientKey);
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

function buildContextString(session) {
  const msgs = Array.isArray(session?.messages) ? session.messages : [];
  const lastTwo = msgs
    .slice(-2)
    .map((m) => `${m.role === "user" ? "Me" : "AI"}: ${String(m.content || "").slice(0, 300)}`)
    .join("\n");

  const summary = typeof session?.summary === "string" && session.summary.trim().length
    ? session.summary.trim()
    : `This is a conversation about: ${String(msgs[0]?.content || "various topics").slice(0, 100)}`;

  return `${summary}\n\nRecent exchange:\n${lastTwo}\n\nPlease continue.`;
}

function buildInjectionUrl(provider, session) {
  const encoded = encodeURIComponent(buildContextString(session));
  const urls = {
    claude: `https://claude.ai/new?q=${encoded}`,
    chatgpt: `https://chatgpt.com/?q=${encoded}`,
    gemini: `https://gemini.google.com/app?q=${encoded}`,
    perplexity: `https://www.perplexity.ai/?q=${encoded}`
  };

  if (!urls[provider]) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  return urls[provider];
}

async function handleSwitchProvider(provider) {
  try {
    const session = await getCurrentSession();
    if (!session || !session.messages?.length) {
      return { success: false, ok: false, error: "No active session found. Start chatting first." };
    }
    const url = buildInjectionUrl(provider, session);
    await chrome.tabs.create({ url });
    return { success: true, ok: true, url };
  } catch (error) {
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

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

chrome.runtime.onInstalled.addListener(() => {
  getDeviceIdentity();
});

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
