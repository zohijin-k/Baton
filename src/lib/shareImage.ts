/* 듀티 '이미지로 공유': 1080×1350(세로 4:5) PNG를 기기 안 캔버스로 그린다 (서버 전송 없음).
   앱 화면과 같은 듀티 색·연속 막대·공휴일 색. 오늘 테두리·앞뒤 달 날짜·앱 이름은 그리지 않는다.
   크기는 360px 화면 설계값 × 3 기준.
   색은 globals.css 토큰과 같은 값 (공유 이미지 테마를 앱 테마와 다르게 고를 수 있어 여기 따로 둔다) */
import { holidayName } from "./holidays";
import { sortEvents } from "./shift";
import type { DutyDay, DutyMark, EventColor } from "./types";

export type ShareTheme = "dark" | "light";

interface Palette {
  bg: string;
  card: string;
  cardBorder: string;
  head: string;
  grid: string;
  ink: string;
  muted: string;
  weekday: string;
  holiday: string;
  roleInk: string;
  evText: string;
  sumLabel: string;
  sumNum: string;
  rBorder: string;
  duty: Record<DutyMark, { bg: string; ink: string }>;
  ev: Record<EventColor, string>;
}

const PALETTE: Record<ShareTheme, Palette> = {
  dark: {
    bg: "#111214",
    card: "#1b1d21",
    cardBorder: "rgba(255,255,255,0.08)",
    head: "#24272c",
    grid: "rgba(255,255,255,0.05)",
    ink: "#f1f1ef",
    muted: "#9a9da3",
    weekday: "#9a9da3",
    holiday: "#e8857a",
    roleInk: "#9a9da3",
    evText: "#c9cbcf",
    sumLabel: "#9a9da3",
    sumNum: "#f1f1ef",
    rBorder: "#5f636a",
    duty: {
      D: { bg: "#3a3015", ink: "#f4c95d" },
      E: { bg: "#3a2020", ink: "#f49b84" },
      N: { bg: "#22264a", ink: "#a9b1f5" },
      OFF: { bg: "#163028", ink: "#6ed6ae" },
      R: { bg: "#1b1d21", ink: "#9a9da3" },
    },
    ev: { violet: "#a970ff", cyan: "#4fb3f6", magenta: "#e87bc8", mint: "#45d0c2", orange: "#ff9d57" },
  },
  light: {
    bg: "#f6f4ef",
    card: "#ffffff",
    cardBorder: "rgba(0,0,0,0.06)",
    head: "#f3f2ee",
    grid: "rgba(0,0,0,0.06)",
    ink: "#2e2e2e",
    muted: "#686862",
    weekday: "#6b6e73",
    holiday: "#b5503f",
    roleInk: "#6b6e73",
    evText: "#4a4d52",
    sumLabel: "#4a4d52",
    sumNum: "#2a2b2e",
    rBorder: "#b9bbbf",
    duty: {
      D: { bg: "#fcefc7", ink: "#7a5a00" },
      E: { bg: "#fbe1da", ink: "#a2412a" },
      N: { bg: "#e3e5fb", ink: "#3b43a0" },
      OFF: { bg: "#ddf3ea", ink: "#1f6e54" },
      R: { bg: "#f7f7f8", ink: "#6b6e73" },
    },
    ev: { violet: "#7c4ddb", cyan: "#1a7fc4", magenta: "#b8338f", mint: "#0f8f84", orange: "#cf6118" },
  },
};

export const SHARE_W = 1080;
export const SHARE_H = 1350;
const S = 3; // 360px 설계 → 1080px
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const ORDER: DutyMark[] = ["OFF", "D", "E", "N", "R"];
const KO: Record<DutyMark, string> = { D: "데이", E: "이브닝", N: "나이트", OFF: "오프", R: "기타" };

