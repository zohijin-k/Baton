import type { HTMLAttributes, ReactNode } from "react";
import { CircleCheck } from "lucide-react";

type State = "plain" | "draft" | "confirmed" | "now";

const STATES: Record<State, string> = {
  plain: "bg-card border border-card-border",
  // 초안: 점선 테두리 1px
  draft: "bg-card border border-dashed border-draft-line",
  // 확정: 연한 초록 배경 + 왼쪽 3px 초록 막대
  confirmed: "bg-green-soft border-l-[3px] border-green",
  // 지금 할 일: 왼쪽 노랑 막대 4px + 연한 노랑 배경
  now: "bg-sun-soft text-on-sun-soft border-l-4 border-sun",
};

export function Card({ state = "plain", className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { state?: State }) {
  return <div className={`rounded-card p-4 ${STATES[state]} ${className}`} {...rest} />;
}

/** 카드 상단 상태 라벨: 초안 / 확정 / 대기 */
export function StateLabel({ state, right }: { state: "draft" | "confirmed" | "pending"; right?: ReactNode }) {
  return (
    <div className="mb-2 flex min-h-6 items-center justify-between gap-2 text-sm">
      {state === "confirmed" ? (
        <span className="inline-flex items-center gap-1 font-semibold text-green">
          <CircleCheck className="size-4" aria-hidden />
          확정
        </span>
      ) : (
        <span className="inline-flex items-center gap-2 font-semibold text-muted">
          <span className="size-2 rounded-full border border-dashed border-muted" aria-hidden />
          {state === "draft" ? "초안" : "대기"}
        </span>
      )}
      {right && <span className="text-muted">{right}</span>}
    </div>
  );
}
