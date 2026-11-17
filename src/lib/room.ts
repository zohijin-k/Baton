/* 환자 ID = 호실-병상 ("501-1").
   병상 없이 호실만 쓰면 호실 전체 ("503" → 503호 전체).
   입력은 "501-1", "5011", "501 1", "501호 1번" 모두 "501-1"로 정규화한다.
   숫자만 쓴 경우는 설정의 '호실 자릿수'를 따른다.
   - 3자리(기본): "503" → 503호 전체, "5011" → 501-1. 4자리 호실은 "1201호", "1201-1"처럼 쓴다
   - 4자리: "1201" → 1201호 전체, "12011" → 1201-1 */

const MAX_BED = 20;
const MAX_RANGE = 40;

const num = (s: string) => String(Number(s));

export type RoomDigits = 3 | 4;
let roomDigits: RoomDigits = 3;
/** 설정의 호실 자릿수 (앱 시작·설정 변경 때 session에서 맞춘다) */
export const setRoomDigits = (d: RoomDigits) => {
  roomDigits = d;
};
export const getRoomDigits = () => roomDigits;
const validBed = (b: string) => Number(b) >= 1 && Number(b) <= MAX_BED;

export const isBed = (id: string) => id.includes("-");
export const roomOf = (id: string) => id.split("-")[0];
export const bedOf = (id: string) => (isBed(id) ? Number(id.split("-")[1]) : null);

/** 화면 표시: 병상은 그대로, 호실 전체는 "503호" */
export const idLabel = (id: string) => (id === "*" ? "병동" : isBed(id) ? id : `${id}호`);

/** 하나를 정규화. 알아볼 수 없으면 null */
export function normalizeId(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  if (!s) return null;

  // 숫자만: 호실 자릿수 이하 = 호실 전체, 그보다 1자리 많으면 호실 + 병상1
  // (3자리 설정에서는 5자리도 4자리 호실 + 병상으로 본다)
  if (/^\d+$/.test(s)) {
    if (s.length <= roomDigits) return Number(s) > 0 ? num(s) : null;
    if (s.length <= 5) {
      const room = s.slice(0, -1);
      const bed = s.slice(-1);
      return validBed(bed) ? `${num(room)}-${bed}` : null;
    }
    return null;
  }

  // 호실 전체: "503호", "1201호실", "503호 전체", "503 전체"
  let m = s.match(/^(\d{2,4}) ?(?:호실?)? ?(?:전체)?$/);
  if (m && /호|전체/.test(s)) return num(m[1]);

  // 호실-병상: "501-1", "501 1", "501호 1번", "501호-1", "501-1호", "501_1"
  m = s.match(/^(\d{2,4}) ?(?:호실? ?-? ?|[-_ ] ?)(\d{1,2}) ?(?:번(?: ?(?:침대|병상))?|호|bed)?$/i);
  if (m && validBed(m[2])) return `${num(m[1])}-${num(m[2])}`;

  return null;
}

/** 정렬: 호실 번호 → 호실 전체 먼저 → 병상 번호 */
export function compareIds(a: string, b: string) {
  if (a === b) return 0;
  if (a === "*") return 1;
  if (b === "*") return -1;
  const ra = Number(roomOf(a));
  const rb = Number(roomOf(b));
  if (ra !== rb) return ra - rb;
  return (bedOf(a) ?? 0) - (bedOf(b) ?? 0);
}

export const sortIds = (ids: string[]) => [...ids].sort(compareIds);

function expandRange(a: string, b: string): string[] | null {
  const from = normalizeId(a);
  if (!from) return null;
  // "501-1~4" : 같은 호실의 병상 범위 축약
  const tail = b.trim().replace(/(?:번|호)$/, "");
  const to = isBed(from) && /^\d{1,2}$/.test(tail) ? `${roomOf(from)}-${num(tail)}` : normalizeId(b);
  if (!to) return null;

  const out: string[] = [];
  if (isBed(from) && isBed(to)) {
    if (roomOf(from) !== roomOf(to)) return null; // 호실이 다르면 병상 수를 알 수 없음
    const [x, y] = [bedOf(from)!, bedOf(to)!].sort((p, q) => p - q);
    for (let i = x; i <= y; i++) out.push(`${roomOf(from)}-${i}`);
  } else if (!isBed(from) && !isBed(to)) {
    // "501~505" : 호실 전체 범위
    const [x, y] = [Number(from), Number(to)].sort((p, q) => p - q);
    if (y - x + 1 > MAX_RANGE) return null;
    for (let i = x; i <= y; i++) out.push(String(i));
  } else return null;
  return out.length <= MAX_RANGE ? out : null;
}

