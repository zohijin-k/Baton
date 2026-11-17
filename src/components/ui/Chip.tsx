"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

type Tone = "default" | "selected" | "patient" | "warning";

const TONES: Record<Tone, string> = {
  default: "bg-raised border-transparent text-ink",
  // 선택된 키워드 칩: 연한 노랑 배경 + 노랑 테두리 1px
  selected: "bg-sun-soft border-sun text-on-sun-soft font-semibold",
  // 선택된 환자: 초록
  patient: "bg-green-soft border-green text-ink font-semibold",
  warning: "bg-warn-soft border-transparent text-warn font-semibold",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone;
  icon?: ReactNode;
  /** 균등 그리드 칸을 꽉 채우는 칩 (좌우 여백 최소) */
  fill?: boolean;
}

export function Chip({ tone = "default", icon, fill, className = "", children, ...rest }: Props) {
  return (
    <button
      type="button"
      aria-pressed={tone === "selected" || tone === "patient"}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full border text-base whitespace-nowrap transition active:scale-[0.97] ${
        fill ? "w-full px-1" : "shrink-0 px-4"
      } ${TONES[tone]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** 상단 고정 경고 칩 (NPO·낙상·알레르기 …) — 누를 수 없는 표시용 */
export function WarnBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-warn-soft px-2 text-sm font-semibold whitespace-nowrap text-warn">
      <TriangleAlert className="size-4" aria-hidden />
      {children}
    </span>
  );
}
