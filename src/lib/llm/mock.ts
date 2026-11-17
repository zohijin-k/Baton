/* 데모 모드: API 키가 없을 때 규칙으로 만든 목업 응답.
   입력에 없는 사실을 만들지 않도록 기록 문장을 옮기기만 한다. */
import type { HandoverOut, TasksOut } from "./schemas";
import { parseTime, stripLeadingTime } from "../time";
import { WARNING_TAGS } from "../taskParser";

// 기록 문장 데모 응답은 별도 모듈 (간호기록체 템플릿)
export { mockRecord } from "./mockRecord";

const sentences = (t: string) =>
  t
    .split(/(?<=[.。])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** 말로 인계용으로 짧게: 문장 끝 서술어(~함/~임/~됨)와 마침표를 덜어낸다 */
const brief = (s: string) =>
  s
    .replace(/[.。]$/, "")
    .replace(/\s?(?:측정됨|확인함|관찰됨|시행함|유지 중임|호소함|투여함|함|임|됨)$/, "")
    .trim();

export function mockHandover(patients: { alias: string; records: { time: string; text: string }[] }[]): HandoverOut {
  return {
    patients: patients.map(({ alias, records }) => {
      const sorted = [...records].sort((a, b) => a.time.localeCompare(b.time));
      const emr = sorted.map((r) => `${r.time} ${r.text.trim()}`).join(" ");
      // 최근 기록부터 핵심 문장 최대 3줄
      const verbal = sorted
        .slice()
        .reverse()
        .flatMap((r) => sentences(r.text).slice(0, 1).map(brief))
        .filter(Boolean)
        .slice(0, 3);
      return { alias, emr, verbal };
    }),
  };
}

export function mockTasks(items: { alias: string; text: string }[], window?: string): TasksOut {
  const [start, end] = window?.split("-") ?? [];
  const w = start && end ? { start, end } : undefined;
  return {
    tasks: items.map(({ alias, text }) => {
      const time = parseTime(text, w, true);
      return {
        alias,
        time,
        text: time ? stripLeadingTime(text) : text,
        tag: WARNING_TAGS.some((t) => t.re.test(text)) ? "warning" : "normal",
        // 규칙으로 못 푼 조각이라 데모에서는 항상 확인 필요로 표시
        uncertain: true,
      };
    }),
  };
}
