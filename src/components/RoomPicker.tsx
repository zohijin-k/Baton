"use client";
/* 담당 환자(호실-병상) 입력: 화면 키패드 + 쉼표로 구분 → 칩. 칩을 길게 누르면 뺀다.
   "501-1", "5011", "501 1" → 501-1 / "503" → 503호 전체 / "501-1~501-4", "501-1~4" 범위 */
import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";
import { idLabel, parseIdList, sortIds } from "@/lib/room";
import { useSession } from "./session";

const LONG_PRESS_MS = 500;

export function RoomChips({ ids, onRemove, empty }: { ids: string[]; onRemove?: (id: string) => void; empty?: string }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pressing, setPressing] = useState<string | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = (id: string) => {
    if (!onRemove) return;
    clearTimeout(timer.current);
    setPressing(id);
    timer.current = setTimeout(() => {
      setPressing(null);
      navigator.vibrate?.(20);
      onRemove(id);
    }, LONG_PRESS_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    setPressing(null);
  };

  if (!ids.length) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="담당 환자">
      {ids.map((id) => (
        <li key={id}>
          <button
            type="button"
            aria-label={onRemove ? `${idLabel(id)}, 길게 누르거나 Delete 키로 빼기` : idLabel(id)}
            onPointerDown={() => start(id)}
            onPointerUp={cancel}
            onPointerLeave={cancel}
            onPointerCancel={cancel}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => (e.key === "Delete" || e.key === "Backspace") && onRemove?.(id)}
            className={`inline-flex min-h-12 items-center rounded-full border px-4 font-semibold tabular-nums transition select-none [-webkit-touch-callout:none] ${
              pressing === id ? "scale-95 border-warn bg-warn-soft text-warn" : "border-green bg-green-soft text-ink"
            }`}
          >
            {idLabel(id)}
          </button>
        </li>
      ))}
    </ul>
  );
}

const KEYS = ["1", "2", "3", "⌫", "4", "5", "6", "-", "7", "8", "9", "~", ",", "0"] as const;

/** 입력 + 키패드. onAdd는 새로 알아본 ID만 받는다 */
export function RoomKeypad({
  existing,
  onAdd,
  autoFocus,
  addLabel = "추가",
}: {
  existing: string[];
  onAdd: (ids: string[]) => void;
  autoFocus?: boolean;
  addLabel?: string;
}) {
  const { settings } = useSession();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw = text) => {
    const { ids, invalid } = parseIdList(raw);
    const fresh = ids.filter((id) => !existing.includes(id));
    if (fresh.length) onAdd(sortIds(fresh));
    setText(invalid.join(", "));
    setError(invalid.length ? `알아볼 수 없어요: ${invalid.join(", ")}` : null);
  };

  const press = (k: (typeof KEYS)[number]) => {
    setError(null);
    if (k === "⌫") return setText((t) => t.slice(0, -1));
    if (k === ",") return commit();
    setText((t) => t + k);
  };

  return (
    <div>
      <div>
        <label htmlFor="room-input" className="sr-only">
          호실-병상
        </label>
        <input
          id="room-input"
          ref={inputRef}
          autoFocus={autoFocus}
          value={text}
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value;
            setError(null);
            // 쉼표를 치면 바로 칩으로
            if (/[,，]/.test(v)) commit(v);
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={settings.roomDigits === 4 ? "예: 1201-1, 12021, 1203" : "예: 501-1, 5021, 503"}
          aria-describedby="room-hint"
          aria-invalid={!!error}
          className="h-14 w-full rounded-2xl border-2 border-transparent bg-raised px-4 tabular-nums outline-none placeholder:text-muted focus:border-green" data-ring="border"
        />
      </div>
      <p id="room-hint" className={`mt-2 min-h-[1.5em] text-sm ${error ? "text-warn" : "text-muted"}`} role={error ? "alert" : undefined}>
        {error ?? "쉼표로 구분 · 호실만 쓰면 호실 전체 · 칩을 길게 누르면 빠져요"}
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2" aria-label="숫자 키패드">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            // 입력창 포커스를 유지해 실제 키보드가 올라오지 않게
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => press(k)}
            aria-label={k === "⌫" ? "지우기" : k === "," ? "쉼표 (칩으로 추가)" : k === "~" ? "범위" : k === "-" ? "병상 구분" : k}
            className={`flex h-12 items-center justify-center rounded-xl text-heading active:bg-sheet ${k === "," ? "bg-green-soft font-semibold text-green" : "bg-raised"}`}
          >
            {k === "⌫" ? <Delete className="size-6" aria-hidden /> : k}
          </button>
        ))}
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => commit()}
          disabled={!text.trim()}
          className="col-span-2 h-12 rounded-xl bg-primary font-semibold text-on-primary active:bg-primary-press disabled:bg-disabled-bg disabled:text-disabled-ink"
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}
