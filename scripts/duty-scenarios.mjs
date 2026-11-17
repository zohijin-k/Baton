/* 듀티 탭 날짜 시트 시나리오 점검 + 화면 캡처 (360×740, 라이트·다크)
   사용: 서버를 띄운 뒤 (npm run dev 또는 npm run build && npm start)
        node scripts/duty-scenarios.mjs [주소=http://localhost:3000]
   결과: docs/screenshots/<YYYY-MM-DD>/duty-events/<테마>-*.png, 실패가 있으면 종료 코드 1
   - 시계를 2026-11-17 17:40(서울)으로 고정 (오늘 = 11/17)
   Chrome 경로는 CHROME_PATH, 결과 폴더는 CAPTURE_OUT 환경변수로 바꿀 수 있음 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv.find((a) => /^https?:/.test(a)) ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = process.env.CAPTURE_OUT ?? "docs/screenshots/2026-11-17/duty-events";
mkdirSync(OUT, { recursive: true });

let fails = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const theme of ["dark", "light"]) {
  console.log(`\n── ${theme} ──`);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  if (theme === "light") await ctx.addInitScript(() => localStorage.setItem("baton-theme", "light"));
  // 개발 서버의 Next.js 표시(N 배지)가 화면을 가리지 않게
  await ctx.addInitScript(() =>
    addEventListener("DOMContentLoaded", () => {
      const st = document.createElement("style");
      st.textContent = "nextjs-portal{display:none!important}";
      document.head.append(st);
    }),
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date("2026-11-17T17:40:00+09:00"));
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png`, ...opts });
  };

  /* 시작: PIN · 이름 → 듀티 탭 */
  await page.goto(BASE);
  await page.getByText("잠금 번호를 정해 주세요").waitFor();
  await page.keyboard.type("1234");
  await page.getByText("한 번 더 입력해 주세요").waitFor();
  await page.keyboard.type("1234");
  await page.getByLabel(/기록에 남길 이름/).fill("김간호");
  await page.getByRole("button", { name: "다음" }).click();
  await page.getByRole("button", { name: "건너뛰기" }).click();
  await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("button", { name: "듀티", exact: true }).click();

  const day = (m, d) => page.getByRole("button", { name: new RegExp(`^${m}월 ${d}일 `) });
  const sheet = page.getByRole("dialog", { name: /수정$/ });
  const neu = page.getByRole("dialog", { name: "새 일정" });
  const rows = () => sheet.getByRole("button", { name: /^일정 열기/ }).allTextContents();
  const labelOf = async (loc) => {
    await page.waitForTimeout(300);
    return loc.getAttribute("aria-label");
  };
  const closeByOverlay = () => sheet.getByRole("button", { name: "닫기" }).click({ position: { x: 180, y: 30 } });

  /* 1. 달력: 빈 달 안내 · 근무 · 역할 · 오늘 표시 */
  await shot("01-빈-달");
  check(await page.getByText("11월 근무표가 아직 없어요").isVisible(), "빈 달: 카드 아래 '근무표가 아직 없어요' + 빠르게 입력");
  await page.getByRole("button", { name: "빠르게 입력" }).click();
  const tool = (d) => page.getByRole("radiogroup", { name: "근무표 수정 도구" }).getByRole("radio", { name: d, exact: true }).click();
  await tool("D");
  for (const d of [2, 3, 15, 16, 17, 20]) await day(11, d).click();
  await tool("E");
  for (const d of [4, 5, 18]) await day(11, d).click();
  await tool("N");
  for (const d of [6, 7]) await day(11, d).click();
  await tool("OFF");
  for (const d of [8, 9, 19]) await day(11, d).click();
  await page.getByRole("button", { name: "완료" }).click();
  check(!(await page.getByText("근무표가 아직 없어요").isVisible()), "근무가 생기면 빈 달 안내 사라짐");
  for (const [d, role] of [
    [15, "차지"],
    [16, "액팅"],
    [17, "차지"],
  ]) {
    await day(11, d).click();
    await sheet.getByRole("radio", { name: role }).click();
    await sheet.getByRole("button", { name: "완료", exact: true }).click();
  }
  check(/D 근무, 차지/.test(await labelOf(day(11, 17))), "역할(차지) 저장");
  await shot("02-달력");
  await page.locator("[data-week]").nth(2).screenshot({ path: `${OUT}/${theme}-03-오늘-역할.png` });

  /* 2. 새 일정 시트: 하루 종일 꺼짐 · ✓ 저장 · X/Esc 취소 */
  await page.getByRole("button", { name: "다음 달" }).click();
  await day(12, 24).click();
  await sheet.getByRole("button", { name: "일정 추가" }).click();
  check(await neu.isVisible(), "일정 추가 → 날짜 시트 위에 '새 일정' 시트");
  check((await neu.getByRole("switch").getAttribute("aria-checked")) === "false", "하루 종일 꺼진 채 시작");
  check(await neu.getByRole("button", { name: "시작 오전 9:00" }).isVisible(), "시작 오전 9:00");
  check(await neu.getByRole("textbox", { name: "새 일정 제목" }).evaluate((el) => el === document.activeElement), "제목 입력에 포커스");
  await shot("04-새-일정");
  await neu.getByRole("button", { name: "저장" }).click({ force: true });
  check(await neu.isVisible(), "제목이 비면 ✓ 눌러도 저장 안 됨");

  // 보수교육 10:30 (분 휠을 마우스로 굴려 스냅), 파랑
  await neu.getByRole("textbox", { name: "새 일정 제목" }).fill("보수교육");
  await neu.getByRole("button", { name: /^일정 색/ }).click();
  await shot("05-색-팔레트");
  await neu.getByRole("radio", { name: "파랑" }).click();
  await neu.getByRole("button", { name: "시작 오전 9:00" }).click();
  await neu.getByRole("spinbutton", { name: "시" }).press("ArrowDown");
  const min = await neu.getByRole("spinbutton", { name: "분" }).boundingBox();
  await page.mouse.move(min.x + min.width / 2, min.y + min.height / 2);
  await page.mouse.wheel(0, 192);
  await page.waitForTimeout(500);
  check(await neu.getByRole("button", { name: "시작 오전 10:30" }).isVisible(), "휠 스크롤로 오전 10:30");
  await shot("06-시작-휠");
  await neu.getByRole("button", { name: "저장" }).click();
  check(!(await neu.isVisible()) && (await sheet.isVisible()), "✓ → 새 일정 시트만 닫힘");

  // 영화 19:00 (키보드로 휠 이동), + 종료 시간
  await sheet.getByRole("button", { name: "일정 추가" }).click();
  await neu.getByRole("textbox", { name: "새 일정 제목" }).fill("영화");
  await neu.getByRole("button", { name: "시작 오전 9:00" }).click();
  await neu.getByRole("spinbutton", { name: "오전/오후" }).press("ArrowDown");
  await neu.getByRole("spinbutton", { name: "시" }).press("ArrowUp");
  await neu.getByRole("spinbutton", { name: "시" }).press("ArrowUp");
  await neu.getByRole("button", { name: "+ 종료 시간" }).click();
  check(await neu.getByRole("button", { name: "종료 오후 8:00" }).isVisible(), "+ 종료 시간 → 시작 +1시간");
  await shot("07-종료-시간");
  await neu.getByRole("button", { name: "저장" }).click();

  // 연차 신청: 하루 종일, Enter로 저장
  await sheet.getByRole("button", { name: "일정 추가" }).click();
  await neu.getByRole("textbox", { name: "새 일정 제목" }).fill("연차 신청");
  await neu.getByRole("switch").click();
  check(!(await neu.getByRole("button", { name: /^시작 / }).isVisible()), "하루 종일 켜면 시작·종료 숨김");
  await neu.getByRole("textbox", { name: "새 일정 제목" }).press("Enter");

  // X · Esc 취소
  await sheet.getByRole("button", { name: "일정 추가" }).click();
  await neu.getByRole("textbox", { name: "새 일정 제목" }).fill("버릴 일정");
  await neu.getByRole("button", { name: "취소" }).click();
  await sheet.getByRole("button", { name: "일정 추가" }).click();
  await neu.getByRole("textbox", { name: "새 일정 제목" }).fill("버릴 일정");
  await page.keyboard.press("Escape");
  check(!(await neu.isVisible()) && (await sheet.isVisible()), "Esc → 새 일정 시트만 닫힘");
  check((await rows()).join("|") === "10:30보수교육|19:00영화|종일연차 신청", `목록 정렬: ${(await rows()).join("|")}`);
  await sheet.getByRole("button", { name: "일정 추가" }).evaluate((el) => el.scrollIntoView({ block: "end" }));
  await shot("08-일정-목록");

  /* 3. 기존 일정 펼침 (한 번에 하나) */
  await sheet.getByRole("button", { name: /^일정 열기: 19:00~20:00 영화/ }).click();
  check(await sheet.getByRole("button", { name: "시간: 12월 24일 (목) · 오후 7:00~오후 8:00, 눌러서 변경" }).isVisible(), "시간 요약 한 줄");
  await sheet.getByRole("button", { name: "일정 추가" }).evaluate((el) => el.scrollIntoView({ block: "end" }));
  await shot("09-영화-펼침");
  await sheet.getByRole("button", { name: /^일정 열기: 10:30 보수교육/ }).click();
  check((await sheet.getByRole("group", { name: "일정 상세" }).count()) === 1, "한 번에 하나만 펼침");
  await sheet.getByText("일정", { exact: true }).click();

  /* 4. '완료'로만 저장, 그냥 닫으면 버림 */
  await sheet.getByRole("button", { name: "완료", exact: true }).click();
  check(/일정 3개: 10:30 보수교육, 19:00 영화, 연차 신청/.test(await labelOf(day(12, 24))), "완료 → 저장");
  await day(12, 24).click();
  await sheet.getByRole("button", { name: "일정 삭제: 연차 신청" }).click();
  check((await rows()).length === 2, "줄 옆 X로 삭제");
  await sheet.getByRole("radio", { name: "N", exact: true }).click();
  await closeByOverlay();
  check(/근무 없음.*일정 3개/.test(await labelOf(day(12, 24))), "바깥 눌러 닫기 → 바꾼 내용 버림");
  await day(12, 24).click();
  await sheet.getByRole("radio", { name: "D", exact: true }).click();
  await page.keyboard.press("Escape");
  check(/근무 없음/.test(await labelOf(day(12, 24))), "Esc로 닫기 → 바꾼 내용 버림");
  await day(12, 24).click();
  await sheet.getByRole("button", { name: /^일정 열기: 19:00~20:00 영화/ }).click();
  await sheet.getByRole("textbox", { name: "일정 제목" }).fill("영화 예매");
  await sheet.getByRole("button", { name: "완료", exact: true }).click();
  check(/19:00 영화 예매/.test(await labelOf(day(12, 24))), "일정 카드를 펼친 채 완료 → 수정 반영");

  check(errors.length === 0, `페이지 오류 없음${errors.length ? `: ${errors.join(" / ")}` : ""}`);
  await ctx.close();
}

await browser.close();
console.log(`\n${fails ? `실패 ${fails}개` : "모두 통과"} · 캡처: ${OUT}`);
process.exit(fails ? 1 : 0);
