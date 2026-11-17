import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Dexie from "dexie";
import { db, openDb, setDb, uid } from "../src/lib/db";
import { addRooms, assignTask, buildList, dutyEvents, endShift, markCopied, removeRoom, saveDutyDay, saveMemo, setDuty, startShift, suggestedDuty } from "../src/lib/shift";
import { purgeExpired, HOUR, AUTO_END_NOTICE } from "../src/lib/purge";
import { DEFAULT_DUTY_TIMES, startMinOf, timeSortKey } from "../src/lib/time";
import type { DutyEvent, NurseRecord } from "../src/lib/types";

const T = DEFAULT_DUTY_TIMES;

/** 일정 하나 (시간은 선택) */
const ev = (id: string, text: string, createdAt: number, time?: string): DutyEvent => ({ id, text, createdAt, ...(time ? { time } : {}) });

beforeEach(() => {
  setDb(openDb(`test-${uid()}`));
});

const record = (shiftId: string, room: string, patch: Partial<NurseRecord> = {}): NurseRecord => ({
  id: uid(),
  shiftId,
  room,
  keywords: ["BT 36.8"],
  draftText: "체온 36.8℃ 측정됨.",
  finalText: "체온 36.8℃ 측정됨.",
  status: "confirmed",
  author: "김간호",
  uncertain: [],
  createdAt: Date.now(),
  confirmedAt: Date.now(),
  editHistory: [],
  ...patch,
});

describe("근무 흐름", () => {
  test("N 근무: 메모 → 할 일이 23시부터 다음날 07시 순서로 정렬", async () => {
    const shift = await startShift({ duty: "N", times: T.N, scope: "assigned", role: null, rooms: ["501-1"], now: new Date(2026, 10, 17, 22, 50) });
    await saveMemo(shift.id, "501-1", "6시 채혈, 2 BST, 11시 V/S, 0시 abx, 드레싱 교체, 23:30 수액 교체");
    await buildList(shift.id, T.N);
    const tasks = await db.tasks.where("shiftId").equals(shift.id).toArray();
    const start = startMinOf(shift);
    const order = tasks.sort((a, b) => timeSortKey(a.time, start) - timeSortKey(b.time, start)).map((t) => `${t.time ?? "-"} ${t.text}`);
    assert.deepEqual(order, ["23:00 V/S", "23:30 수액 교체", "00:00 abx", "02:00 BST", "06:00 채혈", "- 드레싱 교체"]);
  });

  test("병동 전체: 메모에서 언급된 환자가 목록에 자동 추가, 뺀 환자는 다시 추가되지 않음", async () => {
    const shift = await startShift({ duty: "E", times: T.E, scope: "ward", role: "charge", rooms: [], now: new Date(2026, 10, 17, 14, 50) });
    await saveMemo(shift.id, "*", "501-1 20시 abx\n502호 2번 NPO\n503 낙상 주의");
    const r = await buildList(shift.id, T.E);
    assert.deepEqual(r.added, ["501-1", "502-2", "503"]);
    assert.deepEqual((await db.shifts.get(shift.id))!.rooms, ["501-1", "502-2", "503"]);

    await removeRoom(shift.id, "502-2");
    await buildList(shift.id, T.E);
    const s = (await db.shifts.get(shift.id))!;
    assert.deepEqual(s.rooms, ["501-1", "503"]);
    assert.deepEqual(s.excluded, ["502-2"]);

    await addRooms(shift.id, ["502-2", "601-1"]);
    const s2 = (await db.shifts.get(shift.id))!;
    assert.deepEqual(s2.rooms, ["501-1", "502-2", "503", "601-1"]);
    assert.deepEqual(s2.excluded, []);
  });

  test("리스트를 다시 만들어도 완료 표시는 유지", async () => {
    const shift = await startShift({ duty: "D", times: T.D, scope: "assigned", role: null, rooms: ["501-1"], now: new Date(2026, 10, 17, 6, 50) });
    await saveMemo(shift.id, "501-1", "9시 abx, 드레싱");
    await buildList(shift.id, T.D);
    const abx = (await db.tasks.toArray()).find((t) => t.text === "abx")!;
    await db.tasks.update(abx.id, { done: true, doneAt: 1 });
    await saveMemo(shift.id, "501-1", "9시 abx, 드레싱, 13시 CT");
    await buildList(shift.id, T.D);
    const after = await db.tasks.toArray();
    assert.equal(after.length, 3);
    assert.equal(after.find((t) => t.text === "abx")!.done, true);
  });
});

