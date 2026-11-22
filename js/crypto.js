// Encryption of the family file. Runs entirely in the browser (Web Crypto API).
//
// The family data is encrypted once with a random "data key" (AES-256-GCM).
// That data key is then locked separately with each access key ("slot"), so any of
// several keys (e.g. one per family side) opens the same tree. Access keys are
// turned into encryption keys with PBKDF2-SHA256, and are not case-sensitive.
//
// File (version 2):
// { format, version: 2, iv, ct, keys: [{ id, iterations, salt, iv, wrapped }] }
// Key names ("Beridze side") are stored inside the encrypted data, not in the file.

const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 600000;
export const MIN_KEY_LENGTH = 5;

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

const random = (n) => crypto.getRandomValues(new Uint8Array(n));

// "  Beridze " and "beridze" are the same key.
export function normalizeKey(key) {
  return (key || '').normalize('NFC').trim().toLowerCase();
}

async function deriveKey(secret, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const importDataKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

export function isEncryptedFile(obj) {
  return !!(obj && obj.format === 'familytree-encrypted' && obj.ct);
}

// A vault holds the data key (in memory only) and the locked copies of it, one per access key.
export function createVault() {
  return { raw: random(32), slots: [] };
}

export async function addKey(vault, key) {
  const salt = random(16);
  const iv = random(12);
  const kek = await deriveKey(normalizeKey(key), salt, ITERATIONS);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, vault.raw));
  const slot = {
    id: toB64(random(6)).replace(/[+/=]/g, 'x'),
    iterations: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    wrapped: toB64(wrapped),
  };
  vault.slots.push(slot);
  return slot.id;
}

export function removeKey(vault, id) {
  vault.slots = vault.slots.filter((s) => s.id !== id);
}

async function tryUnwrap(slot, key) {
  const kek = await deriveKey(key, fromB64(slot.salt), slot.iterations || ITERATIONS);
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(slot.iv) }, kek, fromB64(slot.wrapped));
  return { raw: new Uint8Array(raw), id: slot.id };
}

// Opens a file with one access key. Returns { vault, data, slotId }. Throws if no key matches.
export async function openFile(file, key) {
  if (file.version === 1 || !file.keys) {
    // First version of the file format: one passphrase, no slots. Convert to a vault.
    const kek = await deriveKey(key.normalize('NFC'), fromB64(file.salt), file.iterations || ITERATIONS);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, kek, fromB64(file.ct));
    const vault = createVault();
    const slotId = await addKey(vault, key);
    return { vault, data: JSON.parse(dec.decode(pt)), slotId };
  }
  const norm = normalizeKey(key);
  // Try all slots at once; the first one that unlocks wins.
  const { raw, id } = await Promise.any(file.keys.map((s) => tryUnwrap(s, norm)));
  const dataKey = await importDataKey(raw);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, dataKey, fromB64(file.ct));
  return { vault: { raw, slots: file.keys.map((s) => ({ ...s })) }, data: JSON.parse(dec.decode(pt)), slotId: id };
}

// Small extra data locked with the tree's own data key (see data/setup.enc.json).
export async function sealBox(vault, obj) {
  const iv = random(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importDataKey(vault.raw), enc.encode(JSON.stringify(obj))));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function openBox(vault, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, await importDataKey(vault.raw), fromB64(box.ct));
  return JSON.parse(dec.decode(pt));
}

// Encrypts the data with the vault's data key and attaches every locked copy of it.
export async function sealFile(vault, data) {
  if (!vault.slots.length) throw new Error('no keys');
  const iv = random(12);
  const dataKey = await importDataKey(vault.raw);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, enc.encode(JSON.stringify(data))));
  return {
    format: 'familytree-encrypted',
    version: 2,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iv: toB64(iv),
    ct: toB64(ct),
    keys: vault.slots,
  };
}
