"use client";
import type { ReactNode } from "react";

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  /** 선택됐을 때 쓸 색 (듀티 라벨 등). 없으면 기본 표면 */
  onClass?: string;
}

/** 하나만 고르는 버튼 묶음. 선택 = 밝은 표면 + 굵은 글자 (색만으로 구분하지 않음) */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  allowDeselect,
  className = "",
}: {
  options: SegOption<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  label: string;
  /** 같은 버튼을 다시 누르면 해제 */
  allowDeselect?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`flex gap-1 rounded-2xl bg-raised p-1 ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on && allowDeselect ? null : o.value)}
            className={`min-h-12 min-w-0 flex-1 rounded-xl px-2 text-base transition ${
              on ? `font-semibold ring-1 ring-inset ring-green ${o.onClass ?? "bg-sheet text-ink"}` : "text-muted active:bg-sheet"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
