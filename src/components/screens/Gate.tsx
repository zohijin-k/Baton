"use client";
/* 시작 화면 · PIN 설정 · 이름 입력 · 3단계 안내 · 잠금 화면 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ClipboardList, Delete, FilePenLine, SquareCheck } from "lucide-react";
import { useSession } from "../session";
import { Button } from "../ui/Button";
import { ActionBar } from "../ui/Layout";
import { LogoGlow, LogoMark } from "../ui/Logo";
import { ConfirmDialog } from "../ui/Overlay";
import { wipeAll } from "@/lib/db";

const safeTop = { paddingTop: "env(safe-area-inset-top)" };

/** PIN 화면 공통: 로고(1/3 지점) → 제목 → 설명 → 점 → (여백) → 키패드(하단) */
function PinScreen({
  title,
  hint = "숫자 4자리",
  error,
  onDone,
  footer,
}: {
  title: string;
  hint?: string;
  error?: string;
  onDone: (pin: string) => void | Promise<void>;
  footer?: ReactNode;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });

  useEffect(() => {
    if (pin.length !== 4) return;
    const p = pin;
    // 점 4개가 채워진 걸 잠깐 보여준 뒤 처리
    const t = setTimeout(async () => {
      setBusy(true);
      await doneRef.current(p);
      setPin("");
      setBusy(false);
    }, 120);
    return () => clearTimeout(t);
  }, [pin]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 4 ? p + e.key : p));
      if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const press = (d: string) => !busy && setPin((p) => (p.length < 4 ? p + d : p));
  const key = "group flex h-16 items-center justify-center";
  const ring = "flex size-16 items-center justify-center rounded-full transition-colors group-active:bg-raised";

  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-6 pb-safe" style={safeTop}>
      <div className="flex flex-col items-center text-center" style={{ paddingTop: "max(24px, calc(33dvh - 40px))" }}>
        <LogoGlow>
          <LogoMark size={80} />
        </LogoGlow>
        <h1 className="mt-6 text-title font-semibold">{title}</h1>
        <p className={`mt-2 min-h-[1.5em] text-sm ${error ? "text-warn" : "text-muted"}`} role={error ? "alert" : undefined}>
          {error ?? hint}
        </p>
        <div className="mt-8 flex gap-5" aria-label={`${pin.length}자리 입력됨`}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`size-3.5 rounded-full border-2 ${i < pin.length ? "border-sun bg-sun" : "border-dot-empty"}`} />
          ))}
        </div>
        {footer && <div className="mt-4">{footer}</div>}
      </div>
      <div className="min-h-6 flex-1" />
      <div className="mx-auto grid w-full max-w-[312px] grid-cols-3 pb-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0"].map((d, i) =>
          d ? (
            <button key={i} type="button" onClick={() => press(d)} className={key}>
              <span className={`${ring} text-key font-normal text-ink`}>{d}</span>
            </button>
          ) : (
            <span key={i} />
          ),
        )}
        <button type="button" aria-label="지우기" onClick={() => setPin((p) => p.slice(0, -1))} className={key}>
          <span className={ring}>
            <Delete className="size-7" aria-hidden />
          </span>
        </button>
      </div>
    </main>
  );
}

const GUIDE = [
  { icon: SquareCheck, title: "인계 메모를 적으면\n오늘 할 일이 돼요", text: "할 일 탭에서 근무를 시작해요" },
  { icon: FilePenLine, title: "키워드만 누르면\n기록 문장이 돼요", text: "확정한 문장을 복사해 EMR에 붙여요" },
  { icon: ClipboardList, title: "근무가 끝나면\n인계를 만들어요", text: "EMR용 문단과 말로 인계를 한 번에" },
  { icon: CalendarDays, title: "근무표를 넣어 두면\n시작이 빨라져요", text: "듀티 탭에서 한 달을 1분 안에" },
];

