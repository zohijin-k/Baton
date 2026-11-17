/* 근무 흐름: 시작 → 인계 메모 → 할 일 목록 → 기록 → 인계 → 종료 */
import { db, uid } from "./db";
import { addDays, dateKey, shiftBounds, shiftDateFor } from "./time";
import { mentionedRooms, planTasks, type Leftover } from "./taskParser";
import { sortIds } from "./room";
import { WARD_MEMO, isWorkDuty, type Duty, type DutyDay, type DutyEvent, type DutyMark, type DutyTime, type Role, type Scope, type Settings, type Shift, type Task, type TaskTag } from "./types";

export async function activeShift(): Promise<Shift | undefined> {
  return db.shifts.where("status").equals("active").first();
}

/** 오늘(또는 자정 넘긴 나이트면 어제) 캘린더에 적힌 듀티 */
export async function suggestedDuty(dutyTimes: Settings["dutyTimes"], now = new Date()): Promise<{ duty: Duty; date: string } | null> {
  const today = dateKey(now);
  const yesterday = addDays(today, -1);
  const [t, y] = await Promise.all([db.duty.get(today), db.duty.get(yesterday)]);
  // 자정~나이트 종료 직후: 어제 N이면 그 근무
  if (y?.duty === "N" && shiftDateFor("N", dutyTimes.N, now) === yesterday) return { duty: "N", date: yesterday };
  if (isWorkDuty(t?.duty)) return { duty: t.duty, date: shiftDateFor(t.duty, dutyTimes[t.duty], now) };
  return null;
}

/** 다음 근무: after 날짜 다음부터 처음 나오는 D/E/N */
export async function nextDuty(after: string): Promise<{ date: string; duty: Duty } | null> {
  const d = await db.duty
    .where("date")
    .above(after)
    .filter((x) => x.duty === "D" || x.duty === "E" || x.duty === "N")
    .first();
  return d ? { date: d.date, duty: d.duty as Duty } : null;
}

export async function setDuty(date: string, duty: DutyMark | null) {
  await db.transaction("rw", db.duty, async () => {
    const cur = await db.duty.get(date);
    await db.duty.put({ ...cur, date, duty });
  });
}

/** 일정 정렬: 시간 있는 일정 먼저(시간순), 시간 없는 일정은 그 아래(등록순) */
export function sortEvents(events: DutyEvent[]): DutyEvent[] {
  return [...events].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time) || a.createdAt - b.createdAt;
    if (a.time || b.time) return a.time ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

/** 그 날짜의 일정 (정렬됨). 달력 칸에는 이 중 첫 일정 + "+N" */
export const dutyEvents = (day?: DutyDay): DutyEvent[] => sortEvents(day?.events ?? []);

/** 날짜 시트에서 '완료'를 눌렀을 때 듀티·일정·역할을 한 번에 저장. 모두 비면 그 날짜를 지운다 */
export async function saveDutyDay(date: string, duty: DutyMark | null, events: DutyEvent[], role: Role = null) {
  if (!duty && !events.length && !role) return deleteDutyDay(date);
  await db.duty.put({ date, duty, events: sortEvents(events), role });
}


/** 그 날짜의 듀티와 일정을 함께 삭제 */
export async function deleteDutyDay(date: string) {
  await db.duty.delete(date);
}

export interface StartInput {
  duty: Duty;
  times: DutyTime;
  scope: Scope;
  role: Role;
  rooms: string[];
  now?: Date;
}

