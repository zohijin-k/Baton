/* 자동 삭제 (앱을 열 때 + 1시간마다 확인)
   - 인계 메모·할 일: 근무 종료 후 12시간
   - 기록 문장: 처음 복사한 뒤 24시간. 복사하지 않은 기록은 근무 종료 후 24시간
   - 인계(EMR용·말로 인계): 근무 종료 후 24시간
   - 듀티 캘린더·날짜 메모: 삭제하지 않음
   - 종료를 누르지 않은 근무는 예정 종료 12시간 뒤 예정 종료 시각으로 종료 처리 */
import { db } from "./db";

export const HOUR = 60 * 60 * 1000;
export const MEMO_TTL = 12 * HOUR;
export const RECORD_TTL = 24 * HOUR;
export const FORGOTTEN_AFTER = 12 * HOUR;
export const PURGE_INTERVAL = HOUR;
/** 자동 종료된 근무 안내 (다음 실행 때 한 번 보여주고 지움) */
export const AUTO_END_NOTICE = "notice:autoEnded";
export interface AutoEndNotice {
  date: string;
  duty: string;
}

export interface PurgeResult {
  autoEnded: number;
  memos: number;
  tasks: number;
  records: number;
  handovers: number;
  shifts: number;
}

export async function purgeExpired(now = Date.now()): Promise<PurgeResult> {
  return db.transaction("rw", [db.shifts, db.memos, db.tasks, db.records, db.handovers, db.kv], async () => {
    const r: PurgeResult = { autoEnded: 0, memos: 0, tasks: 0, records: 0, handovers: 0, shifts: 0 };

    for (const s of await db.shifts.where("status").equals("active").toArray()) {
      if (now >= s.endAt + FORGOTTEN_AFTER) {
        await db.shifts.update(s.id, { status: "ended", endedAt: s.endAt });
        await db.kv.put({ key: AUTO_END_NOTICE, value: { date: s.date, duty: s.duty } satisfies AutoEndNotice });
        r.autoEnded++;
      }
    }

    const shifts = await db.shifts.toArray();
    const endedAt = new Map(shifts.filter((s) => s.status === "ended").map((s) => [s.id, s.endedAt ?? s.endAt]));
    const known = new Set(shifts.map((s) => s.id));
    const past = (id: string, ttl: number) => endedAt.has(id) && now >= endedAt.get(id)! + ttl;

    const memoShifts = [...endedAt.keys()].filter((id) => past(id, MEMO_TTL));
    if (memoShifts.length) {
      r.memos = await db.memos.where("shiftId").anyOf(memoShifts).delete();
      r.tasks = await db.tasks.where("shiftId").anyOf(memoShifts).delete();
      const prefixes = memoShifts.map((id) => `input:${id}:`);
      await db.kv.filter((row) => prefixes.some((p) => row.key.startsWith(p))).delete();
      // 담당 환자 목록도 메모와 같이 비움
      await db.shifts.where("id").anyOf(memoShifts).modify({ rooms: [], excluded: [] });
    }

    r.records = await db.records
      .filter((rec) => {
        if (rec.copiedAt !== undefined) return now >= rec.copiedAt + RECORD_TTL;
        if (known.has(rec.shiftId)) return past(rec.shiftId, RECORD_TTL);
        // 근무 정보가 없는 기록(이전 버전에서 옮겨 옴): 확정(또는 작성) 후 24시간
        return now >= (rec.confirmedAt ?? rec.createdAt) + RECORD_TTL;
      })
      .delete();

    r.handovers = await db.handovers.filter((h) => !known.has(h.shiftId) || past(h.shiftId, RECORD_TTL)).delete();

    // 근무 행: 딸린 데이터가 모두 지워진 뒤 삭제 (호실 목록도 함께 사라짐)
    const stillUsed = new Set((await db.records.toArray()).map((x) => x.shiftId));
    const drop = [...endedAt.keys()].filter((id) => past(id, MEMO_TTL) && past(id, RECORD_TTL) && !stillUsed.has(id));
    await db.shifts.bulkDelete(drop);
    r.shifts = drop.length;
    return r;
  });
}
