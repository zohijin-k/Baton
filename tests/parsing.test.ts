import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeId, parseIdList, splitByMentions, sortIds, idLabel, setRoomDigits, findMentions } from "../src/lib/room";
import { parseTime, timeSortKey, toMin, DEFAULT_DUTY_TIMES, shiftDateFor } from "../src/lib/time";
import { parseMemo, memoFlags, planTasks } from "../src/lib/taskParser";
import { WARD_MEMO, type HandoverMemo } from "../src/lib/types";

const { D, E, N } = DEFAULT_DUTY_TIMES;

describe("환자 ID (호실-병상)", () => {
  test("여러 입력 형식을 501-1로 정규화", () => {
    for (const s of ["501-1", "5011", "501 1", "501호 1번", "501-1호", "501호-1", " 501 - 1 "]) assert.equal(normalizeId(s), "501-1", s);
    assert.equal(normalizeId("12011"), "1201-1");
    assert.equal(normalizeId("1201-3"), "1201-3");
  });

  test("병상 없이 호실만 쓰면 호실 전체", () => {
    assert.equal(normalizeId("503"), "503");
    assert.equal(normalizeId("503호"), "503");
    assert.equal(normalizeId("1201호"), "1201");
    assert.equal(idLabel("503"), "503호");
    assert.equal(idLabel("503-2"), "503-2");
  });

  test("알아볼 수 없는 입력은 null", () => {
    for (const s of ["", "abc", "501-0", "501-99", "1234567"]) assert.equal(normalizeId(s), null, s);
  });

  test("쉼표 목록과 범위 입력", () => {
    assert.deepEqual(parseIdList("501-1~501-4").ids, ["501-1", "501-2", "501-3", "501-4"]);
    assert.deepEqual(parseIdList("501-1~3, 503, 5021").ids, ["501-1", "501-2", "501-3", "503", "502-1"]);
    assert.deepEqual(parseIdList("501~503").ids, ["501", "502", "503"]);
    const bad = parseIdList("501-1~502-2, x");
    assert.deepEqual(bad.ids, []);
    assert.deepEqual(bad.invalid, ["501-1~502-2", "x"]);
  });

  test("정렬: 호실 → 호실 전체 → 병상", () => {
    assert.deepEqual(sortIds(["502-1", "501-2", "501", "501-1", "1201-1"]), ["501", "501-1", "501-2", "502-1", "1201-1"]);
  });

  test("병동 메모에서 언급된 환자로 나누기", () => {
    const segs = splitByMentions("공용: 카트 점검\n501-1 8시 abx, 낙상주의\n502호 2번 NPO\n503 보호자 상주");
    assert.deepEqual(
      segs.map((s) => [s.ids, s.text]),
      [
        [null, "공용: 카트 점검"],
        [["501-1"], "8시 abx, 낙상주의"],
        [["502-2"], "NPO"],
        [["503"], "보호자 상주"],
      ],
    );
    // 붙어 있는 언급은 같은 내용을 공유
    assert.deepEqual(splitByMentions("501-1, 501-2 14시 CT")[0], { ids: ["501-1", "501-2"], text: "14시 CT" });
    // 수치·시각은 환자로 보지 않음
    assert.equal(splitByMentions("BP 120/80, 140 cc 배액, 11-17 수술").every((s) => s.ids === null), true);
  });
});

