"use client";
/* 듀티 '이미지로 공유' 시트: 미리보기 + 옵션 + [공유]. 이미지는 기기 안에서만 만든다 */
import { useEffect, useRef, useState } from "react";
import { Share } from "lucide-react";
import { drawShareImage, sharePng, SHARE_H, SHARE_W, type ShareTheme } from "@/lib/shareImage";
import type { DutyDay } from "@/lib/types";
import { useSession } from "./session";
import { Button } from "./ui/Button";
import { Segmented } from "./ui/Segmented";
import { toast } from "./ui/Overlay";

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-12 w-full items-center justify-between gap-3 text-left">
      <span>{label}</span>
      <span className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "bg-green" : "bg-dot-empty"}`} aria-hidden>
        <span className={`size-6 rounded-full bg-sheet transition-transform ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

export function DutyShareSheet({ year, month, byDate }: { year: number; month: number; byDate: Map<string, DutyDay> }) {
  const { settings } = useSession();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [events, setEvents] = useState(false);
  const [roles, setRoles] = useState(false);
  const [showName, setShowName] = useState(false);
  // 기본 테마 = 지금 앱 테마
  const [theme, setTheme] = useState<ShareTheme>(() => (document.documentElement.dataset.theme === "light" ? "light" : "dark"));
  const [busy, setBusy] = useState(false);
  const name = settings.author.trim();

  // 옵션이 바뀌면 미리보기(=공유할 캔버스)를 다시 그린다. 글꼴이 준비된 뒤에 그림
  useEffect(() => {
    let alive = true;
    const fontFamily = getComputedStyle(document.body).fontFamily;
    document.fonts.ready.then(() => {
      if (!alive || !canvas.current) return;
      drawShareImage(canvas.current, year, month, byDate, { theme, events, roles, name: showName ? name : undefined, label: settings.dutyLabel, fontFamily });
    });
    return () => {
      alive = false;
    };
  }, [year, month, byDate, theme, events, roles, showName, name, settings.dutyLabel]);

  const share = async () => {
    if (!canvas.current) return;
    setBusy(true);
    try {
      const r = await sharePng(canvas.current, `baton-duty-${year}-${String(month + 1).padStart(2, "0")}.png`, `${year}년 ${month + 1}월 근무표`);
      if (r === "downloaded") toast("이미지를 저장했어요");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <canvas
        ref={canvas}
        width={SHARE_W}
        height={SHARE_H}
        aria-label={`${year}년 ${month + 1}월 근무표 미리보기`}
        className="mx-auto aspect-[4/5] w-full max-w-[280px] rounded-xl border border-card-border"
      />
      <div className="divide-y divide-line">
        <Switch label="일정 포함" checked={events} onChange={setEvents} />
        <Switch label="역할(차·액) 포함" checked={roles} onChange={setRoles} />
        {name && <Switch label={`이름 표시 (${name})`} checked={showName} onChange={setShowName} />}
        <div className="flex min-h-12 items-center justify-between gap-3 pt-2">
          <span>테마</span>
          <Segmented
            className="w-40"
            label="공유 이미지 테마"
            value={theme}
            onChange={(v) => v && setTheme(v)}
            options={[
              { value: "dark", label: "다크" },
              { value: "light", label: "라이트" },
            ]}
          />
        </div>
      </div>
      <Button full size="lg" loading={busy} icon={<Share className="size-5" aria-hidden />} onClick={share}>
        공유
      </Button>
    </div>
  );
}