/** 쉼표로 구분한 목록 → 정규화한 ID (범위 "501-1~501-4", "501-1~4", "501~503" 지원) */
export function parseIdList(input: string): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  const push = (id: string) => !ids.includes(id) && ids.push(id);

  for (const raw of input.split(/[,，、\n;]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    if (/[~～]/.test(tok)) {
      const [a, b, ...rest] = tok.split(/\s*[~～]\s*/);
      const range = rest.length === 0 && b !== undefined ? expandRange(a, b) : null;
      if (range) range.forEach(push);
      else invalid.push(tok);
      continue;
    }
    const one = normalizeId(tok);
    if (one) {
      push(one);
      continue;
    }
    // 띄어쓰기로 여러 개를 쓴 경우: "501-1 502-3"
    const parts = tok.split(" ").map(normalizeId);
    if (parts.length > 1 && parts.every((p): p is string => !!p && isBed(p))) parts.forEach(push);
    else invalid.push(tok);
  }
  return { ids, invalid };
}

/** a가 b를 포함하는지: "503"은 "503-2"를 포함 */
export const covers = (a: string, b: string) => a === b || (!isBed(a) && roomOf(b) === a);

/* ── 자유 메모에서 환자 언급 찾기 (병동 전체 모드) ──
   문장 속에서는 오탐을 줄이려고 형태를 좁힌다:
   - "501-1", "501-1호", "501호 1번", "501호-1"
   - "503호" (호실 전체)
   - 줄 맨 앞의 호실 자릿수 숫자 "503 NPO" (시각·수치로 이어지면 제외) */
export interface Mention {
  id: string;
  start: number;
  end: number;
}

const UNIT_AFTER = /^\s?(?:시|분|cc|ml|mL|mg|g|kg|%|회|점|도|℃|개|일|팩|unit|u\b|\/|\.\d|:\d)/i;

export function findMentions(text: string): Mention[] {
  const out: Mention[] = [];
  const taken = (s: number, e: number) => out.some((m) => s < m.end && e > m.start);
  const add = (id: string | null, start: number, end: number) => {
    if (id && !taken(start, end)) out.push({ id, start, end });
  };

  for (const m of text.matchAll(/(?<![\d.:/-])(\d{3,4})\s?(?:호실?\s?-?\s?|-\s?)(\d{1,2})(?:\s?번(?:\s?(?:침대|병상))?|\s?호)?(?![\d:/.])/g)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    // "501호 1시"처럼 숫자가 시각이면 병상이 아님
    if (!validBed(m[2]) || /^\s?(?:시|분)/.test(after)) continue;
    // "501호 1" 처럼 '번' 없이 띄어 쓴 경우는 시각·수치일 수 있어 제외
    if (/호실?\s\d/.test(m[0]) && !/번/.test(m[0])) continue;
    add(`${num(m[1])}-${num(m[2])}`, m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  for (const m of text.matchAll(/(?<![\d.:/-])(\d{3,4})\s?호(?:실)?(?!\d)/g)) {
    add(num(m[1]), m.index ?? 0, (m.index ?? 0) + m[0].length);
  }
  const lineStart = new RegExp(`^[ \\t]*(\\d{${roomDigits}})(?=[ \\t:：)]|$)`, "gm");
  for (const m of text.matchAll(lineStart)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[1]);
    const end = start + m[1].length;
    if (UNIT_AFTER.test(text.slice(end))) continue;
    add(num(m[1]), start, end);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 자유 메모를 환자별 조각으로 나눔. 언급 전에 쓴 글은 room=null */
export function splitByMentions(text: string): { ids: string[] | null; text: string }[] {
  const ms = findMentions(text);
  const groups: { ids: string[]; start: number; end: number }[] = [];
  for (const m of ms) {
    const last = groups[groups.length - 1];
    // "501-1, 501-2 NPO" 처럼 붙어 있는 언급은 같은 내용을 공유
    if (last && /^[\s,·/&및와과]*$/.test(text.slice(last.end, m.start))) {
      if (!last.ids.includes(m.id)) last.ids.push(m.id);
      last.end = m.end;
    } else groups.push({ ids: [m.id], start: m.start, end: m.end });
  }
  const clean = (s: string) => s.replace(/^[\s:：\-–)\]]+/, "").trim();
  const out: { ids: string[] | null; text: string }[] = [];
  const head = clean(text.slice(0, groups[0]?.start ?? text.length));
  if (head) out.push({ ids: null, text: head });
  groups.forEach((g, i) => {
    const body = clean(text.slice(g.end, groups[i + 1]?.start ?? text.length));
    out.push({ ids: g.ids, text: body });
  });
  return out;
}
