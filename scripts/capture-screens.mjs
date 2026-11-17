/* v1 화면 캡처 + 글자 대비 자동 측정 (360px)
   사용: npm run build && npm start (포트 3000) 후
        node scripts/capture-screens.mjs [주소=http://localhost:3000] [--theme dark|light]
   결과: docs/screenshots/<YYYY-MM-DD>/v1-<테마>/ 에 화면 PNG, contrast-report.md, overview.png
   - 시계를 2026-11-17 17:40(서울)으로 고정해 이브닝 근무 중 '다음 할 일' 강조가 항상 같게 나오도록 함
   - dark: 기기 설정을 '밝게'로 둔 채 첫 실행 → 기본값(어둡게)으로 뜨는지 함께 확인
   Chrome 경로는 CHROME_PATH, 결과 폴더는 CAPTURE_OUT 환경변수로 바꿀 수 있음 (개발 서버 `npm run dev`에서도 동작) */
import { chromium } from "playwright-core";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const BASE = args.find((a) => /^https?:/.test(a)) ?? "http://localhost:3000";
const THEME = args.includes("light") || args.includes("--theme=light") ? "light" : "dark";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NOW = new Date("2026-11-17T17:40:00+09:00");
const DATE = "2026-11-17";
const OUT = process.env.CAPTURE_OUT ?? `docs/screenshots/${DATE}/v1-${THEME}`;
mkdirSync(OUT, { recursive: true });

/* 페이지 안에서 실행: 보이는 글자마다 실제 배경과의 대비 계산 */
function measure() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (str) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = str;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? [0, 0, 0, 0] : [r, g, b, a / 255];
  };
  const over = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  const mix = (c, under, o) => [0, 1, 2].map((i) => c[i] * o + under[i] * (1 - o)).concat(1);
  const lum = (c) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  /** 요소의 글자색·배경색을 조상 레이어·opacity까지 합성해 계산 */
  const resolve = (el, colorStr) => {
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.unshift(e);
    let bg = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (bg[3] === 0) bg = [255, 255, 255, 1];
    const groups = [];
    for (const e of chain) {
      const cs = getComputedStyle(e);
      const o = parseFloat(cs.opacity);
      if (o < 1) groups.push({ under: bg, o });
      const b = rgba(cs.backgroundColor);
      if (b[3] > 0) bg = over(b, bg);
    }
    let fg = over(rgba(colorStr), bg);
    for (let i = groups.length - 1; i >= 0; i--) {
      fg = mix(fg, groups[i].under, groups[i].o);
      bg = mix(bg, groups[i].under, groups[i].o);
    }
    return { fg, bg };
  };

  const items = [];
  const seen = new Set();
  const visibleAt = (el, rect) => {
    const x = Math.min(Math.max(rect.left + rect.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 1), innerHeight - 1);
    if (rect.bottom < 0 || rect.top > innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    return !!top && (el.contains(top) || top.contains(el));
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode;
    const text = t.textContent.trim();
    if (!text) continue;
    const el = t.parentElement;
    if (el.closest(".sr-only,[aria-hidden=true]") || seen.has(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 || !visibleAt(el, rect)) continue;
    seen.add(el);
    const { fg, bg } = resolve(el, getComputedStyle(el).color);
    items.push({ text: text.slice(0, 24), fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg), disabled: !!el.closest(":disabled,[aria-disabled=true]") });
  }
  // 입력창 placeholder
  for (const inp of document.querySelectorAll("input[placeholder],textarea[placeholder]")) {
    if (inp.value || !visibleAt(inp, inp.getBoundingClientRect())) continue;
    const { fg, bg } = resolve(inp, getComputedStyle(inp, "::placeholder").color);
    items.push({ text: `(placeholder) ${inp.placeholder.split("\n")[0].slice(0, 16)}`, fg: hex(fg), bg: hex(bg), ratio: ratio(fg, bg), disabled: false });
  }
  return { items, sw: document.documentElement.scrollWidth, theme: document.documentElement.dataset.theme };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  locale: "ko-KR",
  timezoneId: "Asia/Seoul",
  colorScheme: THEME === "dark" ? "light" : "dark", // 기기 설정과 반대로 두어 앱 테마가 우선하는지 확인
});
if (THEME === "light") await ctx.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("baton-theme", "light"); sessionStorage.setItem("seeded", "1"); } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
await ctx.addInitScript(() => {
  // 개발 서버의 Next.js 표시(N 배지)가 하단 탭을 가리지 않게
  addEventListener("DOMContentLoaded", () => {
    const st = document.createElement("style");
    st.textContent = "nextjs-portal{display:none!important}";
    document.head.append(st);
  });
});
const page = await ctx.newPage();
await page.clock.setFixedTime(NOW);
const results = [];
const shot = async (name, wait = 350) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  results.push({ name, ...(await page.evaluate(measure)) });
};
const waitToast = () => page.waitForTimeout(2600); // 토스트가 사라진 뒤 캡처
const tab = (name) => page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name, exact: true }).click();
const day = (d) => page.getByRole("button", { name: new RegExp(`^11월 ${d}일 `) });