describe("자동 삭제", () => {
  test("메모·할 일은 종료 12시간 후, 기록은 복사 24시간 후 / 미복사는 종료 24시간 후", async () => {
    const start = new Date(2026, 10, 17, 14, 50);
    const shift = await startShift({ duty: "E", times: T.E, scope: "assigned", role: null, rooms: ["501-1"], now: start });
    await saveMemo(shift.id, "501-1", "20시 abx, NPO");
    await buildList(shift.id, T.E);
    const copied = record(shift.id, "501-1");
    const uncopied = record(shift.id, "501-1");
    await db.records.bulkAdd([copied, uncopied]);
    await db.handovers.add({ id: uid(), shiftId: shift.id, emrText: [], verbalSummary: [], recordIds: [], sources: {}, generated: {}, status: "confirmed", createdAt: 0 });
    await db.kv.put({ key: `input:${shift.id}:501-1`, value: "BT" });

    const end = new Date(2026, 10, 17, 23, 5).getTime();
    await markCopied([copied.id], end - 2 * HOUR);
    await markCopied([copied.id], end); // 다시 복사해도 처음 시각 기준
    await endShift(shift.id, end);

    let r = await purgeExpired(end + 12 * HOUR - 1);
    assert.equal(r.memos + r.tasks + r.records, 0);
    assert.equal(await db.memos.count(), 1);

    r = await purgeExpired(end + 12 * HOUR);
    assert.equal(r.memos, 1);
    assert.ok(r.tasks >= 1);
    assert.equal(await db.tasks.count(), 0);
    assert.equal(await db.kv.get(`input:${shift.id}:501-1`), undefined);
    assert.deepEqual((await db.shifts.get(shift.id))!.rooms, []);
    assert.equal(await db.records.count(), 2);

    r = await purgeExpired(end + 22 * HOUR);
    assert.equal(r.records, 1, "복사 후 24시간 지난 기록만 삭제");
    assert.equal((await db.records.toArray())[0].id, uncopied.id);

    r = await purgeExpired(end + 24 * HOUR);
    assert.equal(r.records, 1);
    assert.equal(r.handovers, 1);
    assert.equal(r.shifts, 1);
    assert.equal(await db.records.count(), 0);
  });

  test("진행 중인 근무의 데이터는 지우지 않음, 잊은 근무는 예정 종료 12시간 뒤 종료 처리", async () => {
    const shift = await startShift({ duty: "D", times: T.D, scope: "assigned", role: null, rooms: ["501-1"], now: new Date(2026, 10, 17, 6, 50) });
    await saveMemo(shift.id, "501-1", "9시 abx");
    let r = await purgeExpired(shift.endAt + 11 * HOUR);
    assert.equal(r.autoEnded, 0);
    assert.equal(await db.memos.count(), 1);
    r = await purgeExpired(shift.endAt + 12 * HOUR);
    assert.equal(r.autoEnded, 1);
    assert.equal(r.memos, 1, "예정 종료 시각 기준 12시간이 지났으므로 바로 삭제");
    // 다음 실행 때 한 번 보여줄 안내 (근무 행이 지워져도 남음)
    assert.deepEqual((await db.kv.get(AUTO_END_NOTICE))?.value, { date: "2026-11-17", duty: "D" });
  });

  test("듀티 캘린더와 날짜 일정은 자동 삭제하지 않음", async () => {
    await saveDutyDay("2026-11-17", "E", [ev("a", "회식", 1, "19:00")]);
    await setDuty("2026-11-18", "N");
    await saveDutyDay("2025-01-01", null, [ev("b", "오래된 일정", 2)]);
    const shift = await startShift({ duty: "E", times: T.E, scope: "assigned", role: null, rooms: ["501-1"], now: new Date(2026, 10, 17, 14, 50) });
    await endShift(shift.id, shift.endAt);
    await purgeExpired(shift.endAt + 400 * 24 * HOUR);
    const all = await db.duty.orderBy("date").toArray();
    assert.deepEqual(
      all.map((d) => [d.date, d.duty, dutyEvents(d).map((e) => e.text)]),
      [
        ["2025-01-01", null, ["오래된 일정"]],
        ["2026-11-17", "E", ["회식"]],
        ["2026-11-18", "N", []],
      ],
    );
    assert.equal(await db.shifts.count(), 0);
  });

  test("근무 시작 시 듀티를 캘린더에 반영하되 날짜 일정·역할은 유지", async () => {
    await saveDutyDay("2026-11-17", null, [ev("a", "교육", 1, "14:00")], "charge");
    await startShift({ duty: "D", times: T.D, scope: "assigned", role: null, rooms: [], now: new Date(2026, 10, 17, 6, 50) });
    assert.deepEqual(await db.duty.get("2026-11-17"), { date: "2026-11-17", duty: "D", events: [ev("a", "교육", 1, "14:00")], role: "charge" });
  });
});