export async function startShift({ duty, times, scope, role, rooms, now = new Date() }: StartInput): Promise<Shift> {
  const date = shiftDateFor(duty, times, now);
  const shift: Shift = {
    id: uid(),
    date,
    duty,
    ...shiftBounds(date, times),
    rooms: sortIds(rooms),
    excluded: [],
    scope,
    role,
    status: "active",
    createdAt: now.getTime(),
  };
  await db.transaction("rw", db.shifts, db.duty, async () => {
    // 이미 진행 중인 근무가 있으면 먼저 끝낸다 (동시에 하나만)
    await db.shifts.where("status").equals("active").modify({ status: "ended", endedAt: now.getTime() });
    await db.shifts.add(shift);
    // 시작한 듀티를 캘린더에도 반영 (메모는 유지)
    const cur = await db.duty.get(date);
    if (cur?.duty !== duty) await db.duty.put({ ...cur, date, duty });
  });
  return shift;
}

export async function endShift(shiftId: string, now = Date.now()) {
  await db.shifts.update(shiftId, { status: "ended", endedAt: now });
}

export async function addRooms(shiftId: string, ids: string[]) {
  await db.transaction("rw", db.shifts, async () => {
    const s = await db.shifts.get(shiftId);
    if (!s) return;
    await db.shifts.update(shiftId, {
      rooms: sortIds([...new Set([...s.rooms, ...ids])]),
      excluded: s.excluded.filter((x) => !ids.includes(x)),
    });
  });
}

/** 환자 제외 = 숨김: 목록에서 빼고 excluded에 넣는다. 메모·할 일·기록은 지우지 않으며
    (자동 삭제 규칙은 그대로), addRooms로 다시 추가하면 다시 보인다 */
export async function removeRoom(shiftId: string, id: string) {
  await db.transaction("rw", db.shifts, async () => {
    const s = await db.shifts.get(shiftId);
    if (!s) return;
    await db.shifts.update(shiftId, { rooms: s.rooms.filter((x) => x !== id), excluded: [...new Set([...s.excluded, id])] });
  });
}

/** '환자 미지정' 할 일을 환자에게 옮긴다. 목록에 없는 환자면 추가(숨김 상태였으면 다시 보이게) */
export async function assignTask(shiftId: string, taskId: string, room: string) {
  await db.transaction("rw", db.shifts, db.tasks, async () => {
    const t = await db.tasks.get(taskId);
    if (!t) return;
    await db.tasks.update(taskId, { room, assignedFrom: t.assignedFrom ?? t.room });
    const s = await db.shifts.get(shiftId);
    if (s && !s.rooms.includes(room)) {
      await db.shifts.update(shiftId, { rooms: sortIds([...s.rooms, room]), excluded: s.excluded.filter((x) => x !== room) });
    }
  });
}

const assignKey = (t: { memoRef?: string; time?: string | null; text: string }) => `${t.memoRef ?? ""}|${t.time ?? ""}|${t.text}`;

export async function saveMemo(shiftId: string, room: string, text: string) {
  await db.transaction("rw", db.memos, async () => {
    const cur = await db.memos.where("[shiftId+room]").equals([shiftId, room]).first();
    if (cur) await db.memos.update(cur.id, { text, updatedAt: Date.now() });
    else if (text.trim()) await db.memos.add({ id: uid(), shiftId, room, text, updatedAt: Date.now() });
  });
}

const doneKey = (t: Pick<Task, "room" | "time" | "text">) => `${t.room}|${t.time ?? ""}|${t.text}`;

/** [리스트 만들기]: 메모 → 규칙 할 일 + 못 푼 조각(원문 그대로 '확인 필요').
    기존 메모 할 일은 교체하되 완료 표시와 '환자 지정'은 유지. 숨긴 환자의 할 일도 다시 만들어 둔다(숨김 유지) */
