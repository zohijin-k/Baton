"use client";
import { useState } from "react";
import { ArrowLeft, Lock, Moon, Plus, Sun, SunMoon, Trash2, X } from "lucide-react";
import { wipeAll } from "@/lib/db";
import { DEFAULT_DICT } from "@/lib/abbreviations";
import { DEFAULT_DUTY_TIMES } from "@/lib/time";
import type { Duty, ThemePref } from "@/lib/types";
import { useSession } from "../session";
import { Button, IconButton } from "../ui/Button";
import { Header } from "../ui/Layout";
import { DutyTag } from "../ui/Duty";
import { Segmented } from "../ui/Segmented";
import { ConfirmDialog, toast } from "../ui/Overlay";

const THEMES: { key: ThemePref; label: string; icon: typeof Sun }[] = [
  { key: "dark", label: "어둡게 (기본)", icon: Moon },
  { key: "light", label: "밝게", icon: Sun },
  { key: "auto", label: "시스템 따르기", icon: SunMoon },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-6">
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { settings, update, lock, mode } = useSession();
  const [name, setName] = useState(settings.author);
  const [abbr, setAbbr] = useState("");
  const [meaning, setMeaning] = useState("");
  const [wipe, setWipe] = useState(false);
  const dict = settings.abbreviationDict;

  const addAbbr = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!abbr.trim() || !meaning.trim()) return;
    await update({ abbreviationDict: { ...dict, [abbr.trim()]: meaning.trim() } });
    setAbbr("");
    setMeaning("");
  };

  return (
    <>
      <Header
        title="설정"
        left={
          <IconButton label="뒤로" onClick={onClose}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
      />
      <div className="mx-auto max-w-[480px] px-6 pt-2 pb-[calc(var(--spacing-tabbar)+24px+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-2 pb-6">
          <span className="text-sm text-muted">AI</span>
          <span className="text-sm text-muted">{mode === "live" ? "연결됨" : mode === "demo" ? "데모 모드 (목업 응답)" : "확인 중"}</span>
        </div>

        <Section title="화면">
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-card-border bg-card" role="radiogroup" aria-label="화면 모드">
            {THEMES.map(({ key, label, icon: Icon }) => {
              const on = settings.theme === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => update({ theme: key })}
                  className={`flex min-h-14 w-full items-center gap-4 px-4 text-left active:bg-raised ${on ? "font-semibold" : ""}`}
                >
                  <Icon className={`size-5 ${on ? "text-green" : "text-muted"}`} aria-hidden />
                  <span className="flex-1">{label}</span>
                  <span className={`flex size-5 items-center justify-center rounded-full border-2 ${on ? "border-green" : "border-dot-empty"}`} aria-hidden>
                    {on && <span className="size-2.5 rounded-full bg-green" />}
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="작성자 이름">
          <input
            aria-label="작성자 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== settings.author && update({ author: name.trim() }).then(() => toast("저장됨"))}
            maxLength={20}
            className="h-14 w-full rounded-2xl border-2 border-transparent bg-raised px-4 outline-none focus:border-green"
          />
        </Section>

        <Section title="호실 자릿수">
          <Segmented
            label="호실 자릿수"
            value={String(settings.roomDigits) as "3" | "4"}
            onChange={(v) => v && update({ roomDigits: v === "4" ? 4 : 3 }).then(() => toast("저장됨"))}
            options={[
              { value: "3", label: "3자리 (기본)" },
              { value: "4", label: "4자리" },
            ]}
          />
          <p className="mt-2 text-sm text-muted">
            {settings.roomDigits === 4 ? "12011 → 1201-1 · 1201 → 1201호 전체" : "5011 → 501-1 · 501 → 501호 전체"}
          </p>
        </Section>

        <Section title="근무 표기">
          <Segmented
            label="근무 표기"
            value={settings.dutyLabel}
            onChange={(v) => v && update({ dutyLabel: v }).then(() => toast("저장됨"))}
            options={[
              { value: "short", label: "D·E·N·OFF" },
              { value: "korean", label: "데이·이브닝·나이트·오프" },
            ]}
          />
        </Section>

        <Section title="근무 시간">
          <DutyTimes />
        </Section>

        <Section title="약어 사전">
          <form onSubmit={addAbbr} className="flex gap-2">
            <input
              aria-label="약어"
              value={abbr}
              onChange={(e) => setAbbr(e.target.value)}
              placeholder="약어"
              maxLength={30}
              autoCapitalize="off"
              className="h-12 w-24 min-w-0 rounded-2xl border-2 border-transparent bg-raised px-4 outline-none placeholder:text-muted focus:border-green"
            />
            <input
              aria-label="뜻"
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
              placeholder="뜻"
              maxLength={60}
              className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-raised px-4 outline-none placeholder:text-muted focus:border-green"
            />
            <IconButton label="약어 추가" type="submit" className="bg-primary text-on-primary active:bg-primary-press">
              <Plus className="size-6" />
            </IconButton>
          </form>
          <ul className="mt-4 divide-y divide-line rounded-2xl border border-card-border bg-card">
            {Object.entries(dict).map(([a, m]) => (
              <li key={a} className="flex items-center gap-4 pl-4">
                <span className="w-24 shrink-0 truncate font-semibold">{a}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{m}</span>
                <IconButton
                  label={`${a} 삭제`}
                  onClick={() => {
                    const next = { ...dict };
                    delete next[a];
                    update({ abbreviationDict: next });
                  }}
                >
                  <X className="size-5 text-muted" />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex justify-end">
            <Button variant="ghost" onClick={() => update({ abbreviationDict: DEFAULT_DICT }).then(() => toast("기본 사전으로 되돌림"))}>
              기본값
            </Button>
          </div>
        </Section>

        <Section title="자동 삭제">
          <ul className="flex flex-col gap-1 text-sm text-muted">
            <li>· 인계 메모·할 일: 근무 종료 12시간 뒤</li>
            <li>· 기록 문장: 복사 24시간 뒤 (복사 안 한 기록은 근무 종료 24시간 뒤)</li>
            <li>· 인계(EMR용·말로 인계): 근무 종료 24시간 뒤</li>
            <li>· 뺀(숨긴) 환자의 메모·할 일도 같은 규칙으로 지워져요</li>
            <li>· 듀티 캘린더와 날짜 일정은 지우지 않아요</li>
            <li>· 앱을 열 때와 1시간마다 확인해요</li>
          </ul>
        </Section>

        <Section title="보안">
          <div className="flex flex-col gap-2">
            <Button variant="secondary" full icon={<Lock className="size-5" />} onClick={lock}>
              지금 잠금
            </Button>
            <Button variant="danger" full icon={<Trash2 className="size-5" />} onClick={() => setWipe(true)}>
              전체 삭제
            </Button>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={wipe}
        title="모든 데이터를 지울까요?"
        message="근무·기록·인계·듀티 캘린더·PIN이 모두 삭제돼요"
        confirmLabel="전체 삭제"
        danger
        onClose={() => setWipe(false)}
        onConfirm={async () => {
          await wipeAll();
          location.replace("/");
        }}
      />
    </>
  );
}

function DutyTimes() {
  const { settings, update } = useSession();
  const t = settings.dutyTimes;
  const set = (d: Duty, k: "start" | "end", v: string) => v && update({ dutyTimes: { ...t, [d]: { ...t[d], [k]: v } } });
  return (
    <>
      <div className="flex flex-col gap-2">
        {(["D", "E", "N"] as const).map((d) => (
          <div key={d} className="flex items-center gap-2">
            <DutyTag duty={d} className="w-10 leading-8" />
            <input
              type="time"
              aria-label={`${d} 시작`}
              value={t[d].start}
              onChange={(e) => set(d, "start", e.target.value)}
              className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-raised px-3 tabular-nums outline-none focus:border-green"
            />
            <span aria-hidden className="text-muted">
              –
            </span>
            <input
              type="time"
              aria-label={`${d} 종료`}
              value={t[d].end}
              onChange={(e) => set(d, "end", e.target.value)}
              className="h-12 min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-raised px-3 tabular-nums outline-none focus:border-green"
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-sm text-muted">진행 중인 근무에는 시작할 때 시간이 쓰여요</p>
        <Button variant="ghost" className="-mr-4 shrink-0" onClick={() => update({ dutyTimes: DEFAULT_DUTY_TIMES }).then(() => toast("기본 시간으로 되돌림"))}>
          기본값
        </Button>
      </div>
    </>
  );
}
