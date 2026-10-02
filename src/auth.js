// PIN hashing (PBKDF2) and signed session cookies (HMAC), using only WebCrypto.
const enc = new TextEncoder();
const ITER = 100000; // Workers' PBKDF2 ceiling

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function randomToken(bytes = 24) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function pbkdf2(pin, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

export async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await pbkdf2(pin, salt, ITER))}`;
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function verifyPin(pin, stored) {
  const [, iter, salt, hash] = String(stored).split('$');
  const got = new Uint8Array(await pbkdf2(pin, unb64(salt), Number(iter)));
  return sameBytes(got, unb64(hash));
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export async function signSession(secret, payload) {
  const body = b64(enc.encode(JSON.stringify(payload)));
  return `${body}.${b64(await hmac(secret, body))}`;
}

export async function readSession(secret, token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!sameBytes(await hmac(secret, body), unb64(sig))) return null;
  const p = JSON.parse(new TextDecoder().decode(unb64(body)));
  return p.exp > Date.now() ? p : null;
}
