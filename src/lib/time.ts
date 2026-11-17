import type { Duty, DutyTime, Shift } from "./types";

export const DUTY_LABEL: Record<Duty, string> = { D: "데이", E: "이브닝", N: "나이트" };

export const DEFAULT_DUTY_TIMES: Record<Duty, DutyTime> = {
  D: { start: "07:00", end: "15:00" },
  E: { start: "15:00", end: "23:00" },
  N: { start: "23:00", end: "07:00" },
};

const pad = (n: number) => String(n).padStart(2, "0");
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

export const hhmm = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 로컬 날짜 키 YYYY-MM-DD */
export const dateKey = (d: Date | number) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
export const parseDateKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (k: string, n: number) => {
  const d = parseDateKey(k);
  d.setDate(d.getDate() + n);
  return dateKey(d);
};
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** "11/18" */
export const shortDate = (k: string) => {
  const d = parseDateKey(k);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};
/** "11월 18일 (수)" */
export const longDate = (k: string) => {
  const d = parseDateKey(k);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
};

/** "15:00–23:00" */
export const windowLabel = (t: DutyTime) => `${t.start}–${t.end}`;

/** 근무 시작·종료 시각(ms). 끝이 시작보다 이르면 다음 날 */
export function shiftBounds(date: string, t: DutyTime) {
  const base = parseDateKey(date).getTime();
  const s = toMin(t.start);
  let e = toMin(t.end);
  if (e <= s) e += 1440;
  return { startAt: base + s * 60_000, endAt: base + e * 60_000 };
}

/** 근무가 시작된 날짜: 나이트 근무 중 자정 이후(종료 전)에 시작하면 전날 */
export function shiftDateFor(duty: Duty, t: DutyTime, now = new Date()) {
  const today = dateKey(now);
  const s = toMin(t.start);
  const e = toMin(t.end);
  const cur = now.getHours() * 60 + now.getMinutes();
  if (e <= s && cur < e + 120) return addDays(today, -1); // 종료 후 2시간까지는 어젯밤 근무로 봄
  return today;
}

/* ── 시각 찾기 ──
   explicit: 24시간제로 확실한 시각 ("14시", "08:00", "오후 2시", "2pm")
   그 외 ("8", "8시", "8:30")는 근무 시간 범위 안에 들어가는 쪽(오전/오후)으로 정한다 */
const UNIT = String.raw`(?!\s?(?:시간|분|cc|ml|mL|mg|g|kg|%|회|점|도|℃|개|일|팩|병|번|차|unit|u\b|L\b|\/))`;
const BARE_RE = new RegExp(String.raw`^\s*(\d{1,2})(?=\s+[^\s\d])${UNIT}`, "i");

interface Found {
  h: number;
  m: number;
  explicit: boolean;
}

function findTime(text: string, allowBare: boolean): Found | null {
  let m = text.match(/(?<![\d.])(\d{1,2}):([0-5]\d)(?!\d)/);
  if (m && +m[1] <= 24) {
    const h = +m[1] % 24;
    return { h, m: +m[2], explicit: m[1].length === 2 && (m[1].startsWith("0") || h >= 13 || h === 0) };
  }

  m = text.match(/(?<![A-Za-z\d])(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm|a\.m\.|p\.m\.)(?![A-Za-z])/i);
  if (m) {
    let h = +m[1] % 12;
    if (/^p/i.test(m[3])) h += 12;
    return { h, m: +(m[2] ?? 0), explicit: true };
  }

  m = text.match(/(오전|오후|새벽|저녁|밤)?\s?(?<![\d.])([01]?\d|2[0-4])\s?시(?!간)(?:\s?(반)|\s?([0-5]?\d)\s?분)?/);
  if (m) {
    let h = +m[2];
    const ampm = m[1];
    const min = m[3] ? 30 : m[4] ? +m[4] : 0;
    if (ampm) {
      if ((ampm === "오후" || ampm === "저녁" || ampm === "밤") && h < 12) h += 12;
      if ((ampm === "오전" || ampm === "새벽") && h === 12) h = 0;
      return { h: h % 24, m: min, explicit: true };
    }
    return { h: h % 24, m: min, explicit: h >= 13 || h === 0 || h === 24 || /^0\d/.test(m[2]) };
  }

  // 맨 앞의 숫자만 ("8 abx", "14 BST"): 단위·수치가 아니어야 함
  if (allowBare) {
    m = text.match(BARE_RE);
    if (m && +m[1] >= 0 && +m[1] <= 24) return { h: +m[1] % 24, m: 0, explicit: +m[1] >= 13 || /^0\d/.test(m[1]) };
  }
  return null;
}

/** h:m을 근무 시간 범위에 맞춤: h와 h+12 중 범위 안에 있는 쪽 */
function resolve(h: number, m: number, t: DutyTime | undefined): number {
  const mins = h * 60 + m;
  if (!t || h > 12) return mins;
  const s = toMin(t.start);
  let e = toMin(t.end);
  if (e <= s) e += 1440;
  const inside = (x: number) => {
    const k = x < s ? x + 1440 : x;
    return k >= s && k <= e;
  };
  const alt = (mins + 720) % 1440;
  if (inside(mins)) return mins;
  if (inside(alt)) return alt;
  return mins;
}

/** 문장에서 시각 하나를 찾아 "HH:MM". window를 주면 모호한 시각을 근무 시간 안으로 맞춘다 */
export function parseTime(text: string, window?: DutyTime, allowBare = false): string | null {
  const f = findTime(text, allowBare);
  if (!f) return null;
  return fmt(f.explicit ? f.h * 60 + f.m : resolve(f.h, f.m, window));
}

/** 할 일 표시용: 앞에 붙은 시각 표현을 떼어냄 ("16시 BT 재측정" → "BT 재측정", "8 abx" → "abx") */
const LEADING_TIME = new RegExp(
  String.raw`^\s*(?:(?:오전|오후|새벽|저녁|밤)\s?)?(?:[01]?\d|2[0-4])(?::[0-5]\d|\s?시(?!간)(?:\s?반|\s?[0-5]?\d\s?분)?|\s?(?:am|pm)|(?=\s+[^\s\d])${UNIT})\s*(?:에|까지|부터)?\s*`,
  "i",
);
export function stripLeadingTime(text: string): string {
  const out = text.replace(LEADING_TIME, "").trim();
  return out || text;
}

/** 근무 시작 시각 기준 정렬 키 (나이트 23시 → 01시 → 06시 순서). 시각 없으면 맨 뒤 */
export function timeSortKey(t: string | undefined, startMin: number): number {
  if (!t) return 10_000;
  return (toMin(t) - startMin + 1440) % 1440;
}

/** 지금이 근무 시작 후 몇 분째인지 (정렬 키와 같은 기준) */
export function nowKey(shift: Pick<Shift, "startAt">, now = Date.now()) {
  return Math.floor((now - shift.startAt) / 60_000);
}

export const startMinOf = (shift: Pick<Shift, "startAt">) => {
  const d = new Date(shift.startAt);
  return d.getHours() * 60 + d.getMinutes();
};

/** 근무 자체의 시간 범위 (설정이 근무 중에 바뀌어도 시작할 때 값 유지) */
export const shiftWindow = (shift: Pick<Shift, "startAt" | "endAt">): DutyTime => ({ start: hhmm(shift.startAt), end: hhmm(shift.endAt) });