/* ── 시작: PIN · 이름 ── */
await page.goto(BASE);
await page.getByText("잠금 번호를 정해 주세요").waitFor();
await page.keyboard.type("1234");
await page.getByText("한 번 더 입력해 주세요").waitFor();
await page.keyboard.type("1234");
await page.getByLabel(/기록에 남길 이름/).fill("김간호");
await page.getByRole("button", { name: "다음" }).click();
await page.getByRole("button", { name: "건너뛰기" }).click();
await page.getByRole("button", { name: "근무 시작" }).waitFor();

/* ── 듀티: 근무표 수정 → 날짜 바텀시트 → 월간 ── */
await tab("듀티");
await page.getByRole("button", { name: "근무표 수정" }).click();
const plan = {
  D: [2, 3, 4, 9, 10, 11, 22, 23, 30],
  E: [5, 6, 12, 13, 17, 24],
  N: [7, 8, 14, 15, 18, 19, 25, 26],
  OFF: [1, 16, 20, 21, 27, 28, 29],
};
for (const [duty, days] of Object.entries(plan)) {
  await page.getByRole("radiogroup", { name: "근무표 수정 도구" }).getByRole("radio", { name: duty, exact: true }).click();
  for (const d of days) await day(d).click();
  if (duty === "N") await shot("11-quick-input");
}
await page.getByRole("button", { name: "완료" }).click();
// 일정 추가: '일정 추가' → 위에 겹친 '새 일정' 시트(✓ 목록에 추가) → 날짜 시트 '완료'로 저장
const newEvent = page.getByRole("dialog", { name: "새 일정" });
await day(25).click();
await page.getByRole("button", { name: "일정 추가" }).click();
await newEvent.getByRole("textbox", { name: "새 일정 제목" }).fill("연차 신청 마감");
await newEvent.getByRole("switch").click(); // 하루 종일
await newEvent.getByRole("button", { name: "저장" }).click();
await page.getByRole("button", { name: "완료", exact: true }).click();
await day(17).click();
await page.getByRole("button", { name: "일정 추가" }).click();
await newEvent.getByRole("textbox", { name: "새 일정 제목" }).fill("보호자 김철수 010-1234-5678 회신");
await page.getByText("환자 정보는 적지 않아요").waitFor();

await shot("10-day-sheet");
await newEvent.getByRole("textbox", { name: "새 일정 제목" }).fill("BLS 교육");
await newEvent.getByRole("button", { name: "시작 오전 9:00" }).click();
for (let i = 0; i < 5; i++) await newEvent.getByRole("spinbutton", { name: "시" }).press("ArrowDown"); // 오후 2시
await newEvent.getByRole("spinbutton", { name: "오전/오후" }).press("ArrowDown");
await newEvent.getByRole("button", { name: "저장" }).click();
await page.getByRole("button", { name: "완료", exact: true }).click();
await shot("09-duty-month");

/* ── 근무 시작 ── */
await tab("할 일");
await page.getByText("다음 근무 · 11/18 N").waitFor();
await shot("01-start");
await page.getByRole("button", { name: "근무 시작" }).click();
await page.getByRole("radio", { name: "액팅" }).click();
await page.getByLabel("호실-병상").pressSequentially("501-1~3,5021,503,");
await page.getByLabel("호실-병상").pressSequentially("50");
await shot("02-start-setup");
await page.getByLabel("호실-병상").fill("");

/* ── 인계 메모 → 할 일 ── */
await page.getByRole("button", { name: "인계 받기 시작" }).click();
await page.locator("#memo-501-1").waitFor();
await page.locator("#memo-501-1").fill("8 abx, NPO, 낙상 주의\n22시 V/S 재측정");
await page.locator("#memo-501-3").fill("보호자 상주, 19:30 CT");
await page.locator("#memo-502-1").fill("알레르기 확인, 21시 수액 교체");
await page.locator("#memo-503").fill("격리 유지, 20시 I/O 체크");
await page.locator("#memo-501-2").click();
await page.locator("#memo-501-2").pressSequentially("18시 BST, ");
await page.getByRole("button", { name: "드레싱", exact: true }).click();
await page.locator("#memo-501-2").pressSequentially("교체");
await shot("03-memo");
await page.getByRole("button", { name: "리스트 만들기" }).click();
await page.getByText("확인 필요").first().waitFor();
await page.getByRole("checkbox", { name: /드레싱 교체 완료/ }).click();
await page.getByRole("button", { name: /20:00 abx/ }).click();
await waitToast();
await shot("04-tasks-time", 0);
await page.getByRole("radio", { name: "호실별" }).click();
await shot("05-tasks-room");
await page.getByRole("radio", { name: "시간순" }).click();

