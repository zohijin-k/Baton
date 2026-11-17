import { Check } from "lucide-react";

/** 체크박스 모양 (터치 영역은 감싸는 버튼이 48px 이상 확보) */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-7 shrink-0 items-center justify-center rounded-lg border-2 ${checked ? "border-green bg-green text-on-green" : "border-dot-empty bg-transparent"}`}
    >
      {checked && <Check className="size-5" strokeWidth={3} />}
    </span>
  );
}
