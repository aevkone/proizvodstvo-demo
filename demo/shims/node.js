// Заглушки node-модулей для браузерной демо-сборки

// --- crypto (демо: пароли хэшируются простым способом, это не продакшн) ---
const hex = (arr) => [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
class Hex {
  constructor(h) { this.hex = h; this.length = h.length / 2; }
  toString() { return this.hex; }
}
export function randomBytes(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return new Hex(hex(a));
}
export function scryptSync(pw, salt, len) {
  // FNV-1a по кругу — достаточно для демо-стенда без реальных данных
  const out = new Uint8Array(len);
  let h = 2166136261;
  const s = `${salt}:${pw}`;
  for (let r = 0; r < len; r++) {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) + r; h = Math.imul(h, 16777619) >>> 0; }
    out[r] = h & 255;
  }
  return new Hex(hex(out));
}
export function timingSafeEqual(a, b) {
  return a.hex === b.hex;
}
if (!globalThis.Buffer) globalThis.Buffer = { from: (s) => new Hex(String(s)) };

// --- fs / path / url ---
export function mkdirSync() {}
export function writeFileSync() {}
export function rmSync() {}
export function readFileSync() { return ''; }
export function join(...p) { return p.join('/'); }
export function dirname(p) { return String(p).split('/').slice(0, -1).join('/'); }
export function resolve(...p) { return p.join('/'); }
export function fileURLToPath(u) { return String(u); }
export function pathToFileURL(p) { return { href: 'file://' + (p || '') }; }
export const tmpdir = () => '/tmp';

export default { randomBytes, scryptSync, timingSafeEqual, mkdirSync, writeFileSync, rmSync, readFileSync, join, dirname, resolve };
