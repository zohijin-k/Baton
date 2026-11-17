"use client";
/* 인계: 확정 기록 고르기 → 인계 초안(EMR용 / 말로 인계) → 확인 → 확정 → 복사 → 근무 종료 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Copy, CopyCheck, FilePenLine, FileText, LogOut, Play, RotateCcw, TriangleAlert } from "lucide-react";
import { db, uid } from "@/lib/db";
import { generate } from "@/lib/api";
import { hhmm, shortDate } from "@/lib/time";
import { compareIds, idLabel } from "@/lib/room";
import { composeHandover, emrAll, handoverBlocking, handoverRooms, MAX_VERBAL_LINES } from "@/lib/handover";
import { splitByNumbers } from "@/lib/numbers";
import { endShift, markCopied } from "@/lib/shift";
import { WARD_MEMO, type Handover, type HandoverMemo, type NurseRecord, type Shift, type Task } from "@/lib/types";
import { useSession } from "../session";
import { usePiiGuard } from "../PiiGuard";
import { useActiveShift } from "../useShift";
import { Button, IconButton } from "../ui/Button";
import { Card, StateLabel } from "../ui/Card";
import { WarnBadge } from "../ui/Chip";
import { CheckMark } from "../ui/CheckMark";
import { DutyTag } from "../ui/Duty";
import { copyText } from "../ui/copy";
import { ActionBar, Content, Empty, Header, OfflineBar, TabIcon } from "../ui/Layout";
import { Segmented } from "../ui/Segmented";
import { ConfirmDialog, toast } from "../ui/Overlay";

type View = "emr" | "verbal";

export function HandoffTab({ headerRight, goRecord, goTasks }: { headerRight: ReactNode; goRecord: () => void; goTasks: () => void }) {
  const shift = useActiveShift();
  const { online } = useSession();
  // 근무를 끝낸 뒤에도 자동 삭제 전까지는 마지막 인계를 다시 볼 수 있게
  const last = useLiveQuery(async () => {
    const ended = (await db.shifts.where("status").equals("ended").toArray()).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
    if (!ended) return null;
    const h = (await db.handovers.where("shiftId").equals(ended.id).sortBy("createdAt")).filter((x) => x.status === "confirmed").at(-1);
    return h ? { shift: ended, handover: h } : null;
  }, []);

  const title = shift ? (
    <span className="inline-flex items-center gap-2">
      인계 <DutyTag duty={shift.duty} className="text-base" />
    </span>
  ) : (
    "인계"
  );

  let body: ReactNode = null;
  if (shift) body = <ShiftHandoff shift={shift} goRecord={goRecord} />;
  else if (shift === null && last)
    body = (
      <>
        <p className="mx-auto max-w-[480px] px-6 text-sm text-muted">
          지난 근무 · {shortDate(last.shift.date)} {last.shift.duty} · 종료 {hhmm(last.shift.endedAt ?? last.shift.endAt)}
        </p>
        <ResultView handover={last.handover} />
      </>
    );
  else if (shift === null)
    body = (
      <>
        <Empty icon={<FileText className="size-12" strokeWidth={1.8} />} title="근무 중이 아니에요" text="근무를 시작하고 기록을 확정하면 인계를 만들 수 있어요" />
        <ActionBar>
          <Button size="lg" full icon={<Play className="size-5" />} onClick={goTasks}>
            근무 시작
          </Button>
        </ActionBar>
      </>
    );

  return (
    <>
      <Header icon={<TabIcon tab="handoff" />} title={title} right={headerRight} />
      {!online && <OfflineBar />}
      {body}
    </>
  );
}

function ShiftHandoff({ shift, goRecord }: { shift: Shift; goRecord: () => void }) {
  const latest = useLiveQuery(async () => (await db.handovers.where("shiftId").equals(shift.id).sortBy("createdAt")).at(-1) ?? null, [shift.id], undefined);
  const [newFor, setNewFor] = useState<string | null>(null);
  if (latest === undefined) return null;
  if (latest?.status === "draft") return <DraftView key={latest.id} handover={latest} />;
  if (latest?.status === "confirmed" && newFor !== latest.id) return <ResultView handover={latest} shift={shift} onNew={() => setNewFor(latest.id)} />;
  return <Summary shift={shift} goRecord={goRecord} />;
}

/* ───────────── 포함할 기록 고르기 ───────────── */