describe("시각 해석", () => {
  test("명시적 시각은 그대로", () => {
    assert.equal(parseTime("14시 BST", E), "14:00");
    assert.equal(parseTime("08:00 abx", E), "08:00");
    assert.equal(parseTime("오후 2시 면담", N), "14:00");
  });

  test("모호한 시각은 근무 시간 안으로", () => {
    assert.equal(parseTime("8시 abx", E), "20:00");
    assert.equal(parseTime("8시 abx", D), "08:00");
    assert.equal(parseTime("2시 BST", D), "14:00");
    assert.equal(parseTime("2시 BST", N), "02:00");
    assert.equal(parseTime("11시 V/S", N), "23:00");
    assert.equal(parseTime("10:30 드레싱", E), "22:30");
  });

  test("맨 앞 숫자만 쓴 시각은 처치어가 있을 때만", () => {
    assert.deepEqual(parseMemo("8 abx", E).tasks, [{ time: "20:00", text: "abx", tag: "normal" }]);
    assert.equal(parseMemo("2 unit 수혈", E).tasks[0].time, null);
    assert.equal(parseMemo("2 unit 수혈", E).tasks[0].text, "2 unit 수혈");
  });

  test("N 근무 정렬: 23시 → 다음날 07시 순서", () => {
    const start = toMin(N.start);
    const times = ["06:00", "23:30", "02:00", "00:00", undefined, "23:00"];
    const sorted = [...times].sort((a, b) => timeSortKey(a, start) - timeSortKey(b, start));
    assert.deepEqual(sorted, ["23:00", "23:30", "00:00", "02:00", "06:00", undefined]);
  });

  test("자정 넘어 시작한 나이트는 전날 근무", () => {
    assert.equal(shiftDateFor("N", N, new Date(2026, 10, 18, 0, 40)), "2026-11-17");
    assert.equal(shiftDateFor("N", N, new Date(2026, 10, 17, 22, 40)), "2026-11-17");
    assert.equal(shiftDateFor("E", E, new Date(2026, 10, 17, 14, 50)), "2026-11-17");
  });
});

describe("메모 → 할 일", () => {
  const memo = (room: string, text: string): HandoverMemo => ({ id: `m-${room}`, shiftId: "s", room, text, updatedAt: 0 });

  test("시간 할 일, 경고 칩, 못 푼 조각", () => {
    const r = parseMemo("NPO, 14시 CT, 드레싱 교체, 낙상 주의, 보호자 상주", E);
    assert.deepEqual(r.flags.sort(), ["NPO", "낙상"]);
    assert.deepEqual(
      r.tasks.map((t) => [t.time, t.text]),
      [
        ["14:00", "CT"],
        [null, "드레싱 교체"],
      ],
    );
    assert.deepEqual(r.unparsed, ["보호자 상주"]);
  });

  test("병동 메모: 언급된 환자별로 할 일·경고가 나뉨", () => {
    const memos = [memo(WARD_MEMO, "501-1 20시 abx, NPO\n502-2 드레싱"), memo("503", "알레르기 확인")];
    const { tasks } = planTasks(memos, { excluded: ["502-2"] }, E);
    assert.deepEqual(
      tasks.map((t) => [t.room, t.time, t.text]),
      [
        ["501-1", "20:00", "abx"],
        ["503", null, "알레르기 확인"],
      ],
    );
    const flags = memoFlags(memos);
    assert.deepEqual(flags.get("501-1"), ["NPO"]);
    assert.deepEqual(flags.get("503"), ["알레르기"]);
  });
});

describe("호실 자릿수 설정", () => {
  test("4자리: 12011 → 1201-1, 1201 → 1201호 전체", () => {
    setRoomDigits(4);
    try {
      assert.equal(normalizeId("12011"), "1201-1");
      assert.equal(normalizeId("1201"), "1201");
      assert.equal(normalizeId("1201-2"), "1201-2");
      assert.deepEqual(parseIdList("12011, 1203, 1202-1~2").ids, ["1201-1", "1203", "1202-1", "1202-2"]);
      // 줄 맨 앞 4자리 숫자는 호실로
      assert.deepEqual(findMentions("1203 NPO").map((m) => m.id), ["1203"]);
    } finally {
      setRoomDigits(3);
    }
  });

  test("3자리(기본): 5011 → 501-1, 1201은 120-1", () => {
    assert.equal(normalizeId("5011"), "501-1");
    assert.equal(normalizeId("1201"), "120-1");
    assert.equal(normalizeId("12011"), "1201-1");
  });
});

