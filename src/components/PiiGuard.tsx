"use client";
/* 전송 전 비식별 검사. 감지되면 전송을 멈추고 해당 부분을 강조 표시한다. */
import { useCallback, useMemo, useState } from "react";
import { Eraser, ShieldAlert } from "lucide-react";
import { detectPII, HIT_LABEL, redact, segments, type Hit } from "@/lib/deidentify";
import { Sheet } from "./ui/Overlay";
import { Button } from "./ui/Button";

type Pending = { texts: string[]; hits: Hit[][]; send: (clean: string[], how: "clean" | "ignore") => void };

/** rooms: 이번 근무의 환자 ID — 문장 속에 그대로 쓰이면 가린다 */
export function usePiiGuard(rooms: string[]) {
  const [pending, setPending] = useState<Pending | null>(null);

  const key = rooms.join(",");
  const opts = useMemo(() => ({ rooms: key ? key.split(",") : [] }), [key]);

  /** texts에 개인정보가 없으면 바로 send, 있으면 시트를 띄움 */
  const guard = useCallback(
    (texts: string[], send: Pending["send"]) => {
      const hits = texts.map((t) => detectPII(t, opts));
      if (hits.every((h) => h.length === 0)) return send(texts, "clean");
      setPending({ texts, hits, send });
    },
    [opts],
  );

  const sheet = (
    <Sheet open={!!pending} onClose={() => setPending(null)} title="개인정보로 보이는 부분이 있어요">
      {pending && (
        <>
          <div className="flex flex-col gap-2">
            {pending.texts.map((t, i) =>
              pending.hits[i].length ? (
                <p key={i} className="rounded-2xl bg-raised p-4">
                  {segments(t, pending.hits[i]).map((s, j) =>
                    s.hit ? (
                      <mark key={j} className="rounded bg-sun-soft px-1 font-semibold text-on-sun-soft underline decoration-warn decoration-2 underline-offset-4">
                        {s.text}
                        <span className="sr-only">({HIT_LABEL[s.hit.type]})</span>
                      </mark>
                    ) : (
                      <span key={j}>{s.text}</span>
                    ),
                  )}
                </p>
              ) : null,
            )}
          </div>
          <p className="mt-4 flex flex-wrap gap-x-4 text-sm text-muted">
            {[...new Set(pending.hits.flat().map((h) => HIT_LABEL[h.type]))].map((l) => (
              <span key={l} className="inline-flex items-center gap-1">
                <ShieldAlert className="size-4 text-warn" aria-hidden />
                {l}
              </span>
            ))}
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              size="lg"
              full
              icon={<Eraser className="size-5" />}
              onClick={() => {
                const p = pending;
                setPending(null);
                p.send(p.texts.map((t, i) => redact(t, p.hits[i], "remove")), "clean");
              }}
            >
              지우고 전송
            </Button>
            <Button
              variant="ghost"
              full
              onClick={() => {
                const p = pending;
                setPending(null);
                // 실명·호실·전화·주민번호는 무시해도 자동으로 가림
                p.send(p.texts.map((t, i) => redact(t, p.hits[i], "hardOnly")), "ignore");
              }}
            >
              무시하고 전송
            </Button>
          </div>
          {pending.hits.flat().some((h) => h.hard) && <p className="mt-2 text-center text-sm text-muted">호실-병상·전화번호는 무시해도 가려서 보내요</p>}
        </>
      )}
    </Sheet>
  );

  return { guard, sheet };
}
