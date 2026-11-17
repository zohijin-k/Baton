import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { detectPII, patientInfoHits, redact } from "../src/lib/deidentify";
import { composeHandover, handoverBlocking, handoverRooms, emrAll } from "../src/lib/handover";
import { HandoverReq, TasksReq } from "../src/lib/llm/schemas";
import type { NurseRecord, Shift, Task } from "../src/lib/types";

describe("듀티 메모 비식별 경고", () => {
  const types = (t: string) => patientInfoHits(t).map((h) => h.type);

  test("이름·전화번호·병록번호 패턴은 경고", () => {
    assert.deepEqual(types("보호자 김철수 연락"), ["name"]);
    assert.deepEqual(types("010-1234-5678 회신"), ["phone"]);
    assert.deepEqual(types("등록번호 12345678 확인"), ["mrn"]);
    assert.deepEqual(types("홍길동 환자 퇴원"), ["name"]);
  });

  test("일상 메모·동료 호칭은 경고하지 않음", () => {
    for (const t of ["회식 19시", "김선생님 생일", "교육 14:00 3층", "연차 신청", "BLS 갱신"]) assert.deepEqual(types(t), [], t);
  });
});

describe("LLM 전송 전 필터", () => {
  test("호실-병상은 무시하고 보내도 가려짐", () => {
    const t = "501-1 환자 통증 호소, 010-2222-3333";
    const hits = detectPII(t, { rooms: ["501-1"] });
    const sent = redact(t, hits, "hardOnly");
    assert.doesNotMatch(sent, /501-1|010/);
  });

  test("요청 스키마는 임시 가명만 허용 (호실-병상 거부)", () => {
    assert.equal(TasksReq.safeParse({ kind: "tasks", items: [{ alias: "501-1", text: "abx" }] }).success, false);
    assert.equal(TasksReq.safeParse({ kind: "tasks", window: "15:00-23:00", items: [{ alias: "환자1", text: "abx" }] }).success, true);
    assert.equal(HandoverReq.safeParse({ kind: "handover", patients: [{ alias: "홍길동", records: [{ time: "15:00", text: "a" }] }] }).success, false);
  });

  test("화면 코드에 실명 입력·저장 흔적이 없음", () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : files.push(path.join(d, f))));
    walk(path.resolve(import.meta.dirname, "../src"));
    for (const f of files.filter((x) => /\.(ts|tsx)$/.test(x))) {
      const src = readFileSync(f, "utf8");
      assert.doesNotMatch(src, /encryptedName|encryptName|decryptText|realname|pname|이름 \(선택\)/, f);
    }
  });
});

describe("인계", () => {
  const shift: Shift = {
    id: "s",
    date: "2026-11-17",
    duty: "E",
    startAt: new Date(2026, 10, 17, 15).getTime(),
    endAt: new Date(2026, 10, 17, 23).getTime(),
    rooms: ["501-1", "502-2"],
    excluded: [],
    scope: "assigned",
    role: null,
    status: "active",
    createdAt: 0,
  };
  const rec = (room: string, text: string, h: number): NurseRecord => ({
    id: `${room}-${h}`,
    shiftId: "s",
    room,
    keywords: [],
    draftText: text,
    finalText: text,
    status: "confirmed",
    author: "김",
    uncertain: [],
    createdAt: 0,
    confirmedAt: new Date(2026, 10, 17, h).getTime(),
    editHistory: [],
  });
  const task = (room: string, time: string | undefined, text: string, done = false): Task => ({
    id: `${room}-${text}`,
    shiftId: "s",
    room,
    time,
    text,
    tag: "normal",
    source: "memo",
    needsReview: false,
    done,
    createdAt: 0,
  });

  test("미완료 할 일·경고를 자동 포함하고, AI가 만든 숫자는 확정을 막음", () => {
    const plan = handoverRooms({
      shift,
      records: [rec("501-1", "통증 NRS 6점 호소함.", 17)],
      tasks: [task("501-1", "22:00", "abx"), task("501-1", "16:00", "BST", true), task("502-2", undefined, "드레싱")],
      memos: [{ id: "m", shiftId: "s", room: "502-2", text: "NPO, 드레싱", updatedAt: 0 }],
    });
    assert.deepEqual(
      plan.map((p) => [p.room, p.records.length, p.pending, p.warnings]),
      [
        ["501-1", 1, ["22:00 abx"], []],
        ["502-2", 0, ["드레싱"], ["NPO"]],
      ],
    );
    const ai = new Map([["501-1", { emr: "17:00 통증 NRS 6점 호소함. 30분 후 NRS 2점.", verbal: ["NRS 6", "a", "b", "c"] }]]);
    const h = composeHandover("h", shift, plan, ai);
    assert.equal(h.emrText[0].text, "17:00 통증 NRS 6점 호소함. 30분 후 NRS 2점.\n미완료: 22:00 abx");
    assert.equal(h.verbalSummary[0].lines.length, 3);
    assert.deepEqual(h.verbalSummary[1], { room: "502-2", lines: [], warnings: ["NPO"], pending: ["드레싱"] });
    assert.deepEqual([...handoverBlocking(h).entries()], [["501-1", ["30", "2"]]]);
    assert.equal(emrAll(h), "[501-1]\n17:00 통증 NRS 6점 호소함. 30분 후 NRS 2점.\n미완료: 22:00 abx\n\n[502-2]\n미완료: 드레싱");
  });
});