export interface ShareOptions {
  theme: ShareTheme;
  events: boolean;
  roles: boolean;
  /** 사용자 이름 (없으면 표시 안 함) */
  name?: string;
  /** 근무 표기 (설정과 같음) */
  label: "short" | "korean";
  fontFamily: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const key = (y: number, m: number, d: number) => {
  const t = new Date(y, m, d);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: { tl: number; tr: number; br: number; bl: number }) {
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.arcTo(x + w, y, x + w, y + r.tr, r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
  ctx.lineTo(x + r.bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - r.bl, r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.arcTo(x, y, x + r.tl, y, r.tl);
  ctx.closePath();
}
const all = (r: number) => ({ tl: r, tr: r, br: r, bl: r });

/** 말줄임: 폭에 맞게 자르고 … */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** 그 달 공유 이미지를 캔버스에 그린다. byDate: 그 달(+앞뒤 하루)의 듀티 날짜 */
export function drawShareImage(canvas: HTMLCanvasElement, year: number, month: number, byDate: Map<string, DutyDay>, o: ShareOptions) {
  const p = PALETTE[o.theme];
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d")!;
  const font = (weight: number, px: number) => `${weight} ${px}px ${o.fontFamily}`;
  ctx.textBaseline = "middle";

  // 배경
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);

  // 상단: 2026년 11월 (+ 이름)
  const M = 16 * S; // 좌우 여백 48
  ctx.fillStyle = p.ink;
  ctx.font = font(700, 22 * S);
  ctx.textAlign = "left";
  ctx.fillText(`${year}년 ${month + 1}월`, M, 76);
  if (o.name) {
    ctx.fillStyle = p.muted;
    ctx.font = font(500, 14 * S);
    ctx.textAlign = "right";
    ctx.fillText(o.name, SHARE_W - M, 76);
  }

  // 그 달 칸 (앞뒤 달 날짜는 그리지 않음)
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((first + days) / 7);
  const dateAt = (w: number, c: number) => {
    const d = w * 7 + c - first + 1;
    return d >= 1 && d <= days ? key(year, month, d) : null;
  };
  const dutyOf = (k: string | null) => (k ? (byDate.get(k)?.duty ?? null) : null);

  // 달력 카드
  const cardX = M;
  const cardY = 140;
  const cardW = SHARE_W - M * 2;
  const sumH = 120;
  const footer = 48; // 요약 아래 여백
  const cardH = SHARE_H - cardY - 12 * S - sumH - footer;
  const weekdayH = 32 * S;
  const colW = cardW / 7;
  const rowH = (cardH - weekdayH) / weeks;

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, all(12 * S));
  ctx.fillStyle = p.card;
  ctx.fill();
  ctx.clip();
  // 요일 줄
  ctx.fillStyle = p.head;
  ctx.fillRect(cardX, cardY, cardW, weekdayH);
  ctx.font = font(500, 12 * S);
  ctx.textAlign = "center";
  ctx.fillStyle = p.weekday;
  WEEK.forEach((w, c) => ctx.fillText(w, cardX + colW * c + colW / 2, cardY + weekdayH / 2));
  // 칸 구분선
  ctx.strokeStyle = p.grid;
  ctx.lineWidth = 2;
  for (let c = 1; c < 7; c++) {
    ctx.beginPath();
    ctx.moveTo(cardX + colW * c, cardY + weekdayH);
    ctx.lineTo(cardX + colW * c, cardY + cardH);
    ctx.stroke();
  }
  for (let w = 0; w <= weeks; w++) {
    ctx.beginPath();
    ctx.moveTo(cardX, cardY + weekdayH + rowH * w);
    ctx.lineTo(cardX + cardW, cardY + weekdayH + rowH * w);
    ctx.stroke();
  }

  /* 이미지 칸은 앱보다 가로가 넓고 세로가 낮아(5주 달 약 178px) 칸 안 크기를 따로 둔다:
     위 10 · 날짜 40 · 4 · 막대 60 · 일정 줄(높이 30, 간격 4)은 남은 공간만큼 최대 2줄 */
  const top = 10;
  const dateH = 40;
  const barTop = top + dateH + 4;
  const barH = 60;
  const margin = 6 * S;
  const lineH = 30;
  const lineGap = 4;
  for (let w = 0; w < weeks; w++) {
    const y0 = cardY + weekdayH + rowH * w;
    // 날짜·역할·일정
    for (let c = 0; c < 7; c++) {
      const k = dateAt(w, c);
      if (!k) continue;
      const x0 = cardX + colW * c;
      const day = byDate.get(k);
      ctx.textAlign = "center";
      ctx.font = font(500, 38);
      ctx.fillStyle = holidayName(k) ? p.holiday : p.ink;
      ctx.fillText(String(Number(k.slice(8))), x0 + colW / 2, y0 + top + dateH / 2);
      if (o.roles && day?.role) {
        ctx.font = font(500, 28);
        ctx.fillStyle = p.roleInk;
        ctx.textAlign = "right";
        ctx.fillText(day.role === "charge" ? "차" : "액", x0 + colW - 14, y0 + 26);
      }
      const hol = holidayName(k);
      if (o.events && (day?.events?.length || hol)) {
        // 공휴일 이름이 첫 줄(공휴일 색, 막대 없음), 그 아래 개인 일정
        const personal = sortEvents(day?.events ?? []);
        const evs = [...(hol ? [{ id: "holiday", text: hol, holiday: true }] : []), ...personal.map((e) => ({ ...e, holiday: false }))];
        // 막대(또는 날짜) 아래 남은 공간에 들어가는 만큼만 (최대 2줄, 하나도 안 들어가면 생략)
        const evY = y0 + (day?.duty ? barTop + barH + lineGap : barTop);
        const lines = Math.min(2, Math.floor((y0 + rowH - evY - lineGap + lineGap) / (lineH + lineGap)));
        ctx.font = font(500, 26);
        evs.slice(0, Math.max(0, lines)).forEach((e, i, shown) => {
          const ly = evY + i * (lineH + lineGap);
          const rest = i === shown.length - 1 ? personal.length - shown.filter((x) => !x.holiday).length : 0;
          const lx = x0 + 9;
          let max = colW - 18 - 15;
          if (rest) {
            ctx.textAlign = "right";
            ctx.fillStyle = p.muted;
            ctx.fillText(`+${rest}`, x0 + colW - 9, ly + lineH / 2);
            max -= ctx.measureText(`+${rest}`).width + 6;
          }
          ctx.textAlign = "left";
          if (e.holiday) {
            ctx.fillStyle = p.holiday;
            ctx.fillText(fit(ctx, e.text, max + 15), lx, ly + lineH / 2);
            return;
          }
          ctx.fillStyle = p.ev[("color" in e && e.color) || "violet"];
          ctx.fillRect(lx, ly + 2, 6, lineH - 4);
          ctx.fillStyle = p.evText;
          ctx.fillText(fit(ctx, e.text, max), lx + 15, ly + lineH / 2);
        });
      }
    }
    // 연속 구간 막대 (주 안에서만 잇고, 앞뒤 날·주 경계로 이어지면 그쪽 끝은 직각)
    for (let c = 0; c < 7; c++) {
      const k = dateAt(w, c);
      const duty = dutyOf(k);
      if (!k || !duty) continue;
      let e = c;
      while (e < 6 && dutyOf(dateAt(w, e + 1)) === duty) e++;
      const prev = new Date(year, month, Number(k.slice(8)) - 1);
      const lastDate = dateAt(w, e)!;
      const next = new Date(year, month, Number(lastDate.slice(8)) + 1);
      const joinL = dutyOf(key(prev.getFullYear(), prev.getMonth(), prev.getDate())) === duty;
      const joinR = dutyOf(key(next.getFullYear(), next.getMonth(), next.getDate())) === duty;
      const bx = cardX + colW * c + (joinL ? 0 : margin);
      const bw = colW * (e - c + 1) - (joinL ? 0 : margin) - (joinR ? 0 : margin);
      const by = y0 + barTop;
      const r = 26;
      roundRect(ctx, bx, by, bw, barH, { tl: joinL ? 0 : r, bl: joinL ? 0 : r, tr: joinR ? 0 : r, br: joinR ? 0 : r });
      ctx.fillStyle = p.duty[duty].bg;
      ctx.fill();
      if (duty === "R") {
        ctx.strokeStyle = p.rBorder;
        ctx.lineWidth = S;
        ctx.stroke();
      }
      const txt = o.label === "korean" ? KO[duty] : duty;
      ctx.font = font(700, o.label === "korean" ? 34 : 40);
      ctx.textAlign = "center";
      ctx.fillStyle = p.duty[duty].ink;
      for (let i = c; i <= e; i++) ctx.fillText(txt, cardX + colW * i + colW / 2, by + barH / 2);
      c = e;
    }
  }
  ctx.restore();
  // 카드 테두리
  roundRect(ctx, cardX + 1, cardY + 1, cardW - 2, cardH - 2, all(12 * S));
  ctx.strokeStyle = p.cardBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // 요약: ● OFF 10 · ● D 4 …
  const counts = Object.fromEntries(ORDER.map((k) => [k, 0])) as Record<DutyMark, number>;
  for (let d = 1; d <= days; d++) {
    const v = dutyOf(key(year, month, d));
    if (v) counts[v]++;
  }
  const sy = cardY + cardH + 12 * S;
  roundRect(ctx, M, sy, cardW, sumH, all(sumH / 2));
  ctx.fillStyle = p.card;
  ctx.fill();
  ctx.strokeStyle = p.cardBorder;
  ctx.stroke();
  const slot = (cardW - 32 * S) / ORDER.length;
  ORDER.forEach((k, i) => {
    const cx = M + 16 * S + slot * i + slot / 2;
    ctx.font = font(500, 13 * S);
    const lw = ctx.measureText(k).width;
    ctx.font = font(600, 17 * S);
    const nw = ctx.measureText(String(counts[k])).width;
    const total = 8 * S + 6 * S + lw + 6 * S + nw;
    let x = cx - total / 2;
    ctx.beginPath();
    ctx.arc(x + 4 * S, sy + sumH / 2, 4 * S, 0, Math.PI * 2);
    ctx.fillStyle = p.duty[k].ink;
    ctx.fill();
    x += 8 * S + 6 * S;
    ctx.textAlign = "left";
    ctx.font = font(500, 13 * S);
    ctx.fillStyle = p.sumLabel;
    ctx.fillText(k, x, sy + sumH / 2);
    x += lw + 6 * S;
    ctx.font = font(600, 17 * S);
    ctx.fillStyle = p.sumNum;
    ctx.fillText(String(counts[k]), x, sy + sumH / 2);
  });
}

/** 캔버스 → PNG 파일. Web Share(파일)를 지원하면 공유 시트, 아니면 다운로드 */
export async function sharePng(canvas: HTMLCanvasElement, filename: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("이미지를 만들지 못했어요");
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
      // 공유 실패 시 다운로드로
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
