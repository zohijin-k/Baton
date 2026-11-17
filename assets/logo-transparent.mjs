// 로고 바깥 흰 배경을 투명하게 (가장자리에서 flood fill): node assets/logo-transparent.mjs
import sharp from "sharp";
const { data, info } = await sharp("logo.png").resize(640, 640).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h } = info;
const seen = new Uint8Array(w * h);
const isWhite = (i) => data[i * 4] > 238 && data[i * 4 + 1] > 238 && data[i * 4 + 2] > 238;
const stack = [];
for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
while (stack.length) {
  const p = stack.pop();
  if (seen[p] || !isWhite(p)) continue;
  seen[p] = 1; data[p * 4 + 3] = 0;
  const x = p % w, y = (p / w) | 0;
  if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
}
// 경계 부드럽게: 투명 픽셀과 맞닿은 밝은 픽셀은 반투명
for (let p = 0; p < w * h; p++) {
  if (seen[p]) continue;
  const x = p % w, y = (p / w) | 0;
  const near = [p - 1, p + 1, p - w, p + w].some((q) => q >= 0 && q < w * h && seen[q] && Math.abs((q % w) - x) <= 1 && Math.abs(((q / w) | 0) - y) <= 1);
  if (near) { const lum = (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3; data[p * 4 + 3] = Math.max(0, Math.min(255, (255 - lum) * 6)); }
}
await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim().extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile("public/logo-full.png");
console.log("logo done");