export function Onboarding() {
  const { setupPin, update, finishOnboarding, settings } = useSession();
  const [step, setStep] = useState<"pin" | "confirm" | "name" | "guide">("pin");
  const [first, setFirst] = useState("");
  const [error, setError] = useState<string>();
  const [name, setName] = useState(settings.author);
  const [g, setG] = useState(0);

  const done = async () => {
    await update({ guideDone: true });
    finishOnboarding();
  };

  if (step === "pin")
    return (
      <PinScreen
        key="pin"
        title="잠금 번호를 정해 주세요"
        error={error}
        onDone={(p) => {
          setFirst(p);
          setError(undefined);
          setStep("confirm");
        }}
      />
    );
  if (step === "confirm")
    return (
      <PinScreen
        key="confirm"
        title="한 번 더 입력해 주세요"
        onDone={async (p) => {
          if (p !== first) {
            setError("번호가 달라요. 처음부터 다시 정해 주세요");
            setStep("pin");
            return;
          }
          await setupPin(p);
          setStep("name");
        }}
      />
    );

  if (step === "name")
    return (
      <main className="mx-auto min-h-dvh max-w-[480px] px-6" style={safeTop}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await update({ author: name.trim() });
            setStep("guide");
          }}
        >
          <label htmlFor="author" className="block whitespace-pre-line pt-16 text-title font-semibold">
            {"기록에 남길 이름을\n알려 주세요"}
          </label>
          <input
            id="author"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 김간호"
            maxLength={20}
            className="mt-8 h-14 w-full rounded-2xl border-2 border-transparent bg-raised px-4 outline-none placeholder:text-muted focus:border-green"
          />
          <p className="mt-2 text-sm text-muted">확정한 기록의 작성자로 표시돼요</p>
          <ActionBar overTabs={false}>
            <Button type="submit" size="lg" full disabled={!name.trim()}>
              다음
            </Button>
          </ActionBar>
        </form>
      </main>
    );

  const { icon: Icon, title, text } = GUIDE[g];
  return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-6" style={safeTop}>
      <div className="-mr-4 flex h-14 items-center justify-end">
        <button type="button" onClick={done} className="min-h-12 px-4 text-sm text-muted">
          건너뛰기
        </button>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center pb-40 text-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-sun/10 text-green">
          <Icon className="size-12" aria-hidden />
        </div>
        <h1 className="mt-8 whitespace-pre-line text-title font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted">{text}</p>
        <div className="mt-8 flex gap-2" aria-label={`${g + 1} / ${GUIDE.length}`}>
          {GUIDE.map((_, i) => (
            <span key={i} className={`h-2 rounded-full transition-all ${i === g ? "w-6 bg-sun" : "w-2 bg-line"}`} />
          ))}
        </div>
      </div>
      <ActionBar overTabs={false}>
        <Button size="lg" full onClick={() => (g < GUIDE.length - 1 ? setG(g + 1) : done())}>
          {g < GUIDE.length - 1 ? "다음" : "시작하기"}
        </Button>
      </ActionBar>
    </main>
  );
}

export function LockScreen() {
  const { unlock } = useSession();
  const [error, setError] = useState<string>();
  const [tries, setTries] = useState(0);
  const [forgot, setForgot] = useState(false);

  return (
    <>
      <PinScreen
        title="잠금 번호를 입력해 주세요"
        error={error}
        onDone={async (p) => {
          const ok = await unlock(p);
          if (!ok) {
            setTries((t) => t + 1);
            setError("번호가 맞지 않아요");
          }
        }}
        footer={
          tries >= 3 && (
            <button type="button" onClick={() => setForgot(true)} className="min-h-12 px-4 text-sm text-muted underline">
              번호를 잊었어요
            </button>
          )
        }
      />
      <ConfirmDialog
        open={forgot}
        title="모든 데이터를 지울까요?"
        message="번호 없이는 열 수 없어요. 처음부터 시작해요."
        confirmLabel="전체 삭제"
        danger
        onClose={() => setForgot(false)}
        onConfirm={async () => {
          await wipeAll();
          location.reload();
        }}
      />
    </>
  );
}