describe("실명 필드 부재", () => {
  test("v2 스키마에 실명·환자 테이블과 이름 필드가 없음", async () => {
    await db.open();
    const tables = db.tables.map((t) => t.name).sort();
    assert.deepEqual(tables, ["duty", "handovers", "kv", "memos", "records", "shifts", "tasks"]);
    for (const t of db.tables) {
      const fields = [t.schema.primKey.name, ...t.schema.indexes.map((i) => i.name)].join(",");
      assert.doesNotMatch(fields, /name|patient|alias/i, t.name);
    }
  });

  test("v1 → v2 마이그레이션: 암호화 실명 삭제, 기록은 호실로 옮김", async () => {
    const name = `migrate-${uid()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      patients: "id, alias, room, createdAt",
      records: "id, patientId, status, createdAt, confirmedAt, handoverId",
      handovers: "id, status, createdAt",
      tasks: "id, patientId, done, sourceHandoverId, createdAt",
      kv: "key",
    });
    await v1.table("patients").add({ id: "p1", alias: "환자1", room: "5011", encryptedName: { iv: "x", data: "y" }, createdAt: 1 });
    await v1.table("records").add({ id: "r1", patientId: "p1", keywords: [], draftText: "a", finalText: "a", status: "confirmed", author: "김", uncertain: [], createdAt: 1, revisions: [{ text: "old", replacedAt: 2 }] });
    await v1.table("tasks").add({ id: "t1", patientId: "p1", kind: "todo", text: "x", tag: "normal", done: false, sourceHandoverId: "h", createdAt: 1 });
    await v1.table("kv").bulkAdd([
      { key: "settings", value: { authorName: "김간호", aliasCounter: 3, keySalt: "s", pinHash: "h", pinSalt: "p", theme: "dark" } },
      { key: "input:p1", value: "BT" },
    ]);
    v1.close();

    const v2 = openDb(name);
    setDb(v2);
    await v2.open();
    assert.equal(v2.tables.some((t) => t.name === "patients"), false);
    const [rec] = await v2.records.toArray();
    assert.equal(rec.room, "501-1");
    assert.equal("patientId" in rec, false);
    assert.deepEqual(rec.editHistory, [{ text: "old", replacedAt: 2 }]);
    assert.equal(await v2.tasks.count(), 0);
    assert.equal(await v2.kv.get("input:p1"), undefined);
    const settings = (await v2.kv.get("settings"))!.value as Record<string, unknown>;
    assert.equal(settings.author, "김간호");
    assert.equal("authorName" in settings || "aliasCounter" in settings || "keySalt" in settings, false);
    assert.equal(JSON.stringify(await v2.records.toArray()).includes("encryptedName"), false);
  });
});

describe("듀티 날짜 일정", () => {
  test("일정은 시간 있는 것 먼저(시간순), 없는 것은 등록순이고 듀티를 바꿔도 유지", async () => {
    await saveDutyDay("2026-11-20", "D", [ev("a", "회식", 1, "19:00"), ev("b", "연차 신청 마감", 2), ev("c", "BLS 교육", 3, "14:00"), ev("d", "물품 신청", 4)]);
    await setDuty("2026-11-20", "E");
    const day = await db.duty.get("2026-11-20");
    assert.equal(day?.duty, "E");
    // 시간 있는 일정 먼저(시간순), 시간 없는 일정은 그 아래(등록순)
    assert.deepEqual(dutyEvents(day).map((e) => e.text), ["BLS 교육", "회식", "연차 신청 마감", "물품 신청"]);
  });

  test("근무 시작 시 일정 유지", async () => {
    await saveDutyDay("2026-11-17", null, [ev("a", "교육", 1, "14:00")]);
    await startShift({ duty: "D", times: T.D, scope: "assigned", role: null, rooms: [], now: new Date(2026, 10, 17, 6, 50) });
    const day = await db.duty.get("2026-11-17");
    assert.equal(day?.duty, "D");
    assert.deepEqual(day?.events, [ev("a", "교육", 1, "14:00")]);
  });

  test("기존 메모 마이그레이션(v3 → v4): 줄마다 일정 하나, title → text, createdAt 추가, memo 필드 삭제", async () => {
    const name = `test-${uid()}`;
    const v3 = new Dexie(name);
    v3.version(3).stores({ shifts: "id, status, date", memos: "id, shiftId, [shiftId+room]", tasks: "id, shiftId, room, done", records: "id, shiftId, room, status, createdAt, copiedAt", handovers: "id, shiftId, status, createdAt", duty: "date", kv: "key" });
    await v3.table("duty").bulkPut([
      { date: "2026-11-16", duty: "OFF", memo: "교육 14시" },
      { date: "2026-11-17", duty: "E", memo: "교육 14시\n\n 회식 \n액팅" },
      { date: "2026-11-18", duty: "N", memo: "", events: [{ id: "a", title: "보수교육", time: "10:00" }, { id: "b", title: "연차 신청" }] },
      { date: "2026-11-19", duty: "D", memo: "" },
    ]);
    v3.close();
    setDb(openDb(name));
    const rows = await db.duty.orderBy("date").toArray();
    for (const r of rows) {
      assert.equal("memo" in r, false, `${r.date} memo 필드 삭제`);
      for (const e of r.events ?? []) assert.ok(e.id && typeof e.createdAt === "number" && !("title" in e), `${r.date} 일정 형태`);
    }
    assert.deepEqual(
      rows.map((r) => [r.date, r.role ?? null, dutyEvents(r).map((e) => (e.time ? `${e.time} ${e.text}` : e.text))]),
      [
        ["2026-11-16", null, ["교육 14시"]],
        ["2026-11-17", "acting", ["교육 14시", "회식"]], // 빈 줄 무시, 앞뒤 공백 정리, '액팅'은 역할로
        ["2026-11-18", null, ["10:00 보수교육", "연차 신청"]],
        ["2026-11-19", null, []],
      ],
    );
  });

  test("듀티와 일정을 모두 비우고 저장하면 그 날짜를 삭제", async () => {
    await saveDutyDay("2026-11-19", "N", [ev("a", "x", 1)]);
    await saveDutyDay("2026-11-19", null, []);
    assert.equal(await db.duty.get("2026-11-19"), undefined);
  });

  test("R은 근무 시작 듀티로 제안하지 않음", async () => {
    await setDuty("2026-11-17", "R");
    assert.equal(await suggestedDuty(T, new Date(2026, 10, 17, 10, 0)), null);
  });
});

describe("환자 제외 = 숨김", () => {
  test("제외해도 메모·할 일은 남고, 리스트를 다시 만들어도 유지, 다시 추가하면 보임", async () => {
    const shift = await startShift({ duty: "E", times: T.E, scope: "assigned", role: null, rooms: ["501-1", "502-2"], now: new Date(2026, 10, 17, 14, 50) });
    await saveMemo(shift.id, "502-2", "20시 abx, 드레싱");
    await buildList(shift.id, T.E);
    const t = (await db.tasks.where("shiftId").equals(shift.id).toArray()).find((x) => x.text === "abx")!;
    await db.tasks.update(t.id, { done: true, doneAt: 1 });

    await removeRoom(shift.id, "502-2");
    assert.equal(await db.memos.count(), 1);
    assert.equal(await db.tasks.count(), 2);
    const r = await buildList(shift.id, T.E);
    assert.equal(r.count, 0, "숨긴 환자 할 일은 개수에 넣지 않음");
    const tasks = await db.tasks.where("shiftId").equals(shift.id).toArray();
    assert.equal(tasks.length, 2, "숨긴 환자 할 일도 다시 만들어 둠");
    assert.equal(tasks.find((x) => x.text === "abx")?.done, true, "완료 표시 유지");
    assert.deepEqual((await db.shifts.get(shift.id))!.excluded, ["502-2"]);

    await addRooms(shift.id, ["502-2"]);
    const s = (await db.shifts.get(shift.id))!;
    assert.deepEqual([s.rooms, s.excluded], [["501-1", "502-2"], []]);
  });

  test("숨긴 데이터도 근무 종료 12시간 뒤 자동 삭제", async () => {
    const shift = await startShift({ duty: "E", times: T.E, scope: "assigned", role: null, rooms: ["501-1"], now: new Date(2026, 10, 17, 14, 50) });
    await saveMemo(shift.id, "501-1", "20시 abx");
    await buildList(shift.id, T.E);
    await removeRoom(shift.id, "501-1");
    await endShift(shift.id, shift.endAt);
    await purgeExpired(shift.endAt + 12 * HOUR);
    assert.equal(await db.memos.count(), 0);
    assert.equal(await db.tasks.count(), 0);
  });
});

describe("환자 지정", () => {
  test("환자 미지정 할 일을 옮기면 환자가 목록에 추가되고, 리스트를 다시 만들어도 유지", async () => {
    const shift = await startShift({ duty: "E", times: T.E, scope: "ward", role: null, rooms: [], now: new Date(2026, 10, 17, 14, 50) });
    await saveMemo(shift.id, "*", "낙상 주의\n501-1 20시 abx");
    await buildList(shift.id, T.E);
    const un = (await db.tasks.where("shiftId").equals(shift.id).toArray()).find((x) => x.room === "*")!;
    assert.equal(un.text, "낙상 주의");

    await assignTask(shift.id, un.id, "502-1");
    assert.deepEqual((await db.shifts.get(shift.id))!.rooms, ["501-1", "502-1"]);
    await buildList(shift.id, T.E);
    const after = await db.tasks.where("shiftId").equals(shift.id).toArray();
    assert.deepEqual(after.filter((x) => x.text === "낙상 주의").map((x) => [x.room, x.assignedFrom]), [["502-1", "*"]]);
  });
});

describe("듀티 역할(차지·액팅)", () => {
  test("v2 데이터의 '차지'·'액팅' 일정·메모 줄은 업그레이드 때 역할로 옮겨지고 지워짐", async () => {
    const name = `test-${uid()}`;
    const v2 = new Dexie(name);
    v2.version(2).stores({ shifts: "id, status, date", memos: "id, shiftId, [shiftId+room]", tasks: "id, shiftId, room, done", records: "id, shiftId, room, status, createdAt, copiedAt", handovers: "id, shiftId, status, createdAt", duty: "date", kv: "key" });
    await v2.table("duty").bulkPut([
      { date: "2026-11-18", duty: "E", memo: "", events: [{ id: "a", title: "차지" }, { id: "b", title: "교육", time: "14:00" }] },
      { date: "2026-11-19", duty: "D", memo: "액팅\n회식" },
      { date: "2026-11-20", duty: "N", memo: "", events: [{ id: "c", title: "차지 인계" }] },
    ]);
    v2.close();
    setDb(openDb(name));
    const rows = await db.duty.orderBy("date").toArray();
    assert.deepEqual(
      rows.map((r) => [r.date, r.role ?? null, dutyEvents(r).map((e) => e.text)]),
      [
        ["2026-11-18", "charge", ["교육"]],
        ["2026-11-19", "acting", ["회식"]],
        ["2026-11-20", null, ["차지 인계"]],
      ],
    );
  });

  test("역할만 있어도 날짜가 남고, 듀티를 바꿔도 역할 유지", async () => {
    await saveDutyDay("2026-11-21", null, [], "charge");
    await setDuty("2026-11-21", "D");
    assert.equal((await db.duty.get("2026-11-21"))?.role, "charge");
  });

});
