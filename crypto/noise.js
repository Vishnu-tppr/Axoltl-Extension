const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function generateEphemeralX25519() {
  return crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
}

export async function deriveSharedSecret(privateKey, publicKey) {
  return crypto.subtle.deriveBits({ name: "X25519", privateKey, public: publicKey }, privateKey, 256);
}

export async function hkdfAesKey(sharedSecret, saltBytes, info = "axoltl-session") {
  const baseKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: saltBytes,
      info: encoder.encode(info)
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptAesGcm(key, plaintext, iv) {
  const plainBytes = typeof plaintext === "string" ? encoder.encode(plaintext) : plaintext;
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBytes);
  return new Uint8Array(cipherBuffer);
}

export async function decryptAesGcm(key, ciphertext, iv) {
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return decoder.decode(plainBuffer);
}

export async function signPayloadEd25519(privateKey, payloadBytes) {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payloadBytes);
  return new Uint8Array(sig);
}

export async function verifyPayloadEd25519(publicKey, payloadBytes, signatureBytes) {
  return crypto.subtle.verify({ name: "Ed25519" }, publicKey, signatureBytes, payloadBytes);
}

export function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(b64) {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}