function Summary({ shift, goRecord }: { shift: Shift; goRecord: () => void }) {
  const { online } = useSession();
  const { guard, sheet } = usePiiGuard(shift.rooms);
  const records = useLiveQuery(
    () =>
      db.records
        .where("shiftId")
        .equals(shift.id)
        .filter((r) => r.status === "confirmed")
        .sortBy("confirmedAt"),
    [shift.id],
    [] as NurseRecord[],
  );
  const tasks = useLiveQuery(() => db.tasks.where("shiftId").equals(shift.id).toArray(), [shift.id], [] as Task[]);
  const memos = useLiveQuery(() => db.memos.where("shiftId").equals(shift.id).toArray(), [shift.id], [] as HandoverMemo[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [askUnassigned, setAskUnassigned] = useState(false);
  // '환자 미지정' 할 일 (숨긴 환자 제외 · 끝낸 것 제외): 인계에 들어가지 않으므로 만들기 전에 확인
  const unassigned = tasks.filter((t) => t.room === WARD_MEMO && !t.done).length;
  // 기본값: 이번 근무 전체. 뺀 기록만 기억하므로 새로 확정된 기록도 자동으로 포함됨
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const selected = records.filter((r) => !excluded.has(r.id));
  const allOn = selected.length === records.length;

  const plan = useMemo(() => handoverRooms({ shift, records: selected, tasks, memos }), [shift, selected, tasks, memos]);
  const pendingCount = plan.reduce((n, p) => n + p.pending.length, 0);
  const warnCount = plan.reduce((n, p) => n + p.warnings.length, 0);
  const groups = useMemo(() => {
    const m = new Map<string, NurseRecord[]>();
    for (const r of records) m.set(r.room, [...(m.get(r.room) ?? []), r]);
    return [...m.entries()].sort((a, b) => compareIds(a[0], b[0]));
  }, [records]);

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const needsAi = selected.length > 0;

  const make = () => {
    setError(null);
    const withRecs = plan.filter((p) => p.records.length);
    const save = (ai: Map<string, { emr: string; verbal: string[] }>) => db.handovers.add(composeHandover(uid(), shift, plan, ai));
    if (!withRecs.length) {
      save(new Map());
      return;
    }
    // 선택한 기록 문장만 비식별 검사 → 환자마다 임시 가명으로 전송 (호실-병상은 보내지 않음)
    guard(
      withRecs.flatMap((p) => p.records.map((r) => r.finalText)),
      async (clean) => {
        let i = 0;
        const patients = withRecs.map((p, k) => ({
          alias: `환자${k + 1}`,
          records: p.records.map((r) => ({ time: hhmm(r.confirmedAt ?? r.createdAt), text: clean[i++]?.trim() || "-" })),
        }));
        setBusy(true);
        try {
          const res = await generate({ kind: "handover", patients });
          const byAlias = new Map(res.data.patients.map((p) => [p.alias, p]));
          await save(new Map(withRecs.map((p, k) => [p.room, byAlias.get(`환자${k + 1}`) ?? { emr: "", verbal: [] }])));
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      },
    );
  };

  const endButton = (
    <div className="mt-8 flex justify-center">
      <Button variant="ghost" icon={<LogOut className="size-5" />} onClick={() => setEnding(true)}>
        인계 없이 근무 종료
      </Button>
    </div>
  );

  if (!records.length && !plan.length)
    return (
      <>
        <Empty icon={<FileText className="size-12" strokeWidth={1.8} />} title="아직 넘길 내용이 없어요" text="기록을 확정하면 여기에 모여요">
          {endButton}
        </Empty>
        <ActionBar>
          <Button size="lg" full icon={<FilePenLine className="size-5" />} onClick={goRecord}>
            기록하기
          </Button>
        </ActionBar>
        <EndShiftDialog shift={shift} open={ending} onClose={() => setEnding(false)} />
      </>
    );

  return (
    <Content>
      {(pendingCount > 0 || warnCount > 0) && (
        <div className="mb-4 rounded-2xl bg-raised p-4 text-sm">
          <p className="font-semibold">자동으로 들어가요</p>
          <p className="mt-1 text-muted">
            {[pendingCount && `미완료 할 일 ${pendingCount}건`, warnCount && `경고 ${warnCount}건`].filter(Boolean).join(" · ")}
          </p>
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          확정 기록 {selected.length}/{records.length}건 포함
        </p>
        {records.length > 0 && (
          <Button variant="ghost" className="-mr-4" onClick={() => setExcluded(allOn ? new Set(records.map((r) => r.id)) : new Set())}>
            {allOn ? "전체 해제" : "전체 선택"}
          </Button>
        )}
      </div>
      {records.length === 0 && <p className="text-sm text-muted">확정한 기록이 없어요. 미완료 할 일과 경고만 넘겨요</p>}
      <div className="flex flex-col gap-4">
        {groups.map(([room, rs]) => (
          <Card key={room} className="!px-2 !pb-2">
            <p className="px-2 font-semibold tabular-nums">{idLabel(room)}</p>
            <ul className="mt-2 flex flex-col">
              {rs.map((r) => {
                const on = !excluded.has(r.id);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(r.id)}
                      className={`flex min-h-12 w-full items-start gap-2 rounded-xl px-2 py-2 text-left active:bg-raised ${on ? "" : "text-muted"}`}
                    >
                      <span className="pr-2">
                        <CheckMark checked={on} />
                      </span>
                      <span className="shrink-0 pt-0.5 text-sm text-muted tabular-nums">{hhmm(r.confirmedAt!)}</span>
                      <span className="line-clamp-2 pt-0.5">{r.finalText}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      {error && (
        <p className="mt-4 flex items-center gap-2 text-warn" role="alert">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {endButton}
      <ActionBar>
        <Button
          size="lg"
          full
          loading={busy}
          disabled={(needsAi && !online) || !plan.length}
          icon={<FileText className="size-5" />}
          onClick={() => (unassigned ? setAskUnassigned(true) : make())}
        >
          {needsAi && !online ? "연결 필요" : "인계 만들기"}
        </Button>
      </ActionBar>
      <ConfirmDialog
        open={askUnassigned}
        title={`환자 미지정 할 일이 ${unassigned}건 있어요`}
        message="환자를 지정하지 않은 할 일은 인계에 들어가지 않아요. 할 일 탭에서 환자를 지정할 수 있어요."
        confirmLabel="그래도 만들기"
        onClose={() => setAskUnassigned(false)}
        onConfirm={() => {
          setAskUnassigned(false);
          make();
        }}
      />
      <EndShiftDialog shift={shift} open={ending} onClose={() => setEnding(false)} />
      {sheet}
    </Content>
  );
}

/* ───────────── EMR용 / 말로 인계 탭 ───────────── */

function useView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("baton-handoff-view") === "verbal" ? "verbal" : "emr";
    } catch {
      return "emr";
    }
  });
  return [
    view,
    (v) => {
      setView(v);
      try {
        localStorage.setItem("baton-handoff-view", v);
      } catch {}
    },
  ];
}

function ViewTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="sticky top-14 z-[5] -mx-6 bg-bg px-6 pb-4">
      <Segmented
        label="인계 형식"
        value={view}
        onChange={(v) => v && onChange(v)}
        options={[
          { value: "emr", label: "EMR용" },
          { value: "verbal", label: "말로 인계" },
        ]}
      />
    </div>
  );
}

function DraftView({ handover }: { handover: Handover }) {
  const [view, setView] = useView();
  const [emr, setEmr] = useState(handover.emrText);
  const [verbal, setVerbal] = useState(handover.verbalSummary);
  const [confirming, setConfirming] = useState(false);
  const [redo, setRedo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => db.handovers.update(handover.id, { emrText: emr, verbalSummary: verbal }), 400);
    return () => clearTimeout(t);
  }, [emr, verbal, handover.id]);

  const blocking = handoverBlocking({ emrText: emr, verbalSummary: verbal, sources: handover.sources, generated: handover.generated });

  const confirm = async () => {
    setConfirming(false);
    await db.handovers.update(handover.id, {
      emrText: emr.map((e) => ({ ...e, text: e.text.trim() })),
      verbalSummary: verbal.map((v) => ({ ...v, lines: v.lines.map((l) => l.trim()).filter(Boolean) })),
      status: "confirmed",
      confirmedAt: Date.now(),
    });
    toast("인계를 확정했어요");
  };

  return (
    <Content>
      <ViewTabs view={view} onChange={setView} />
      <div className="flex flex-col gap-4">
        {(view === "emr" ? emr : verbal).map((item, i) => {
          const room = item.room;
          const nums = blocking.get(room) ?? [];
          return (
            <Card key={room} state="draft">
              <StateLabel
                state="draft"
                right={
                  i === 0 ? (
                    <IconButton label="다시 만들기" className="-my-4 -mr-4" onClick={() => setRedo(true)}>
                      <RotateCcw className="size-5 text-muted" />
                    </IconButton>
                  ) : undefined
                }
              />
              <p className="mb-2 font-semibold tabular-nums">{idLabel(room)}</p>
              {view === "emr" ? (
                <AutoTextarea
                  id={`emr-${room}`}
                  label={`${idLabel(room)} EMR 문단`}
                  value={emr[i].text}
                  placeholder="EMR에 옮길 기록 없음"
                  onChange={(v) => setEmr((xs) => xs.map((x, j) => (j === i ? { ...x, text: v } : x)))}
                />
              ) : (
                <VerbalEditor item={verbal[i]} onChange={(lines) => setVerbal((xs) => xs.map((x, j) => (j === i ? { ...x, lines } : x)))} />
              )}
              {nums.length > 0 && (
                <div className="mt-2 rounded-xl bg-warn-soft p-3" role="alert">
                  <p className="flex items-center gap-2 text-sm font-semibold text-warn">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    기록에 없는 숫자예요. 고치거나 지우세요
                  </p>
                  <p className="mt-1 text-sm">
                    {splitByNumbers([emr.find((e) => e.room === room)?.text ?? "", ...(verbal.find((v) => v.room === room)?.lines ?? [])].join(" / "), nums).map((p, k) =>
                      p.hit ? (
                        <mark key={k} className="rounded bg-sun-soft px-1 font-semibold text-on-sun-soft underline decoration-warn decoration-2 underline-offset-4">
                          {p.text}
                        </mark>
                      ) : (
                        <span key={k}>{p.text}</span>
                      ),
                    )}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      <ActionBar>
        <Button size="lg" full disabled={blocking.size > 0} icon={<Check className="size-5" />} onClick={() => setConfirming(true)}>
          확인
        </Button>
      </ActionBar>
      <ConfirmDialog
        open={confirming}
        title="인계를 확정할까요?"
        message="확정해야 복사할 수 있어요"
        confirmLabel="확정"
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
      />
      <ConfirmDialog
        open={redo}
        title="초안을 지울까요?"
        message="기록은 그대로 남아요"
        confirmLabel="삭제"
        danger
        onClose={() => setRedo(false)}
        onConfirm={async () => {
          setRedo(false);
          await db.handovers.delete(handover.id);
        }}
      />
    </Content>
  );
}

function AutoTextarea({ id, label, value, placeholder, onChange }: { id: string; label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="min-h-12 w-full resize-none rounded-xl bg-transparent outline-none placeholder:text-muted [field-sizing:content]"
      />
    </>
  );
}

function VerbalEditor({ item, onChange }: { item: Handover["verbalSummary"][number]; onChange: (lines: string[]) => void }) {
  return (
    <>
      <AutoTextarea
        id={`verbal-${item.room}`}
        label={`${idLabel(item.room)} 핵심 ${MAX_VERBAL_LINES}줄`}
        value={item.lines.join("\n")}
        placeholder={`핵심 ${MAX_VERBAL_LINES}줄 이내 (줄바꿈으로 구분)`}
        onChange={(v) => onChange(v.split("\n").slice(0, MAX_VERBAL_LINES))}
      />
      <VerbalExtras item={item} />
    </>
  );
}

function VerbalExtras({ item, big }: { item: Handover["verbalSummary"][number]; big?: boolean }) {
  return (
    <>
      {item.warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label="경고">
          {item.warnings.map((w) => (
            <WarnBadge key={w}>{w}</WarnBadge>
          ))}
        </div>
      )}
      {item.pending.length > 0 && (
        <div className="mt-2">
          <p className={`font-semibold text-warn ${big ? "" : "text-sm"}`}>미완료</p>
          <ul className={big ? "" : "text-sm"}>
            {item.pending.map((p) => (
              <li key={p} className="tabular-nums">
                · {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ───────────── 확정 결과 ───────────── */

/** shift가 있으면 진행 중인 근무(근무 종료 버튼), 없으면 지난 근무 보기 */
function ResultView({ handover, shift, onNew }: { handover: Handover; shift?: Shift; onNew?: () => void }) {
  const [view, setView] = useView();
  const [ending, setEnding] = useState(false);
  const leftover = useLiveQuery(
    () =>
      shift
        ? db.records
            .where("shiftId")
            .equals(shift.id)
            .filter((r) => r.status === "confirmed" && !handover.recordIds.includes(r.id))
            .count()
        : 0,
    [shift?.id, handover.recordIds],
    0,
  );

  /** EMR 문단을 복사하면 그 문단에 들어간 기록의 자동 삭제 타이머(24시간)가 시작된다 */
  const copyRooms = async (text: string, rooms: string[]) => {
    const ok = await copyText(text);
    if (!ok) return false;
    const ids = (await db.records.where("id").anyOf(handover.recordIds).toArray()).filter((r) => rooms.includes(r.room)).map((r) => r.id);
    await markCopied(ids);
    return true;
  };

  const withText = handover.emrText.filter((e) => e.text.trim());

  return (
    <Content action={!!shift}>
      <ViewTabs view={view} onChange={setView} />
      {view === "emr" ? (
        <>
          <CopyAll onCopy={() => copyRooms(emrAll(handover), withText.map((e) => e.room))} disabled={!withText.length} />
          <div className="mt-4 flex flex-col gap-4">
            {handover.emrText.map((e) => (
              <Card key={e.room} state="confirmed">
                <StateLabel state="confirmed" right={handover.confirmedAt ? hhmm(handover.confirmedAt) : undefined} />
                <p className="mb-2 font-semibold tabular-nums">{idLabel(e.room)}</p>
                {e.text.trim() ? <p className="whitespace-pre-wrap">{e.text}</p> : <p className="text-sm text-muted">EMR에 옮길 기록 없음</p>}
                {e.text.trim() && (
                  <div className="mt-2 -mb-2 flex justify-end">
                    <CopyButton label={`${idLabel(e.room)} 복사`} onCopy={() => copyRooms(e.text.trim(), [e.room])} />
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      ) : (
        // 말로 인계: 글자 크게(20px), 스크롤만으로 읽는 화면
        <div className="flex flex-col text-heading">
          {handover.verbalSummary.map((v) => (
            <section key={v.room} className="border-b border-line py-6 first:pt-2 last:border-b-0" aria-label={idLabel(v.room)}>
              <h2 className="font-semibold tabular-nums">{idLabel(v.room)}</h2>
              {v.lines.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {v.lines.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-muted">기록 없음</p>
              )}
              <VerbalExtras item={v} big />
            </section>
          ))}
        </div>
      )}
      {shift && onNew && view === "emr" && (
        <div className="mt-6 flex flex-col items-center gap-2">
          {leftover > 0 && <p className="text-sm text-muted">인계에 안 넣은 확정 기록 {leftover}건</p>}
          <Button variant="ghost" icon={<RotateCcw className="size-5" />} onClick={onNew}>
            새 인계
          </Button>
        </div>
      )}
      {shift && (
        <>
          <ActionBar>
            <Button size="lg" full icon={<LogOut className="size-5" />} onClick={() => setEnding(true)}>
              근무 종료
            </Button>
          </ActionBar>
          <EndShiftDialog shift={shift} open={ending} onClose={() => setEnding(false)} />
        </>
      )}
    </Content>
  );
}

function CopyAll({ onCopy, disabled }: { onCopy: () => Promise<boolean>; disabled?: boolean }) {
  const [copied, setCopied] = useCopied();
  return (
    <Button variant="secondary" full disabled={disabled} icon={copied ? <CopyCheck className="size-5" /> : <Copy className="size-5" />} onClick={async () => (await onCopy()) && setCopied(true)}>
      {copied ? "전체 복사됨 ✓" : "전체 복사"}
    </Button>
  );
}

function CopyButton({ label, onCopy }: { label: string; onCopy: () => Promise<boolean> }) {
  const [copied, setCopied] = useCopied();
  return (
    <Button variant="secondary" aria-label={label} icon={copied ? <Check className="size-5" /> : <Copy className="size-5" />} onClick={async () => (await onCopy()) && setCopied(true)}>
      {copied ? "복사됨 ✓" : "복사"}
    </Button>
  );
}

function useCopied(): [boolean, (v: boolean) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return [copied, setCopied];
}

function EndShiftDialog({ shift, open, onClose }: { shift: Shift; open: boolean; onClose: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      title="근무를 종료할까요?"
      message="인계 메모·할 일은 12시간, 기록은 24시간 뒤 자동으로 지워져요. 듀티 캘린더는 남아요."
      confirmLabel="종료"
      onClose={onClose}
      onConfirm={async () => {
        onClose();
        await endShift(shift.id);
        toast("근무를 종료했어요. 수고했어요");
      }}
    />
  );
}