/* ── 기록 ── */
await tab("기록");
await page.getByRole("radio", { name: "502-1" }).click();
await page.getByLabel("키워드").fill("식사 1/2, 배뇨 양호");
await page.getByRole("button", { name: "문장 만들기" }).click();
await page.getByRole("button", { name: "확인" }).click();
await page.getByRole("button", { name: "확정", exact: true }).click();
await page.getByRole("radio", { name: "501-1" }).click();
await page.getByLabel("키워드").fill("통증 NRS 6 / PRN 진통제 IV / 30분 후 NRS 3");
await page.getByRole("button", { name: "문장 만들기" }).click();
await page.getByRole("button", { name: "확인" }).click();
await page.getByRole("button", { name: "확정", exact: true }).click();
await page.getByText("확정했어요").waitFor();
await page.getByLabel("키워드").fill("BT 37.8, 수면 양호");
await page.getByRole("button", { name: "문장 만들기" }).click();
await page.getByText("초안", { exact: true }).waitFor();
await waitToast();
await shot("06-record", 0);
await page.getByRole("button", { name: "확인" }).click();
await page.getByRole("button", { name: "확정", exact: true }).click();
await waitToast();

/* ── 인계 ── */
await tab("인계");
await page.getByRole("button", { name: "인계 만들기" }).click();
await page.getByText("초안", { exact: true }).first().waitFor();
await page.getByRole("button", { name: "확인" }).click();
await page.getByRole("button", { name: "확정", exact: true }).click();
await page.getByRole("button", { name: "근무 종료" }).waitFor();
await waitToast();
await shot("07-handoff-emr", 0);
await page.getByRole("radio", { name: "말로 인계" }).click();
await shot("08-handoff-verbal");
await browser.close();
results.sort((a, b) => a.name.localeCompare(b.name));

/* 보고서 */
const MIN = 4.5;
const label = THEME === "dark" ? "다크" : "라이트";
const cond = THEME === "dark" ? "기기 설정 '밝게' 상태에서 첫 실행 → 앱 기본값(어둡게), 시계 2026-11-17 17:40 고정" : "기기 설정 '어둡게' 상태에서 앱 테마 '밝게' 지정, 시계 2026-11-17 17:40 고정";
let md = `# ${label} 모드 화면 · 대비 측정 (${DATE})\n\n- 화면 360×740, ${cond}\n- 기준: 모든 글자 ${MIN}:1 이상 (비활성 버튼 글자는 WCAG 예외라 따로 표시)\n- 배경은 겹친 레이어·투명도·opacity를 합성한 실제 색으로 계산\n\n`;
md += `| 화면 | 테마 | 측정 글자 | 최저 대비 | 4.5 미만 | 가로 스크롤 |\n|---|---|---|---|---|---|\n`;
let fails = 0;
const failRows = [];
const disabledRows = [];
for (const r of results) {
  const active = r.items.filter((i) => !i.disabled);
  const bad = active.filter((i) => i.ratio < MIN);
  fails += bad.length;
  bad.forEach((b) => failRows.push(`| ${r.name} | ${b.text} | ${b.fg} | ${b.bg} | ${b.ratio.toFixed(2)} |`));
  r.items.filter((i) => i.disabled).forEach((b) => disabledRows.push(`| ${r.name} | ${b.text} | ${b.fg} | ${b.bg} | ${b.ratio.toFixed(2)} |`));
  const min = Math.min(...active.map((i) => i.ratio));
  md += `| ${r.name} | ${r.theme} | ${active.length} | ${min.toFixed(2)} | ${bad.length} | ${r.sw > 360 ? "있음" : "없음"} |\n`;
}
md += `\n**결과: 4.5:1 미만 ${fails}건**\n`;
if (failRows.length) md += `\n## 4.5:1 미만\n\n| 화면 | 글자 | 글자색 | 배경 | 대비 |\n|---|---|---|---|---|\n${failRows.join("\n")}\n`;
if (disabledRows.length) md += `\n## 비활성 요소 (기준 예외)\n\n| 화면 | 글자 | 글자색 | 배경 | 대비 |\n|---|---|---|---|---|\n${[...new Set(disabledRows)].join("\n")}\n`;
writeFileSync(`${OUT}/contrast-report.md`, md);

// 한눈에 보기: 4열 그리드
const W = 180, H = 370, G = 8, COLS = 4;
const rows = Math.ceil(results.length / COLS);
const comps = await Promise.all(
  results.map(async (r, i) => ({ input: await sharp(`${OUT}/${r.name}.png`).resize(W).toBuffer(), left: (i % COLS) * (W + G), top: Math.floor(i / COLS) * (H + G) })),
);
await sharp({ create: { width: COLS * W + (COLS - 1) * G, height: rows * H + (rows - 1) * G, channels: 3, background: "#7a7d7b" } })
  .composite(comps)
  .png()
  .toFile(`${OUT}/overview.png`);

console.log(md);