describe("환자 미지정 메모", () => {
  const memo = (room: string, text: string): HandoverMemo => ({ id: `m-${room}`, shiftId: "s", room, text, updatedAt: 0 });
  test("병동 메모에서 호실-병상을 못 찾은 줄은 경고뿐이어도 버리지 않음", () => {
    const memos = [memo(WARD_MEMO, "낙상 주의\n14시 수액 교체\n501-1 NPO")];
    const { tasks, leftovers } = planTasks(memos, { excluded: [] }, E);
    assert.deepEqual(
      tasks.filter((t) => t.room === WARD_MEMO).map((t) => [t.time, t.text, t.tag]),
      [
        [null, "낙상 주의", "warning"],
        ["14:00", "수액 교체", "normal"],
      ],
    );
    assert.equal(leftovers.length, 0);
    // 환자가 있는 경고뿐인 조각은 기존처럼 칩으로만
    assert.equal(tasks.some((t) => t.room === "501-1"), false);
  });
});

describe("공휴일 (정적 데이터)", () => {
  test("성탄절·설 연휴·노동절·제헌절, 주말은 공휴일이 아님", async () => {
    const { holidayName } = await import("../src/lib/holidays");
    assert.equal(holidayName("2026-12-25"), "성탄절");
    assert.equal(holidayName("2027-02-07"), "설날");
    assert.equal(holidayName("2026-05-01"), "노동절");
    assert.equal(holidayName("2026-07-17"), "제헌절");
    assert.equal(holidayName("2026-11-21"), null, "토요일");
    assert.equal(holidayName("2026-11-22"), null, "일요일");
  });

  test("데이터의 대체공휴일 = 규칙으로 계산한 대체공휴일 (2026·2027)", async () => {
    const { HOLIDAY_FILES, computeSubstitutes } = await import("../src/lib/holidays");
    for (const [year, file] of Object.entries(HOLIDAY_FILES)) {
      const stored = Object.fromEntries(Object.entries(file.holidays).filter(([, n]) => n.startsWith("대체공휴일")));
      assert.deepEqual(computeSubstitutes(file.holidays), stored, `${year}년`);
      assert.ok(file._source && file._checked, `${year}년 출처·확인일`);
    }
  });

  test("2027년: 일요일·토요일과 겹치면 다음 평일이 대체공휴일, 대체 대상이 아닌 날은 없음", async () => {
    const { HOLIDAY_FILES, computeSubstitutes } = await import("../src/lib/holidays");
    const sub = computeSubstitutes(HOLIDAY_FILES[2027].holidays);
    assert.equal(sub["2027-02-09"], "대체공휴일(설날)", "설날(2/7)이 일요일 → 연휴 다음 화요일");
    assert.equal(sub["2027-05-03"], "대체공휴일(노동절)", "노동절(5/1)이 토요일 → 일요일 건너 월요일");
    assert.equal(sub["2027-07-19"], "대체공휴일(제헌절)", "제헌절(7/17)이 토요일");
    assert.equal(sub["2027-08-16"], "대체공휴일(광복절)", "광복절(8/15)이 일요일");
    assert.equal(sub["2027-10-04"], "대체공휴일(개천절)", "개천절(10/3)이 일요일");
    assert.equal(sub["2027-10-11"], "대체공휴일(한글날)", "한글날(10/9)이 토요일 → 10/10 일요일 건너 월요일");
    assert.equal(sub["2027-12-27"], "대체공휴일(성탄절)", "성탄절(12/25)이 토요일");
    assert.equal(Object.values(sub).some((n) => n.includes("현충일")), false, "현충일(6/6 일요일)은 대체 없음");
    assert.equal(Object.keys(sub).length, 7);
  });

  test("대체공휴일이 다른 공휴일과 겹치면 그다음 평일로", async () => {
    const { computeSubstitutes } = await import("../src/lib/holidays");
    // 가상의 해: 토요일 휴일 다음 월요일이 이미 공휴일이면 화요일로
    const sub = computeSubstitutes({ "2027-10-09": "한글날", "2027-10-11": "가상 공휴일" });
    assert.deepEqual(sub, { "2027-10-12": "대체공휴일(한글날)" });
  });
});
