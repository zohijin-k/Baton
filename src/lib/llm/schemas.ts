import { z } from "zod";

/* 외부로 나가는 환자 식별자는 요청마다 새로 붙이는 임시 가명("환자1")뿐이다.
   호실-병상은 보내지 않는다. */
const alias = z.string().regex(/^환자\d{1,4}$/, "가명 ID만 허용");
const short = (n: number) => z.string().max(n);

/* ── 요청 (클라이언트 → 서버) ── */
export const RecordReq = z.object({
  kind: z.literal("record"),
  alias,
  keywords: z.array(short(120)).min(1).max(40),
  dict: z.record(short(30), short(60)).default({}),
});

export const HandoverReq = z.object({
  kind: z.literal("handover"),
  patients: z
    .array(
      z.object({
        alias,
        records: z.array(z.object({ time: short(5), text: short(600) })).min(1).max(40),
      }),
    )
    .min(1)
    .max(40),
});

export const TasksReq = z.object({
  kind: z.literal("tasks"),
  /** 근무 시간 "15:00-23:00" — 오전/오후가 모호한 시각을 맞추는 데만 사용 */
  window: z
    .string()
    .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)
    .optional(),
  items: z.array(z.object({ alias, text: short(300) })).min(1).max(60),
});

export const GenerateReq = z.discriminatedUnion("kind", [RecordReq, HandoverReq, TasksReq]);
export type GenerateReq = z.infer<typeof GenerateReq>;

/* ── 응답 (LLM 출력 JSON 형식) ── */
export const RecordOut = z.object({
  sentence: z.string(),
  uncertain: z.array(z.string()),
});

export const HandoverOut = z.object({
  patients: z.array(z.object({ alias: z.string(), emr: z.string(), verbal: z.array(z.string()) })),
});

export const TasksOut = z.object({
  tasks: z.array(
    z.object({
      alias: z.string(),
      time: z.string().nullable(),
      text: z.string(),
      tag: z.enum(["warning", "normal"]),
      uncertain: z.boolean(),
    }),
  ),
});

export type RecordOut = z.infer<typeof RecordOut>;
export type HandoverOut = z.infer<typeof HandoverOut>;
export type TasksOut = z.infer<typeof TasksOut>;

export type GenerateRes =
  | { mode: "demo" | "live"; kind: "record"; data: RecordOut }
  | { mode: "demo" | "live"; kind: "handover"; data: HandoverOut }
  | { mode: "demo" | "live"; kind: "tasks"; data: TasksOut };
