// 아이콘 생성: node assets/make-icons.mjs
import sharp from "sharp";
import { readFileSync } from "node:fs";
const svg = readFileSync("assets/icon.svg", "utf8");
const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
// scale: 꽃이 차지할 비율, bg: 배경색(null이면 투명), r: 모서리 반경 비율
const wrap = (scale, bg, r = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${
  bg ? `<rect width="512" height="512" rx="${512 * r}" fill="${bg}"/>` : ""
}<g transform="translate(${256 - 256 * scale} ${256 - 256 * scale}) scale(${scale})">${inner}</g></svg>`;
const out = async (s, size, file) => sharp(Buffer.from(s)).resize(size, size).png().toFile(file);
await out(wrap(0.86, "#F6F4EF", 0.22), 192, "public/icon-192.png");
await out(wrap(0.86, "#F6F4EF", 0.22), 512, "public/icon-512.png");
await out(wrap(0.62, "#F6F4EF"), 512, "public/icon-maskable-512.png"); // 안전영역 80% 안에 들어가도록
await out(wrap(0.8, "#F6F4EF"), 180, "public/apple-touch-icon.png");
await out(wrap(1, null), 32, "public/favicon-32.png");
await out(wrap(1, null), 32, "src/app/icon.png");
console.log("icons done");
