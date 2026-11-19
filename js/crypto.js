// Encryption of the family file. Runs entirely in the browser (Web Crypto API).
// AES-256-GCM, key derived from the passphrase with PBKDF2-SHA256.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 600000;

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromB64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function isEncryptedFile(obj) {
  return obj && obj.format === 'familytree-encrypted' && obj.ct;
}

export async function encryptJson(data, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)));
  return {
    format: 'familytree-encrypted',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

// Throws if the passphrase is wrong (AES-GCM authentication fails).
export async function decryptJson(file, passphrase) {
  const key = await deriveKey(passphrase, fromB64(file.salt), file.iterations || ITERATIONS);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.ct));
  return JSON.parse(dec.decode(pt));
}
