/* 한국 공휴일(대체공휴일·선거일 포함). 외부 API 없이 연도별 정적 JSON으로 포함한다.
   새 해는 src/data/holidays/<연도>.json 을 추가하고 아래 목록에 넣는다.
   JSON은 주석을 쓸 수 없어 출처·최종 확인일을 _source·_checked 필드에 둔다. */
import y2026 from "@/data/holidays/2026.json" with { type: "json" };
import y2027 from "@/data/holidays/2027.json" with { type: "json" };

interface HolidayFile {
  _source: string;
  _checked: string;
  holidays: Record<string, string>;
}

export const HOLIDAY_FILES: Record<number, HolidayFile> = { 2026: y2026, 2027: y2027 };

const HOLIDAYS: Record<string, string> = Object.assign({}, ...Object.values(HOLIDAY_FILES).map((f) => f.holidays));

/** 그 날짜(YYYY-MM-DD)의 공휴일 이름. 공휴일이 아니거나 데이터가 없는 해면 null */
export const holidayName = (date: string): string | null => HOLIDAYS[date] ?? null;

/* ── 대체공휴일 계산 (데이터 검증용) ──
   - 설날·추석 연휴: 일요일이나 다른 공휴일과 겹치면 연휴 다음 첫 평일(비공휴일)
   - 어린이날, 삼일절·노동절·제헌절·광복절·개천절·한글날·부처님오신날·성탄절: 토·일요일이나 다른 공휴일과 겹치면 다음 첫 평일
   - 신정·현충일·선거일: 대체공휴일 없음 */
const SUB = "대체공휴일";
const WEEKEND_RULE = ["어린이날", "삼일절", "노동절", "제헌절", "광복절", "개천절", "한글날", "부처님오신날", "성탄절"];

const toDate = (k: string) => new Date(`${k}T00:00:00`);
const toKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nextDay = (k: string) => {
  const d = toDate(k);
  d.setDate(d.getDate() + 1);
  return toKey(d);
};

/** 대체공휴일을 뺀 기본 공휴일 → 규칙으로 계산한 대체공휴일 { 날짜: "대체공휴일(이름)" } */
export function computeSubstitutes(holidays: Record<string, string>): Record<string, string> {
  const base = Object.fromEntries(Object.entries(holidays).filter(([, n]) => !n.startsWith(SUB)));
  const taken = new Set(Object.keys(base));
  const out: Record<string, string> = {};
  const firstFreeWeekday = (after: string) => {
    let k = nextDay(after);
    while ([0, 6].includes(toDate(k).getDay()) || taken.has(k)) k = nextDay(k);
    return k;
  };
  const add = (after: string, name: string) => {
    const k = firstFreeWeekday(after);
    out[k] = `${SUB}(${name})`;
    taken.add(k);
  };

  // 설날·추석: 연휴 3일 묶음
  for (const name of ["설날", "추석"]) {
    const days = Object.keys(base)
      .filter((k) => base[k].startsWith(name))
      .sort();
    if (days.length && days.some((k) => toDate(k).getDay() === 0)) add(days[days.length - 1], name);
  }
  // 하루짜리: 토·일요일과 겹치면
  for (const [k, name] of Object.entries(base).sort()) {
    if (WEEKEND_RULE.includes(name) && [0, 6].includes(toDate(k).getDay())) add(k, name);
  }
  return out;
}