export async function buildList(shiftId: string, window: DutyTime): Promise<{ count: number; leftovers: (Leftover & { taskId: string })[]; added: string[] }> {
  return db.transaction("rw", db.shifts, db.memos, db.tasks, async () => {
    const shift = await db.shifts.get(shiftId);
    if (!shift) return { count: 0, leftovers: [], added: [] };
    const memos = await db.memos.where("shiftId").equals(shiftId).toArray();

    // 병동 전체 모드: 메모에서 언급된 환자를 목록에 추가
    const added = shift.scope === "ward" ? mentionedRooms(memos, shift) : [];
    const rooms = sortIds([...shift.rooms, ...added]);

    const { tasks: planned, leftovers } = planTasks(memos, { excluded: [] }, window);
    const old = await db.tasks.where("shiftId").equals(shiftId).filter((t) => t.source === "memo").toArray();
    const doneMap = new Map(old.filter((t) => t.done).map((t) => [doneKey(t), t.doneAt]));
    const assigned = new Map(old.filter((t) => t.assignedFrom === WARD_MEMO).map((t) => [assignKey(t), t.room]));
    const now = Date.now();
    const make = (p: { room: string; time: string | null; text: string; tag: TaskTag; memoRef: string; needsReview: boolean }): Task => {
      const moved = p.room === WARD_MEMO ? assigned.get(assignKey(p)) : undefined;
      const t: Task = {
        id: uid(),
        shiftId,
        room: moved ?? p.room,
        ...(moved ? { assignedFrom: WARD_MEMO } : {}),
        time: p.time ?? undefined,
        text: p.text,
        tag: p.tag,
        source: "memo",
        memoRef: p.memoRef,
        needsReview: p.needsReview,
        done: false,
        createdAt: now,
      };
      const doneAt = doneMap.get(doneKey(t));
      return doneAt !== undefined ? { ...t, done: true, doneAt } : t;
    };
    const ruleTasks = planned.map(make);
    const fallback = leftovers.map((l) => ({ ...l, task: make({ room: l.room, time: null, text: l.text, tag: "normal", memoRef: l.memoRef, needsReview: true }) }));

    await db.tasks.bulkDelete(old.map((t) => t.id));
    await db.tasks.bulkAdd([...ruleTasks, ...fallback.map((f) => f.task)]);
    await db.shifts.update(shiftId, { rooms, listAt: now });
    // AI 정리는 보이는 환자 것만 (숨긴 환자 조각은 원문 그대로 둔다)
    const visible = fallback.filter((f) => !shift.excluded.includes(f.task.room));
    const count = [...ruleTasks, ...fallback.map((f) => f.task)].filter((t) => !shift.excluded.includes(t.room)).length;
    return { count, leftovers: visible.map((f) => ({ room: f.task.room, memoRef: f.memoRef, text: f.text, taskId: f.task.id })), added };
  });
}

export interface AiTask {
  room: string;
  memoRef: string;
  time: string | null;
  text: string;
  tag: TaskTag;
  needsReview: boolean;
}

/** 규칙으로 못 푼 원문 할 일을 AI가 정리한 할 일로 교체 */
export async function replaceLeftovers(shiftId: string, oldIds: string[], next: AiTask[]) {
  const now = Date.now();
  await db.transaction("rw", db.tasks, async () => {
    await db.tasks.bulkDelete(oldIds);
    await db.tasks.bulkAdd(
      next.map((t) => ({
        id: uid(),
        shiftId,
        room: t.room,
        time: t.time ?? undefined,
        text: t.text,
        tag: t.tag,
        source: "memo" as const,
        memoRef: t.memoRef,
        needsReview: t.needsReview,
        done: false,
        createdAt: now,
      })),
    );
  });
}

export async function addManualTask(shiftId: string, room: string, time: string | undefined, text: string, tag: TaskTag) {
  await db.tasks.add({ id: uid(), shiftId, room, time, text, tag, source: "manual", needsReview: false, done: false, createdAt: Date.now() });
}

export function toggleTask(t: Task) {
  return db.tasks.update(t.id, { done: !t.done, doneAt: t.done ? undefined : Date.now() });
}

/** 처음 복사한 시각 저장 (자동 삭제 기준: 다시 복사해도 늘어나지 않음) */
export async function markCopied(recordIds: string[], now = Date.now()) {
  await db.records
    .where("id")
    .anyOf(recordIds)
    .modify((r) => {
      r.copiedAt ??= now;
    });
}
