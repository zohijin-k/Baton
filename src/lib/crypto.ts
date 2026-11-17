/* Web Crypto: 4자리 PIN → PBKDF2 해시 (잠금 확인용).
   v1부터 실명을 저장하지 않으므로 데이터 암호화 키는 만들지 않는다. */

const ITERATIONS = 310_000;
const enc = new TextEncoder();

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const randomSalt = () => toB64(crypto.getRandomValues(new Uint8Array(16)));

export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromB64(salt), iterations: ITERATIONS, hash: "SHA-256" }, key, 256);
  return toB64(bits);
}

/** 시간 차이로 해시가 새지 않도록 고정 시간 비교 */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
