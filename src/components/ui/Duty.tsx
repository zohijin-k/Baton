import type { DutyMark, EventColor, Role } from "@/lib/types";

/** 듀티 색: 배경 + 글자 함께 (색만으로 구분하지 않도록 항상 D/E/N/OFF 글자를 같이 표시) */
export const DUTY_CLASS: Record<DutyMark, string> = {
  D: "bg-duty-d-bg text-duty-d-ink",
  E: "bg-duty-e-bg text-duty-e-ink",
  N: "bg-duty-n-bg text-duty-n-ink",
  OFF: "bg-duty-off-bg text-duty-off-ink",
  R: "bg-duty-r-bg text-duty-r-ink border border-duty-r-border",
};

/** 듀티 색 견본(막대·점): 그 듀티를 대표하는 밝은 색 */
export const DUTY_SWATCH: Record<DutyMark, string> = {
  D: "bg-duty-d-ink",
  E: "bg-duty-e-ink",
  N: "bg-duty-n-ink",
  OFF: "bg-duty-off-ink",
  R: "bg-duty-r-ink",
};

/** 듀티 선택 테두리 (그 듀티 글자색) */
export const DUTY_BORDER: Record<DutyMark, string> = {
  D: "border-duty-d-ink",
  E: "border-duty-e-ink",
  N: "border-duty-n-ink",
  OFF: "border-duty-off-ink",
  R: "border-duty-r-ink",
};

/** 듀티 배지 배경만 (연속 구간 막대) */
export const DUTY_BG: Record<DutyMark, string> = {
  D: "bg-duty-d-bg",
  E: "bg-duty-e-bg",
  N: "bg-duty-n-bg",
  OFF: "bg-duty-off-bg",
  R: "bg-duty-r-bg",
};

/** 듀티 색 글자 (배지·요약·카드) */
export const DUTY_TEXT: Record<DutyMark, string> = {
  D: "text-duty-d-ink",
  E: "text-duty-e-ink",
  N: "text-duty-n-ink",
  OFF: "text-duty-off-ink",
  R: "text-duty-r-ink",
};

/** 일정 색: 달력 칸의 왼쪽 선(border)과 목록의 점(bg) */
export const EVENT_COLORS: { key: EventColor; label: string; border: string; bg: string }[] = [
  { key: "violet", label: "보라", border: "border-ev-violet", bg: "bg-ev-violet" },
  { key: "cyan", label: "파랑", border: "border-ev-cyan", bg: "bg-ev-cyan" },
  { key: "magenta", label: "분홍", border: "border-ev-magenta", bg: "bg-ev-magenta" },
  { key: "mint", label: "민트", border: "border-ev-mint", bg: "bg-ev-mint" },
  { key: "orange", label: "주황", border: "border-ev-orange", bg: "bg-ev-orange" },
];
export const eventColor = (c?: EventColor) => EVENT_COLORS.find((x) => x.key === c) ?? EVENT_COLORS[0];

/** 달력 근무 표기 (설정 '근무 표기') */
const DUTY_KO: Record<DutyMark, string> = { D: "데이", E: "이브닝", N: "나이트", OFF: "오프", R: "기타" };
export const dutyText = (d: DutyMark, mode: "short" | "korean") => (mode === "korean" ? DUTY_KO[d] : d);

export const DUTY_MARKS: DutyMark[] = ["D", "E", "N", "OFF", "R"];

export function DutyTag({ duty, className = "" }: { duty: DutyMark; className?: string }) {
  return <span className={`inline-flex items-center justify-center rounded-md px-1.5 font-semibold ${DUTY_CLASS[duty]} ${className}`}>{duty}</span>;
}

export const ROLE_LABEL: Record<Exclude<Role, null>, string> = { acting: "액팅", charge: "차지" };
