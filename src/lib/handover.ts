/* 인계: 확정 기록 + 미완료 할 일 + 경고 → EMR용 문단 / 말로 인계 */
import { compareIds, idLabel } from "./room";
import { memoFlags } from "./taskParser";
import { hhmm, startMinOf, timeSortKey } from "./time";
import { blockingNumbers } from "./numbers";
import { WARD_MEMO, type Handover, type HandoverMemo, type NurseRecord, type Shift, type Task } from "./types";

export const MAX_VERBAL_LINES = 3;

export const pendingLabel = (t: Pick<Task, "time" | "text">) => `${t.time ? `${t.time} ` : ""}${t.text}`;

export interface HandoverInput {
  shift: Shift;
  records: NurseRecord[]; // 포함하기로 고른 확정 기록
  tasks: Task[];
  memos: HandoverMemo[];
}

/** 인계에 들어갈 환자와 근거: 기록·미완료 할 일·경고 중 하나라도 있는 환자 (병동 공용 "*" 제외) */
export function handoverRooms({ shift, records, tasks, memos }: HandoverInput) {
  const start = startMinOf(shift);
  const flags = memoFlags(memos, shift.excluded);
  const pending = new Map<string, Task[]>();
  for (const t of tasks)
    if (!t.done && t.room !== WARD_MEMO && !shift.excluded.includes(t.room)) pending.set(t.room, [...(pending.get(t.room) ?? []), t]);
  for (const list of pending.values()) list.sort((a, b) => timeSortKey(a.time, start) - timeSortKey(b.time, start));
  const recs = new Map<string, NurseRecord[]>();
  for (const r of [...records].sort((a, b) => (a.confirmedAt ?? 0) - (b.confirmedAt ?? 0))) recs.set(r.room, [...(recs.get(r.room) ?? []), r]);

  const rooms = [...new Set([...recs.keys(), ...pending.keys(), ...[...flags.keys()].filter((r) => r !== WARD_MEMO)])].sort(compareIds);
  return rooms.map((room) => ({
    room,
    records: recs.get(room) ?? [],
    pending: (pending.get(room) ?? []).map(pendingLabel),
    warnings: flags.get(room) ?? [],
  }));
}

export type RoomPlan = ReturnType<typeof handoverRooms>[number];

/** AI 결과(호실별 emr·verbal)와 규칙으로 정한 경고·미완료를 합쳐 인계 초안 생성 */
export function composeHandover(
  id: string,
  shift: Shift,
  plan: RoomPlan[],
  ai: Map<string, { emr: string; verbal: string[] }>,
  now = Date.now(),
): Handover {
  const emrText = plan.map((p) => {
    const body = (ai.get(p.room)?.emr ?? "").trim();
    const tail = p.pending.length ? `미완료: ${p.pending.join(", ")}` : "";
    return { room: p.room, text: [body, tail].filter(Boolean).join("\n") };
  });
  const verbalSummary = plan.map((p) => ({
    room: p.room,
    lines: (ai.get(p.room)?.verbal ?? []).map((l) => l.trim()).filter(Boolean).slice(0, MAX_VERBAL_LINES),
    warnings: p.warnings,
    pending: p.pending,
  }));
  const sources: Record<string, string[]> = {};
  const generated: Record<string, string> = {};
  for (const p of plan) {
    sources[p.room] = [...p.records.map((r) => `${hhmm(r.confirmedAt ?? r.createdAt)} ${r.finalText}`), ...p.pending, ...p.warnings];
    generated[p.room] = [emrText.find((e) => e.room === p.room)!.text, ...verbalSummary.find((v) => v.room === p.room)!.lines].join("\n");
  }
  return {
    id,
    shiftId: shift.id,
    emrText,
    verbalSummary,
    recordIds: plan.flatMap((p) => p.records.map((r) => r.id)),
    sources,
    generated,
    status: "draft",
    createdAt: now,
  };
}

/** 확정을 막는 숫자: AI가 만든(근거에 없는) 숫자가 아직 남아 있으면 */
export function handoverBlocking(h: Pick<Handover, "emrText" | "verbalSummary" | "sources" | "generated">) {
  const out = new Map<string, string[]>();
  for (const e of h.emrText) {
    const v = h.verbalSummary.find((x) => x.room === e.room);
    const current = [e.text, ...(v?.lines ?? [])].join("\n");
    const nums = blockingNumbers(current, h.generated[e.room] ?? "", h.sources[e.room] ?? []);
    if (nums.length) out.set(e.room, nums);
  }
  return out;
}

/** 전체 복사용 */
export const emrAll = (h: Pick<Handover, "emrText">) =>
  h.emrText
    .filter((e) => e.text.trim())
    .map((e) => `[${idLabel(e.room)}]\n${e.text.trim()}`)
    .join("\n\n");
