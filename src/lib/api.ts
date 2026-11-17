import type { GenerateReq, GenerateRes } from "./llm/schemas";

export class OfflineError extends Error {
  constructor() {
    super("오프라인이에요. 저장해 두고 연결되면 만들 수 있어요.");
  }
}

/** 서버 API Route 호출 — 클라이언트는 LLM을 직접 부르지 않는다 */
export async function generate<K extends GenerateReq["kind"]>(
  req: Extract<GenerateReq, { kind: K }>,
): Promise<Extract<GenerateRes, { kind: K }>> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new OfflineError();
  let res: Response;
  try {
    res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  } catch {
    throw new OfflineError();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "문장을 만들지 못했어요.");
  return json;
}
