import Dexie, { type EntityTable, type Transaction } from "dexie";
import type { DutyDay, DutyEvent, Handover, HandoverMemo, NurseRecord, Settings, Shift, Task } from "./types";
import { DEFAULT_DICT } from "./abbreviations";
import { DEFAULT_DUTY_TIMES } from "./time";
import { normalizeId } from "./room";

interface KV {
  key: string;
  value: unknown;
}

export type BatonDB = Dexie & {
  shifts: EntityTable<Shift, "id">;
  memos: EntityTable<HandoverMemo, "id">;
  tasks: EntityTable<Task, "id">;
  records: EntityTable<NurseRecord, "id">;
  handovers: EntityTable<Handover, "id">;
  duty: EntityTable<DutyDay, "date">;
  kv: EntityTable<KV, "key">;
};

export function openDb(name = "baton"): BatonDB {
  const d = new Dexie(name) as BatonDB;

  // v1: 실명 대응표(patients)·가명 기반 구조
  d.version(1).stores({
    patients: "id, alias, room, createdAt",
    records: "id, patientId, status, createdAt, confirmedAt, handoverId",
    handovers: "id, status, createdAt",
    tasks: "id, patientId, done, sourceHandoverId, createdAt",
    kv: "key",
  });

  // v2: 호실-병상 기반, 1인 근무 흐름 + 듀티 캘린더. 실명 테이블 삭제
  d.version(2)
    .stores({
      patients: null,
      shifts: "id, status, date",
      memos: "id, shiftId, [shiftId+room]",
      tasks: "id, shiftId, room, done",
      records: "id, shiftId, room, status, createdAt, copiedAt",
      handovers: "id, shiftId, status, createdAt",
      duty: "date",
      kv: "key",
    })
    .upgrade(migrateV1);

  // v3: 듀티 날짜의 '차지'·'액팅' 메모(일정)를 역할(role)로 옮김
  d.version(3).stores({}).upgrade(migrateDutyRoles);
  // v4: 날짜 memo(문자열) → events(배열). 줄마다 일정 하나, title → text, createdAt 추가
  d.version(4).stores({}).upgrade(migrateDutyEvents);

  return d;
}

const ROLE_WORDS: Record<string, "charge" | "acting"> = { 차지: "charge", 액팅: "acting" };

/** 이전 버전의 듀티 날짜 행 (memo 문자열, 일정 title) */
interface LegacyDutyRow {
  memo?: string;
  events?: { id: string; title?: string; text?: string; time?: string; color?: DutyEvent["color"]; createdAt?: number }[];
  role?: DutyDay["role"];
}

/** v2 → v3: 일정·메모 줄 중 '차지'·'액팅'만 있는 항목은 role로 옮기고 지운다 */
export async function migrateDutyRoles(tx: Transaction) {
  await tx
    .table("duty")
    .toCollection()
    .modify((row: LegacyDutyRow) => {
      let role = row.role ?? null;
      const take = (title: string) => {
        const r = ROLE_WORDS[title.trim()];
        if (r) role ??= r;
        return !!r;
      };
      if (row.events?.length) row.events = row.events.filter((e) => !take(e.title ?? e.text ?? ""));
      else if (row.memo) row.memo = row.memo.split("\n").filter((l) => !take(l)).join("\n").trim();
      if (role) row.role = role;
    });
}

/** v3 → v4: memo 문자열을 줄마다 일정으로, 일정 title → text, createdAt(기존 순서 유지) 추가. memo 필드는 지운다.
    '차지'·'액팅'만 있는 줄은 일정이 아니라 role로 (v3를 거치지 않은 데이터 대비) */
export async function migrateDutyEvents(tx: Transaction) {
  const base = Date.now();
  await tx
    .table("duty")
    .toCollection()
    .modify((row: LegacyDutyRow) => {
      let role = row.role ?? null;
      const fromEvents = (row.events ?? []).map((e, i) => ({
        id: e.id,
        text: (e.text ?? e.title ?? "").trim(),
        ...(e.time ? { time: e.time } : {}),
        ...(e.color ? { color: e.color } : {}),
        createdAt: e.createdAt ?? base + i,
      }));
      const fromMemo = fromEvents.length
        ? []
        : (row.memo ?? "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((text, i) => ({ id: uid(), text, createdAt: base + i }));
      const events = [...fromEvents, ...fromMemo].filter((e) => {
        const r = ROLE_WORDS[e.text];
        if (r) role ??= r;
        return e.text && !r;
      });
      delete row.memo;
      (row as DutyDay).events = events;
      if (role) row.role = role;
    });
}

/** v1 → v2: 암호화 실명은 버리고, 확정 기록은 호실만 남겨 옮긴다 (자동 삭제 규칙 적용 대상) */
async function migrateV1(tx: Transaction) {
  const patients: { id: string; room?: string }[] = await tx.table("patients").toArray();
  const roomOf = new Map(patients.map((p) => [p.id, normalizeId(p.room ?? "") ?? "-"]));
  await tx.table("patients").clear(); // 암호화된 실명 포함 → 삭제
  await tx.table("tasks").clear(); // 가명 기반 할 일·인계는 새 구조와 호환되지 않음
  await tx.table("handovers").clear();
  await tx
    .table("records")
    .toCollection()
    .modify((r: Record<string, unknown>) => {
      r.room = roomOf.get(r.patientId as string) ?? "-";
      r.shiftId = LEGACY_SHIFT;
      r.editHistory = (r.revisions as unknown[]) ?? [];
      delete r.patientId;
      delete r.revisions;
      delete r.handoverId;
    });
  const kv = tx.table("kv");
  await kv.filter((row: KV) => row.key.startsWith("input:")).delete();
  const s = (await kv.get("settings"))?.value as Record<string, unknown> | undefined;
  if (s) {
    const { authorName, aliasCounter: _a, keySalt: _k, ...rest } = s;
    void _a;
    void _k;
    await kv.put({ key: "settings", value: { ...rest, author: rest.author ?? authorName ?? "" } });
  }
}

/** v1에서 옮겨 온 기록의 근무 id (근무 정보가 없음) */
export const LEGACY_SHIFT = "legacy";

export let db = openDb();

/** 테스트용: 다른 DB로 교체 */
export function setDb(next: BatonDB) {
  db = next;
}

export const uid = () => crypto.randomUUID();

export const DEFAULT_SETTINGS: Settings = {
  author: "",
  theme: "dark",
  dutyTimes: DEFAULT_DUTY_TIMES,
  pinHash: "",
  pinSalt: "",
  abbreviationDict: DEFAULT_DICT,
  guideDone: false,
  roomDigits: 3,
  dutyLabel: "short",
};

export async function getSettings(): Promise<Settings> {
  const row = await db.kv.get("settings");
  const v = (row?.value as Partial<Settings>) ?? {};
  return { ...DEFAULT_SETTINGS, ...v, dutyTimes: { ...DEFAULT_DUTY_TIMES, ...(v.dutyTimes ?? {}) } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await db.kv.put({ key: "settings", value: next });
  return next;
}

/** 입력 중인 키워드 (오프라인에서도 자동 저장). 근무별·환자별 */
const inputKey = (shiftId: string, room: string) => `input:${shiftId}:${room}`;
export async function getInputDraft(shiftId: string, room: string): Promise<string> {
  return ((await db.kv.get(inputKey(shiftId, room)))?.value as string) ?? "";
}
export async function setInputDraft(shiftId: string, room: string, text: string) {
  await db.kv.put({ key: inputKey(shiftId, room), value: text });
}

export async function wipeAll() {
  await db.delete();
  try {
    localStorage.clear();
  } catch {}
}
