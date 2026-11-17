/* 전송 전 비식별 필터.
   hard: 호실-병상·전화번호·주민번호 → [무시하고 전송]을 눌러도 자동으로 가림
   soft: 날짜·병록번호 형태·이름 패턴 → 사용자가 무시하고 보낼 수 있음
   (앱은 실명을 입력받지 않는다. 이름 패턴은 메모에 섞여 들어온 경우를 잡기 위한 것) */

export type HitType = "phone" | "rrn" | "mrn" | "date" | "name" | "room";

export interface Hit {
  start: number;
  end: number;
  type: HitType;
  hard: boolean;
}

export const HIT_LABEL: Record<HitType, string> = {
  phone: "전화번호",
  rrn: "주민번호",
  mrn: "번호(6자리+)",
  date: "날짜",
  name: "이름 의심",
  room: "호실-병상",
};

const HARD: Record<HitType, boolean> = {
  phone: true,
  rrn: true,
  room: true,
  mrn: false,
  date: false,
  name: false,
};

/** "환자/보호자/님" 주변에 와도 이름이 아닌 흔한 단어 */
const NOT_NAME = new Set([
  "상태", "상태가", "상태는", "본인", "교육", "면담", "설명", "요청", "호소", "확인", "모두", "에게", "께서",
  "가족", "분이", "분께", "측", "의", "이", "가", "는", "은", "와", "과", "선생", "교수", "간호사", "주치의",
  "담당", "병동", "입원", "퇴원", "보호", "상주", "부재", "동반", "연락", "통화", "방문", "면회", "께", "에게서",
  "에", "도", "만", "을", "를", "과의", "와의", "안정", "불안", "협조", "비협조", "거부", "동의",
  "연락처", "동의서", "서명", "상담", "문의", "전화", "귀가", "대기", "체류", "교대", "부탁", "정보",
]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 동료 호칭("김선생님", "박교수님")은 환자 이름이 아님 */
const TITLE_END = /(선생|교수|과장|팀장|수간|주임|책임|원장|쌤|샘)$/;

export function detectPII(text: string, opts: { rooms?: string[] } = {}): Hit[] {
  const hits: Hit[] = [];
  const add = (re: RegExp, type: HitType, group = 0) => {
    for (const m of text.matchAll(re)) {
      const g = m[group];
      if (!g) continue;
      const start = (m.index ?? 0) + (group ? m[0].indexOf(g) : 0);
      hits.push({ start, end: start + g.length, type, hard: HARD[type] });
    }
  };

  // 주민등록번호
  add(/(?<!\d)\d{6}\s?-\s?[1-8]\d{6}(?!\d)/g, "rrn");
  // 전화번호 (휴대폰·지역번호·내선 형태)
  add(/(?<!\d)0\d{1,2}[\s.-]?\d{3,4}[\s.-]?\d{4}(?!\d)/g, "phone");
  // 병록번호 등 6자리 이상 숫자
  add(/(?<![\d.])\d{6,}(?![\d.])/g, "mrn");
  // 날짜
  add(/(?<!\d)(?:19|20)\d{2}\s?[-./년]\s?\d{1,2}\s?[-./월]\s?\d{1,2}일?(?!\d)/g, "date");
  // M/D 날짜. 단, 1/2·2/3·3/4처럼 분자 < 분모 ≤ 4인 분수(식사량 등)는 날짜로 보지 않음
  for (const m of text.matchAll(/(?<![\d./])((?:0?[1-9]|1[0-2]))\/((?:0?[1-9]|[12]\d|3[01]))(?![\d/])/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a < b && b <= 4) continue;
    const start = m.index ?? 0;
    hits.push({ start, end: start + m[0].length, type: "date", hard: HARD.date });
  }
  add(/(?<!\d)(?:0?[1-9]|1[0-2])\s?월\s?(?:0?[1-9]|[12]\d|3[01])\s?일/g, "date");
  // 호실 ("301호", "501-1호") · 호실-병상 ("501-1")
  add(/(?<!\d)\d{2,4}\s?-?\s?\d{0,2}\s?호(?:실)?/g, "room");
  add(/(?<![\d.:/-])\d{3,4}-\d{1,2}(?![\d:/.-])/g, "room");

  // 이름 패턴: "보호자 김OO", "김OO 환자", "김OO님", "환자 김OO"
  const nameAfter = /(?:보호자|환자)\s*([가-힣]{2,4})(?![가-힣])/g;
  const nameBefore = /(?<![가-힣])([가-힣]{2,4})\s*(?:환자|보호자|님)/g;
  for (const re of [nameAfter, nameBefore]) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      // "면담함", "교육을"처럼 서술어 어미·조사가 붙은 일반 단어는 제외
      const stem = name.replace(/(함|됨|임|중|하여|하고|했음|을|를|이|가|은|는|과|와|에게)$/, "");
      if (NOT_NAME.has(name) || NOT_NAME.has(stem) || /^(환자|보호자)/.test(name) || TITLE_END.test(name)) continue;
      const start = (m.index ?? 0) + m[0].indexOf(name);
      hits.push({ start, end: start + name.length, type: "name", hard: false });
    }
  }

  // 담당 환자 ID 정확히 일치
  for (const r of opts.rooms ?? []) {
    const room = r.trim();
    if (!room) continue;
    // 숫자만 있는 호실은 "301호"처럼 '호'가 붙을 때만 (혈압 등 숫자 오탐 방지)
    if (/^\d+$/.test(room)) add(new RegExp(`(?<!\\d)${esc(room)}\\s?호`, "g"), "room");
    else add(new RegExp(esc(room), "g"), "room");
  }

  return mergeHits(hits);
}

/** 겹치는 구간은 합치고, 하나라도 hard면 hard */
function mergeHits(hits: Hit[]): Hit[] {
  const order: HitType[] = ["rrn", "phone", "room", "date", "mrn", "name"];
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      last.hard = last.hard || h.hard;
      if (order.indexOf(h.type) < order.indexOf(last.type)) last.type = h.type;
    } else out.push({ ...h });
  }
  return out;
}

/** 강조 표시용 조각 */
export function segments(text: string, hits: Hit[]) {
  const parts: { text: string; hit?: Hit }[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.start > last) parts.push({ text: text.slice(last, h.start) });
    parts.push({ text: text.slice(h.start, h.end), hit: h });
    last = h.end;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** 감지 구간을 지우거나(remove) 가림 표시로 바꿈 */
export function redact(text: string, hits: Hit[], mode: "remove" | "hardOnly"): string {
  let out = "";
  let last = 0;
  for (const h of hits) {
    if (mode === "hardOnly" && !h.hard) continue;
    out += text.slice(last, h.start) + (mode === "remove" ? "" : "[가림]");
    last = h.end;
  }
  out += text.slice(last);
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/,\s*,/g, ",").trim();
}

/** 듀티 날짜 메모: 이름·전화번호·병록번호 패턴이 보이면 경고 (저장은 막지 않음) */
const PATIENT_INFO: HitType[] = ["name", "phone", "mrn", "rrn"];
export function patientInfoHits(text: string): Hit[] {
  return detectPII(text).filter((h) => PATIENT_INFO.includes(h.type));
}
