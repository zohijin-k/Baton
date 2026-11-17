"use client";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { nextDuty } from "@/lib/shift";
import type { Shift } from "@/lib/types";

/** 진행 중인 근무. undefined = 불러오는 중, null = 근무 중 아님 */
export function useActiveShift(): Shift | null | undefined {
  return useLiveQuery(async () => (await db.shifts.where("status").equals("active").first()) ?? null, [], undefined);
}

/** after 날짜 다음의 첫 근무 (캘린더가 바뀌면 다시 계산) */
export function useNextDuty(after: string) {
  return useLiveQuery(() => nextDuty(after), [after], null);
}

/** 1분마다 바뀌는 현재 시각 (지금 할 일 강조용) */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
