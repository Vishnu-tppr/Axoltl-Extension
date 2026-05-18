const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function generateEphemeralX25519(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as Promise<CryptoKeyPair>;
}

export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256);
}

export async function hkdfAesKey(sharedSecret: ArrayBuffer, saltBytes: Uint8Array, info = "axoltl-session"): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", sharedSecret as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: saltBytes as BufferSource, info: encoder.encode(info) as BufferSource },
    baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function encryptAesGcm(key: CryptoKey, plaintext: string | Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const plainBytes = typeof plaintext === "string" ? encoder.encode(plaintext) : plaintext;
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plainBytes as BufferSource);
  return new Uint8Array(cipherBuffer);
}

export async function decryptAesGcm(key: CryptoKey, ciphertext: Uint8Array, iv: Uint8Array): Promise<string> {
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
  return decoder.decode(plainBuffer);
}

export async function signPayloadEd25519(privateKey: CryptoKey, payloadBytes: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payloadBytes as BufferSource);
  return new Uint8Array(sig);
}

export async function verifyPayloadEd25519(publicKey: CryptoKey, payloadBytes: Uint8Array, signatureBytes: Uint8Array): Promise<boolean> {
  return crypto.subtle.verify({ name: "Ed25519" }, publicKey, signatureBytes as BufferSource, payloadBytes as BufferSource);
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}