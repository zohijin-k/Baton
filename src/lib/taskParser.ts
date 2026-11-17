/* 인계 메모 → 할 일 (규칙 기반 우선).
   - 시간 표현(8, 8시, 08:00, 14시) + 처치어 → 시간 할 일
   - 경고 키워드(낙상, NPO, 금식, 알레르기, 격리) → 경고 칩
   - 규칙으로 처리하지 못한 조각만 LLM으로 보낸다 (비식별 검사 후) */
import { parseTime, stripLeadingTime } from "./time";
import { splitByMentions } from "./room";
import { WARD_MEMO, type DutyTime, type HandoverMemo, type Shift, type TaskTag } from "./types";

export const WARNING_TAGS: { re: RegExp; label: string }[] = [
  { re: /NPO|금식/i, label: "NPO" },
  { re: /낙상/, label: "낙상" },
  { re: /격리/, label: "격리" },
  { re: /알레르기|알러지|allergy/i, label: "알레르기" },
];

/** 약물·처치 키워드: 이게 있으면 할 일로 본다. 영문 약어는 단어 경계로 (NPO 속 PO 오탐 방지) */
const ACTION_RE = new RegExp(
  [
    "투약|투여|주사|수액|항생제|진통제|인슐린|헤파린|수혈|드레싱|소독|교체|제거|삽입|측정|체크|확인|관찰|채혈|검사|혈당|활력|배액|흡인|산소|네뷸|흡입|체위|변경|교육|퇴원|입원|수술|전동|협진|처방|보고|면담|설명|동의서|준비|이송",
    "(?<![A-Za-z])(?:IV|PO|IM|SC|abx|BST|V/S|I/O|O2|CT|MRI|X-?ray|CXR|EKG|ECG|CBC|lab|notify|f/u|follow)(?![A-Za-z])",
  ].join("|"),
  "i",
);

export interface RuleTask {
  time: string | null;
  text: string;
  tag: TaskTag;
}

export interface MemoParse {
  flags: string[];
  tasks: RuleTask[];
  unparsed: string[];
}

/** 소수점·시각(14:00)은 자르지 않고 문장 단위로 쪼갬 */
export const clauses = (text: string) =>
  text
    .split(/(?<!\d)\.(?!\d)|[;\n]|,(?!\d)|·|\s\/\s|그리고/)
    .map((s) => s.trim().replace(/^[-•*]\s*/, ""))
    .filter((s) => s.length > 1);

export const flagsOf = (text: string) => WARNING_TAGS.filter((t) => t.re.test(text)).map((t) => t.label);

/** keepAll: 경고만 있는 조각도 할 일로 남김 (환자 미지정 메모는 칩을 붙일 환자가 없어 버리면 사라짐) */
export function parseMemo(text: string, window?: DutyTime, keepAll = false): MemoParse {
  const flags = new Set<string>();
  const tasks: RuleTask[] = [];
  const unparsed: string[] = [];

  for (const c of clauses(text)) {
    const warns = flagsOf(c);
    warns.forEach((f) => flags.add(f));
    const action = ACTION_RE.test(c);
    // 맨 앞 숫자만 있는 시각("8 abx")은 처치어가 있을 때만 시각으로 본다
    const time = parseTime(c, window, action);
    const tag: TaskTag = warns.length ? "warning" : "normal";
    if (time || action) {
      tasks.push({ time, text: time ? stripLeadingTime(c) : c, tag });
    } else if (warns.length) {
      // "NPO", "낙상 주의"처럼 경고뿐인 조각은 칩으로만 표시
      if (keepAll) tasks.push({ time: null, text: c, tag }); // 환자 미지정: 할 일로 남김
    } else if (/^(없음|특이사항 ?없음|-|해당 ?없음|s\/s|stable)$/i.test(c)) {
      // 무시
    } else {
      unparsed.push(c);
    }
  }
  return { flags: [...flags], tasks, unparsed };
}

/** 메모 하나를 환자별 조각으로. 병동 공용 메모는 언급된 호실-병상으로 나눈다 */
export function memoSegments(memo: Pick<HandoverMemo, "room" | "text">): { room: string; text: string }[] {
  if (memo.room !== WARD_MEMO) return memo.text.trim() ? [{ room: memo.room, text: memo.text }] : [];
  return splitByMentions(memo.text).flatMap((s) => (s.ids ?? [WARD_MEMO]).map((room) => ({ room, text: s.text })).filter((x) => x.text));
}

/** 병동 공용 메모에서 언급된 환자 중 아직 목록에 없는 환자 */
export function mentionedRooms(memos: HandoverMemo[], shift: Pick<Shift, "rooms" | "excluded">): string[] {
  const out: string[] = [];
  for (const m of memos.filter((x) => x.room === WARD_MEMO)) {
    for (const seg of memoSegments(m)) {
      if (seg.room === WARD_MEMO || shift.rooms.includes(seg.room) || shift.excluded.includes(seg.room) || out.includes(seg.room)) continue;
      out.push(seg.room);
    }
  }
  return out;
}

export interface PlannedTask extends RuleTask {
  room: string;
  memoRef: string;
  needsReview: boolean;
}

export interface Leftover {
  room: string;
  memoRef: string;
  text: string;
}

/** 메모 전체 → 규칙 할 일 + 못 푼 조각. excluded에 넣은 환자의 조각은 버린다.
    호실-병상을 못 찾은 병동 공용 조각("*")은 경고뿐이어도 '환자 미지정' 할 일로 남긴다 */
export function planTasks(memos: HandoverMemo[], shift: Pick<Shift, "excluded">, window?: DutyTime) {
  const tasks: PlannedTask[] = [];
  const leftovers: Leftover[] = [];
  for (const memo of memos) {
    for (const seg of memoSegments(memo)) {
      if (shift.excluded.includes(seg.room)) continue;
      const r = parseMemo(seg.text, window, seg.room === WARD_MEMO);
      r.tasks.forEach((t) => tasks.push({ ...t, room: seg.room, memoRef: memo.id, needsReview: false }));
      r.unparsed.forEach((text) => leftovers.push({ room: seg.room, memoRef: memo.id, text }));
    }
  }
  return { tasks, leftovers };
}

/** 환자별 경고 칩 (메모에서 바로 계산) */
export function memoFlags(memos: HandoverMemo[], excluded: string[] = []): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const memo of memos) {
    for (const seg of memoSegments(memo)) {
      if (excluded.includes(seg.room)) continue;
      const fs = flagsOf(seg.text);
      if (!fs.length) continue;
      out.set(seg.room, [...new Set([...(out.get(seg.room) ?? []), ...fs])]);
    }
  }
  return out;
}

/** 할 일을 펼쳤을 때 보여줄 원문: 병동 공용 메모면 그 환자 조각만 */
export function memoSource(memo: HandoverMemo | undefined, room: string): string | null {
  if (!memo) return null;
  if (memo.room !== WARD_MEMO) return memo.text;
  return (
    memoSegments(memo)
      .filter((s) => s.room === room)
      .map((s) => s.text)
      .join("\n") || memo.text
  );
}
