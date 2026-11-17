"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const STYLES: Record<Variant, string> = {
  // 비활성: 탁한 초록 대신 중립 면 + 흐린 글자
  primary: "bg-primary text-on-primary font-semibold active:bg-primary-press disabled:bg-disabled-bg disabled:text-disabled-ink",
  secondary: "bg-raised text-ink font-medium active:bg-sheet disabled:text-disabled-ink",
  ghost: "text-green font-medium active:bg-raised disabled:text-disabled-ink",
  danger: "bg-raised text-warn font-semibold active:bg-sheet disabled:text-disabled-ink",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  loading?: boolean;
  full?: boolean;
  /** lg = 화면 하단 주요 버튼 (높이 56px) */
  size?: "md" | "lg";
}

/** 라벨은 6글자 이내. 터치 영역 48px 이상, 모서리 16px */
export function Button({ variant = "primary", icon, loading, full, size = "md", className = "", children, disabled, ...rest }: Props) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 transition ${size === "lg" ? "h-14" : "min-h-12"} ${
        full ? "w-full" : ""
      } ${STYLES[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

/** 아이콘만 있는 버튼 (헤더 등) — aria-label 필수 */
export function IconButton({
  label,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full text-ink active:bg-raised ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
