import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { GenerateReq, HandoverOut, RecordOut, TasksOut, type GenerateRes } from "@/lib/llm/schemas";
import { HANDOVER_SYSTEM, RECORD_SYSTEM, TASKS_SYSTEM } from "@/lib/llm/prompts";
import { mockHandover, mockRecord, mockTasks } from "@/lib/llm/mock";

/* LLM 호출은 이 서버 라우트에서만. API 키는 환경변수(ANTHROPIC_API_KEY)에만 둔다.
   키가 없으면 데모 모드(목업 응답)로 동작한다.
   요청 본문은 로그로 남기지 않는다. */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const isLive = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 }));

export async function GET() {
  return Response.json({ mode: isLive() ? "live" : "demo" });
}

export async function POST(req: Request) {
  let body: GenerateReq;
  try {
    body = GenerateReq.parse(await req.json());
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않아요." }, { status: 400 });
  }

  if (!isLive()) return Response.json(demo(body));

  try {
    return Response.json(await live(body));
  } catch (err) {
    if (err instanceof RefusalError) return Response.json({ error: "이 내용은 문장으로 만들 수 없어요." }, { status: 422 });
    if (err instanceof Anthropic.RateLimitError) return Response.json({ error: "요청이 많아요. 잠시 후 다시 시도하세요." }, { status: 429 });
    if (err instanceof Anthropic.AuthenticationError) return Response.json({ error: "서버 API 키를 확인하세요." }, { status: 500 });
    if (err instanceof Anthropic.APIConnectionError) return Response.json({ error: "AI 서버에 연결하지 못했어요." }, { status: 502 });
    if (err instanceof Anthropic.APIError) return Response.json({ error: `AI 오류 (${err.status ?? "?"})` }, { status: 502 });
    return Response.json({ error: "문장을 만들지 못했어요." }, { status: 500 });
  }
}

function demo(body: GenerateReq): GenerateRes {
  switch (body.kind) {
    case "record":
      return { mode: "demo", kind: "record", data: mockRecord(body.keywords, body.dict) };
    case "handover":
      return { mode: "demo", kind: "handover", data: mockHandover(body.patients) };
    case "tasks":
      return { mode: "demo", kind: "tasks", data: mockTasks(body.items, body.window) };
  }
}

class RefusalError extends Error {}

async function ask<T extends z.ZodType>(system: string, user: string, schema: T): Promise<z.infer<T>> {
  const res = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
    // 짧은 정형 작업이므로 effort는 낮게 (응답 속도 우선)
    output_config: { effort: "low", format: betaZodOutputFormat(schema) },
    // 정책상 거절 시 서버 측 기본 대체 모델로 재시도
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (res.stop_reason === "refusal") throw new RefusalError();
  if (!res.parsed_output) throw new Error("parse_failed");
  return res.parsed_output as z.infer<T>;
}

async function live(body: GenerateReq): Promise<GenerateRes> {
  switch (body.kind) {
    case "record": {
      const user = JSON.stringify({ alias: body.alias, keywords: body.keywords, abbreviations: body.dict });
      return { mode: "live", kind: "record", data: await ask(RECORD_SYSTEM, user, RecordOut) };
    }
    case "handover":
      return { mode: "live", kind: "handover", data: await ask(HANDOVER_SYSTEM, JSON.stringify({ patients: body.patients }), HandoverOut) };
    case "tasks":
      return { mode: "live", kind: "tasks", data: await ask(TASKS_SYSTEM, JSON.stringify({ window: body.window, fragments: body.items }), TasksOut) };
  }
}
