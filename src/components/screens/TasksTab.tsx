"use client";
/* 할 일 탭: 근무 시작 → 인계 메모 → 할 일 목록 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, ChevronDown, ListChecks, NotebookPen, Play, Plus, TriangleAlert, UserPlus, Users } from "lucide-react";
import { db } from "@/lib/db";
import { generate } from "@/lib/api";
import { addManualTask, addRooms, assignTask, buildList, removeRoom, replaceLeftovers, saveMemo, startShift, suggestedDuty, toggleTask, type AiTask } from "@/lib/shift";
import { dateKey, longDate, nowKey, shiftWindow, shortDate, startMinOf, timeSortKey, windowLabel } from "@/lib/time";
import { compareIds, idLabel } from "@/lib/room";
import { flagsOf, memoFlags, memoSource } from "@/lib/taskParser";
import { WARD_MEMO, isWorkDuty, type Duty, type HandoverMemo, type Role, type Scope, type Shift, type Task } from "@/lib/types";
import { useSession } from "../session";
import { usePiiGuard } from "../PiiGuard";
import { useActiveShift, useNextDuty, useNow } from "../useShift";
import { RoomChips, RoomKeypad } from "../RoomPicker";
import { Button, IconButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip, WarnBadge } from "../ui/Chip";
import { CheckMark } from "../ui/CheckMark";
import { DUTY_CLASS, DutyTag, ROLE_LABEL } from "../ui/Duty";
import { ActionBar, Content, Field, FullScreen, Header, OfflineBar, TabIcon } from "../ui/Layout";
import { Segmented } from "../ui/Segmented";
import { ConfirmDialog, Sheet, toast } from "../ui/Overlay";

type Guard = ReturnType<typeof usePiiGuard>["guard"];

export function TasksTab({ headerRight }: { headerRight: ReactNode }) {
  const shift = useActiveShift();
  const [editMemo, setEditMemo] = useState(false);
  // 비식별 시트는 메모 화면이 목록으로 바뀐 뒤에도 남아 있어야 하므로 탭 단위로 둔다
  const { guard, sheet } = usePiiGuard(shift?.rooms ?? []);

  let body: ReactNode;
  if (shift === undefined) body = <Header icon={<TabIcon tab="tasks" />} title="할 일" right={headerRight} />;
  else if (!shift) body = <StartScreen headerRight={headerRight} />;
  else if (!shift.listAt || editMemo)
    body = <MemoScreen key={shift.id} shift={shift} guard={guard} headerRight={headerRight} onBack={shift.listAt ? () => setEditMemo(false) : undefined} onBuilt={() => setEditMemo(false)} />;
  else body = <TaskListScreen shift={shift} headerRight={headerRight} onEditMemo={() => setEditMemo(true)} />;

  return (
    <>
      {body}
      {sheet}
    </>
  );
}

/* ───────────── 근무 시작 ───────────── */

function StartScreen({ headerRight }: { headerRight: ReactNode }) {
  const { settings } = useSession();
  const [setup, setSetup] = useState(false);
  const [today] = useState(() => dateKey(Date.now()));
  const todayDuty = useLiveQuery(() => db.duty.get(today), [today]);
  const next = useNextDuty(today);
  const d = todayDuty?.duty;

  return (
    <>
      <Header icon={<TabIcon tab="tasks" />} title="할 일" right={headerRight} />
      <div className="mx-auto flex min-h-[calc(100dvh-56px-var(--spacing-tabbar)-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-w-[480px] flex-col justify-center px-6 pb-16">
        <p className="text-center text-sm text-muted">{longDate(today)}</p>
        <p className="mt-2 flex items-center justify-center gap-2 text-heading font-semibold">
          {isWorkDuty(d) ? (
            <>
              <span>오늘</span>
              <DutyTag duty={d} className="text-heading" />
              <span className="tabular-nums">{windowLabel(settings.dutyTimes[d])}</span>
            </>
          ) : d ? (
            `오늘은 ${d}`
          ) : (
            "오늘 듀티가 비어 있어요"
          )}
        </p>
        <Button size="lg" full className="mt-8 !h-20 rounded-3xl text-heading" icon={<Play className="size-6" />} onClick={() => setSetup(true)}>
          근무 시작
        </Button>
        <p className="mt-4 text-center text-sm text-muted">{next ? `다음 근무 · ${shortDate(next.date)} ${next.duty}` : "듀티 탭에 근무표를 넣으면 자동으로 골라요"}</p>
      </div>
      {setup && <StartSetup onClose={() => setSetup(false)} />}
    </>
  );
}

const ROLE_OPTIONS = [
  { value: "acting" as const, label: "액팅" },
  { value: "charge" as const, label: "차지" },
  { value: "none" as const, label: "선택 안 함" },
];

function StartSetup({ onClose }: { onClose: () => void }) {
  const { settings } = useSession();
  const [duty, setDuty] = useState<Duty | null>(null);
  const [fromCalendar, setFromCalendar] = useState(false);
  const [role, setRole] = useState<"acting" | "charge" | "none">("none");
  const [scope, setScope] = useState<Scope>("assigned");
  const [rooms, setRooms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // 오늘 날짜의 듀티를 캘린더에서 자동 선택
  useEffect(() => {
    suggestedDuty(settings.dutyTimes).then((s) => {
      if (!s) return;
      setDuty((cur) => cur ?? s.duty);
      setFromCalendar(true);
    });
  }, [settings.dutyTimes]);

  const canStart = !!duty && (scope === "ward" || rooms.length > 0);
  const start = async () => {
    if (!duty) return;
    setBusy(true);
    await startShift({ duty, times: settings.dutyTimes[duty], scope, role: role === "none" ? null : (role as Role), rooms: scope === "assigned" ? rooms : [] });
    onClose();
  };

  return (
    <FullScreen>
      <Header
        title="근무 시작"
        left={
          <IconButton label="뒤로" onClick={onClose}>
            <ArrowLeft className="size-6" />
          </IconButton>
        }
      />
      <Content tabs={false}>
        <Field
          label="듀티"
          id="f-duty"
          hint={duty ? `${windowLabel(settings.dutyTimes[duty])}${fromCalendar ? " · 듀티표에서 가져왔어요" : ""}` : "오늘 듀티가 없어요. 골라 주세요"}
        >
          <Segmented
            label="듀티"
            value={duty}
            onChange={(v) => v && setDuty(v)}
            options={(["D", "E", "N"] as const).map((k) => ({ value: k, label: k, onClass: DUTY_CLASS[k] }))}
          />
        </Field>
        <Field
          label="담당"
          id="f-scope"
          hint={scope === "ward" ? "인계 메모에 적은 호실-병상이 자동으로 목록에 추가돼요" : undefined}
        >
          <Segmented
            label="담당 방식"
            value={scope}
            onChange={(v) => v && setScope(v)}
            options={[
              { value: "assigned", label: "담당 환자 지정" },
              { value: "ward", label: "병동 전체" },
            ]}
          />
        </Field>
        {scope === "assigned" && (
          <div className="flex flex-col gap-4">
            <RoomKeypad existing={rooms} onAdd={(ids) => setRooms((r) => [...r, ...ids].sort(compareIds))} />
            <RoomChips ids={rooms} onRemove={(id) => setRooms((r) => r.filter((x) => x !== id))} empty="추가한 환자가 여기에 칩으로 보여요" />
          </div>
        )}
        <Field label="역할 (선택)" id="f-role" hint="지금은 표시만 해요">
          <Segmented label="역할" value={role} onChange={(v) => v && setRole(v)} options={ROLE_OPTIONS} />
        </Field>
      </Content>
      <ActionBar overTabs={false}>
        <Button size="lg" full loading={busy} disabled={!canStart} icon={<NotebookPen className="size-5" />} onClick={start}>
          인계 받기 시작
        </Button>
      </ActionBar>
    </FullScreen>
  );
}

/* ───────────── 근무 정보 줄 (상단 고정) ───────────── */

function ShiftBar({ shift, flags, onPatients }: { shift: Shift; flags?: Map<string, string[]>; onPatients: () => void }) {
  const next = useNextDuty(shift.date);
  const w = shiftWindow(shift);
  const flagList = flags ? [...flags.entries()].sort((a, b) => compareIds(a[0], b[0])) : [];
  return (
    <div className="sticky top-14 z-[5] -mx-6 bg-bg px-6 pb-2">
      <div className="flex min-h-12 items-center gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 font-semibold">
          <DutyTag duty={shift.duty} />
          <span className="tabular-nums">· {windowLabel(w)}</span>
          {shift.role && <span className="rounded-lg bg-raised px-2 text-sm font-medium">{ROLE_LABEL[shift.role]}</span>}
        </p>
        <button type="button" onClick={onPatients} className="-mr-2 inline-flex min-h-12 shrink-0 items-center gap-1 px-2 font-medium text-green">
          <Users className="size-5" aria-hidden />
          환자 {shift.rooms.length}
        </button>
      </div>
      <p className="text-sm text-muted">
        {shift.scope === "ward" ? "병동 전체" : "담당 지정"} · {next ? `다음 근무 ${shortDate(next.date)} ${next.duty}` : "다음 근무 미입력"}
      </p>
      {flagList.length > 0 && (
        <div className="no-scrollbar -mx-6 mt-2 flex gap-2 overflow-x-auto px-6" aria-label="경고">
          {flagList.map(([room, labels]) => (
            <WarnBadge key={room}>
              <span className="tabular-nums">{idLabel(room)}</span> {labels.join("·")}
            </WarnBadge>
          ))}
        </div>
      )}
    </div>
  );
}

/** 근무 중 환자 추가·제외 */
export function PatientsSheet({ shift, open, onClose }: { shift: Shift; open: boolean; onClose: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const pending = useLiveQuery(
    () => (removing ? db.tasks.where("shiftId").equals(shift.id).filter((t) => t.room === removing && !t.done).count() : 0),
    [shift.id, removing],
    0,
  );
  return (
    <>
      <Sheet open={open} onClose={onClose} title="담당 환자">
        <RoomChips ids={shift.rooms} onRemove={setRemoving} empty={shift.scope === "ward" ? "메모에서 언급하면 자동으로 추가돼요" : "아직 없어요"} />
        <div className="mt-4">
          <RoomKeypad
            existing={shift.rooms}
            onAdd={async (ids) => {
              await addRooms(shift.id, ids);
              toast(`${ids.map(idLabel).join(", ")} 추가`);
            }}
          />
        </div>
      </Sheet>
      <ConfirmDialog
        open={!!removing}
        title={`${removing ? idLabel(removing) : ""}을(를) 뺄까요?`}
        message={`${pending ? `미완료 할 일 ${pending}건이 있어요. ` : ""}메모·할 일은 지우지 않고 숨겨요. 할 일 탭 아래 ‘제외한 환자’에서 다시 추가할 수 있어요.`}
        confirmLabel="빼기"
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          const id = removing!;
          setRemoving(null);
          await removeRoom(shift.id, id);
          toast(`${idLabel(id)} 뺐어요 · 할 일 탭 아래에서 다시 추가`);
        }}
      />
    </>
  );
}

/* ───────────── 인계 메모 ───────────── */

const QUICK = ["NPO", "낙상", "재측정", "abx", "드레싱", "보호자", "검사", "알레르기"];

function MemoScreen({
  shift,
  guard,
  headerRight,
  onBack,
  onBuilt,
}: {
  shift: Shift;
  guard: Guard;
  headerRight: ReactNode;
  onBack?: () => void;
  onBuilt: () => void;
}) {
  const { online } = useSession();
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const latest = useRef<Record<string, string>>({});
  const dirty = useRef(new Set<string>());
  const areas = useRef(new Map<string, HTMLTextAreaElement>());
  const [focused, setFocused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [patientsOpen, setPatientsOpen] = useState(false);

  useEffect(() => {
    db.memos
      .where("shiftId")
      .equals(shift.id)
      .toArray()
      .then((ms) => {
        latest.current = Object.fromEntries(ms.map((m) => [m.room, m.text]));
        setTexts(latest.current);
      });
  }, [shift.id]);

  const flush = useMemo(
    () => async () => {
      const rooms = [...dirty.current];
      dirty.current.clear();
      await Promise.all(rooms.map((r) => saveMemo(shift.id, r, latest.current[r] ?? "")));
    },
    [shift.id],
  );

  // 입력 즉시 자동 저장 (0.3초 묶어서), 화면을 떠날 때도 저장
  useEffect(() => {
    if (!texts) return;
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
  }, [texts, flush]);
  useEffect(() => () => void flush(), [flush]);

  const change = (room: string, v: string) => {
    latest.current = { ...latest.current, [room]: v };
    dirty.current.add(room);
    setTexts(latest.current);
  };

  const insert = (room: string, word: string) => {
    const el = areas.current.get(room);
    const cur = latest.current[room] ?? "";
    const at = el?.selectionStart ?? cur.length;
    const before = cur.slice(0, at);
    const after = cur.slice(at);
    const lead = before && !/[\s,]$/.test(before) ? " " : "";
    const next = `${before}${lead}${word} ${after.replace(/^ /, "")}`;
    change(room, next);
    const pos = before.length + lead.length + word.length + 1;
    requestAnimationFrame(() => el?.setSelectionRange(pos, pos));
  };

  const rows = shift.scope === "ward" ? [WARD_MEMO, ...shift.rooms] : shift.rooms;
  const hasText = rows.some((r) => (texts?.[r] ?? "").trim());

  const build = async () => {
    setBusy(true);
    try {
      await flush();
      const w = shiftWindow(shift);
      const { count, leftovers, added } = await buildList(shift.id, w);
      toast(added.length ? `할 일 ${count}개 · 환자 ${added.length}명 추가` : `할 일 ${count}개를 만들었어요`);
      onBuilt();
      if (!leftovers.length || !online) return;
      // 규칙으로 못 푼 조각만, 비식별 검사 후 임시 가명으로 AI에 보냄 (호실-병상은 보내지 않음)
      guard(
        leftovers.map((l) => l.text),
        async (clean) => {
          const items = leftovers.map((l, i) => ({ alias: `환자${i + 1}`, text: clean[i]?.trim() ?? "", l })).filter((x) => x.text);
          if (!items.length) return;
          try {
            const res = await generate({ kind: "tasks", window: `${w.start}-${w.end}`, items: items.map(({ alias, text }) => ({ alias, text })) });
            const byAlias = new Map(items.map((x) => [x.alias, x.l]));
            const next: AiTask[] = res.data.tasks
              .filter((t) => byAlias.has(t.alias) && t.text.trim())
              .map((t) => {
                const l = byAlias.get(t.alias)!;
                return {
                  room: l.room,
                  memoRef: l.memoRef,
                  time: t.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time) ? t.time : null,
                  text: t.text.trim(),
                  tag: t.tag === "warning" || flagsOf(t.text).length ? "warning" : "normal",
                  needsReview: t.uncertain,
                };
              });
            await replaceLeftovers(shift.id, leftovers.map((l) => l.taskId), next);
          } catch {
            /* 실패하면 원문 그대로 '확인 필요'로 둔다 */
          }
        },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        icon={onBack ? undefined : <TabIcon tab="tasks" />}
        title="인계 메모"
        left={
          onBack && (
            <IconButton label="할 일로" onClick={onBack}>
              <ArrowLeft className="size-6" />
            </IconButton>
          )
        }
        right={headerRight}
      />
      {!online && <OfflineBar />}
      <Content>
        <ShiftBar shift={shift} onPatients={() => setPatientsOpen(true)} />
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">담당 환자가 없어요. 위의 ‘환자’를 눌러 추가하세요</p>
        )}
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((room) => (
            <li key={room}>
              <div className={`flex gap-2 rounded-card border bg-card px-4 transition ${focused === room ? "border-green" : "border-card-border"}`}>
                <label htmlFor={`memo-${room}`} className="w-[4.5rem] shrink-0 py-3 font-semibold tabular-nums">
                  {idLabel(room)}
                </label>
                <textarea
                  id={`memo-${room}`}
                  ref={(el) => {
                    if (el) areas.current.set(room, el);
                    else areas.current.delete(room);
                  }}
                  rows={1}
                  value={texts?.[room] ?? ""}
                  disabled={!texts}
                  onChange={(e) => change(room, e.target.value)}
                  onFocus={() => setFocused(room)}
                  onBlur={() => setFocused((f) => (f === room ? null : f))}
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder={room === WARD_MEMO ? "예: 501-1 20시 abx, 502-2 NPO" : "메모"}
                  className="min-h-12 min-w-0 flex-1 resize-none bg-transparent py-3 outline-none placeholder:text-muted [field-sizing:content]" data-ring="border"
                />
              </div>
              {room === WARD_MEMO && focused !== room && <p className="mt-1 px-1 text-sm text-muted">호실-병상을 같이 적으면 환자별로 나눠요</p>}
              {focused === room && (
                <div className="no-scrollbar -mx-6 mt-2 flex gap-2 overflow-x-auto px-6" aria-label="빠른 입력">
                  {QUICK.map((q) => (
                    <Chip key={q} onPointerDown={(e) => e.preventDefault()} onClick={() => insert(room, q)}>
                      {q}
                    </Chip>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Content>
      <ActionBar>
        <Button size="lg" full loading={busy} disabled={!texts || !hasText} icon={<ListChecks className="size-5" />} onClick={build}>
          {onBack ? "리스트 다시 만들기" : "리스트 만들기"}
        </Button>
      </ActionBar>
      <PatientsSheet shift={shift} open={patientsOpen} onClose={() => setPatientsOpen(false)} />
    </>
  );
}

/* ───────────── 할 일 목록 ───────────── */

type View = "time" | "room";

function TaskListScreen({ shift, headerRight, onEditMemo }: { shift: Shift; headerRight: ReactNode; onEditMemo: () => void }) {
  const tasks = useLiveQuery(() => db.tasks.where("shiftId").equals(shift.id).toArray(), [shift.id], [] as Task[]);
  const memos = useLiveQuery(() => db.memos.where("shiftId").equals(shift.id).toArray(), [shift.id], [] as HandoverMemo[]);
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem("baton-task-view") === "room" ? "room" : "time";
    } catch {
      return "time";
    }
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [patientsOpen, setPatientsOpen] = useState(false);
  const [assigning, setAssigning] = useState<Task | null>(null);
  const now = useNow();

  const start = startMinOf(shift);
  // 뺀 환자의 할 일은 숨김 (지우지 않음)
  const visible = useMemo(() => tasks.filter((t) => !shift.excluded.includes(t.room)), [tasks, shift.excluded]);
  const all = useMemo(() => sortTasks(visible, start), [visible, start]);
  const unassigned = all.filter((t) => t.room === WARD_MEMO);
  const sorted = all.filter((t) => t.room !== WARD_MEMO);
  const nk = nowKey(shift, now);
  const nextId = all.find((t) => !t.done && t.time && timeSortKey(t.time, start) >= nk)?.id;
  const flags = useMemo(() => memoFlags(memos, shift.excluded), [memos, shift.excluded]);
  const memoById = useMemo(() => new Map(memos.map((m) => [m.id, m])), [memos]);
  const remaining = visible.filter((t) => !t.done).length;

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("baton-task-view", v);
    } catch {}
  };

  const row = (t: Task, showRoom: boolean, trailing?: ReactNode) => (
    <li key={t.id}>
      <TaskRow
        task={t}
        isNext={t.id === nextId}
        showRoom={showRoom}
        open={openId === t.id}
        source={t.memoRef ? memoSource(memoById.get(t.memoRef), t.assignedFrom ?? t.room) : null}
        onOpen={() => setOpenId((x) => (x === t.id ? null : t.id))}
        trailing={trailing}
      />
    </li>
  );

  // 호실별: 담당 순서 + 목록에 없지만 할 일이 남은 환자 (환자 미지정은 맨 위 묶음으로 따로)
  const groups = useMemo(() => {
    const rooms = [...new Set([...shift.rooms, ...sorted.map((t) => t.room)])].sort(compareIds);
    return rooms.map((room) => ({ room, items: sorted.filter((t) => t.room === room) }));
  }, [shift.rooms, sorted]);

  const assign = async (task: Task, room: string) => {
    setAssigning(null);
    await assignTask(shift.id, task.id, room);
    toast(`${idLabel(room)}(으)로 옮겼어요`);
    // 그 환자로 이동: 호실별 보기에서 해당 묶음으로 스크롤
    changeView("room");
    setTimeout(() => document.getElementById(`tasks-${room}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  return (
    <>
      <Header icon={<TabIcon tab="tasks" />} title="할 일" right={headerRight} />
      <Content>
        <ShiftBar shift={shift} flags={flags} onPatients={() => setPatientsOpen(true)} />
        <div className="mt-2 flex items-center gap-2">
          <Segmented
            className="flex-1"
            label="보기"
            value={view}
            onChange={(v) => v && changeView(v)}
            options={[
              { value: "time", label: "시간순" },
              { value: "room", label: "호실별" },
            ]}
          />
          <Button variant="secondary" icon={<NotebookPen className="size-5" />} onClick={onEditMemo}>
            메모
          </Button>
        </div>
        <p className="mt-4 mb-2 text-sm text-muted" aria-live="polite">
          {visible.length === 0 ? "메모에서 할 일을 찾지 못했어요" : remaining ? `남은 할 일 ${remaining}개` : "모두 끝났어요"}
        </p>

        {unassigned.length > 0 && (
          <section aria-labelledby="unassigned-title" className="mb-6 rounded-card border border-warn/40 bg-warn-soft p-3">
            <h2 id="unassigned-title" className="flex items-center gap-2 px-1 font-semibold text-warn">
              <TriangleAlert className="size-5" aria-hidden />
              환자 미지정 <span className="tabular-nums">{unassigned.length}</span>
            </h2>
            <p className="mt-1 mb-3 px-1 text-sm text-ink">호실-병상을 못 찾은 메모예요. 환자를 지정하면 그 환자로 옮겨요</p>
            <ul className="flex flex-col gap-2">
              {unassigned.map((t) =>
                row(
                  t,
                  false,
                  <Button variant="secondary" className="m-2 shrink-0 !px-3 text-sm" icon={<UserPlus className="size-4" aria-hidden />} onClick={() => setAssigning(t)}>
                    환자 지정
                  </Button>,
                ),
              )}
            </ul>
          </section>
        )}

        {view === "time" ? (
          <ul className="flex flex-col gap-2">{sorted.map((t) => row(t, true))}</ul>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map(({ room, items }) => (
              <section key={room} id={`tasks-${room}`} aria-label={idLabel(room)} className="scroll-mt-44">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold tabular-nums">{idLabel(room)}</h2>
                  {(flags.get(room) ?? []).map((f) => (
                    <WarnBadge key={f}>{f}</WarnBadge>
                  ))}
                </div>
                <ul className="flex flex-col gap-2">
                  {items.map((t) => row(t, false))}
                  {items.length === 0 && <li className="text-sm text-muted">할 일 없음</li>}
                </ul>
              </section>
            ))}
          </div>
        )}

        {shift.excluded.length > 0 && <ExcludedPatients shift={shift} tasks={tasks} />}
      </Content>
      <ActionBar>
        <Button size="lg" full icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>
          할 일 추가
        </Button>
      </ActionBar>
      <Sheet open={!!assigning} onClose={() => setAssigning(null)} title="환자 지정">
        {assigning && <AssignForm key={assigning.id} task={assigning} rooms={shift.rooms} onPick={(room) => assign(assigning, room)} />}
      </Sheet>
      <Sheet open={adding} onClose={() => setAdding(false)} title="할 일 추가">
        <AddTaskForm shift={shift} onDone={() => setAdding(false)} />
      </Sheet>
      <PatientsSheet shift={shift} open={patientsOpen} onClose={() => setPatientsOpen(false)} />
    </>
  );
}

/** 남은 할 일(시각 있는 것 → 근무 시작 기준 순서, 시각 없는 것) → 끝난 할 일(끝낸 순서) */
function sortTasks(tasks: Task[], start: number) {
  return [...tasks].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.done && b.done ? (a.doneAt ?? 0) - (b.doneAt ?? 0) : 0) ||
      timeSortKey(a.time, start) - timeSortKey(b.time, start) ||
      Number(b.tag === "warning") - Number(a.tag === "warning") ||
      compareIds(a.room, b.room) ||
      a.createdAt - b.createdAt,
  );
}

function TaskRow({
  task,
  isNext,
  showRoom,
  open,
  source,
  onOpen,
  trailing,
}: {
  task: Task;
  isNext: boolean;
  showRoom: boolean;
  open: boolean;
  source: string | null;
  onOpen: () => void;
  /** 오른쪽 동작 버튼 (환자 지정 등) */
  trailing?: ReactNode;
}) {
  const done = task.done;
  return (
    <Card state={isNext ? "now" : "plain"} className={`flex items-start !p-0 transition ${done ? "!bg-bg" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${showRoom ? idLabel(task.room) : ""} ${task.time ?? ""} ${task.text} ${done ? "완료 취소" : "완료"}`}
        onClick={() => toggleTask(task)}
        className="flex size-14 shrink-0 items-center justify-center"
      >
        <CheckMark checked={done} />
      </button>
      <button type="button" aria-expanded={open} onClick={onOpen} className="min-w-0 flex-1 py-3 pr-4 text-left">
        <p className={done ? "text-muted line-through" : ""}>
          {showRoom && <span className="mr-1 font-semibold tabular-nums">{idLabel(task.room)}</span>}
          {showRoom && " "}
          {task.time && <span className="mr-1 font-semibold tabular-nums">{task.time}</span>}
          {task.time && " "}
          {task.text}
        </p>
        {!done && (task.needsReview || task.tag === "warning" || isNext) && (
          <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {isNext && <span className="font-semibold">다음 할 일</span>}
            {task.needsReview && <span className="rounded-md border border-current px-1.5 text-xs font-semibold">확인 필요</span>}
            {task.tag === "warning" && (
              <span className={`inline-flex items-center gap-1 font-semibold ${isNext ? "" : "text-warn"}`}>
                <TriangleAlert className="size-4" aria-hidden />
                주의
              </span>
            )}
          </span>
        )}
        {open && (
          <span className={`mt-2 block rounded-xl p-3 text-sm ${isNext ? "bg-bg/40" : "bg-raised"}`}>
            <span className="mb-1 block font-semibold">{source ? "인계 메모 원문" : "직접 추가한 할 일"}</span>
            {source && <span className="block whitespace-pre-wrap">{source}</span>}
          </span>
        )}
      </button>
      {trailing}
    </Card>
  );
}

/** 환자 미지정 할 일 → 기존 담당 환자를 고르거나 호실-병상을 입력 */
function AssignForm({ task, rooms, onPick }: { task: Task; rooms: string[]; onPick: (room: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-2xl bg-raised p-4">
        {task.time && <span className="mr-1 font-semibold tabular-nums">{task.time}</span>}
        {task.text}
      </p>
      {rooms.length > 0 && (
        <div>
          <p className="mb-2 font-semibold">담당 환자에서 고르기</p>
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => (
              <Chip key={r} onClick={() => onPick(r)} className="tabular-nums">
                {idLabel(r)}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 font-semibold">호실-병상 입력</p>
        <RoomKeypad existing={[]} addLabel="지정" onAdd={(ids) => ids[0] && onPick(ids[0])} />
      </div>
    </div>
  );
}

/** 할 일 탭 아래: 뺀(숨긴) 환자 목록 → 다시 추가 */
function ExcludedPatients({ shift, tasks }: { shift: Shift; tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-8 border-t border-line pt-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center justify-between gap-2 text-left text-muted">
        <span className="font-medium">제외한 환자 {shift.excluded.length}명</span>
        <ChevronDown className={`size-5 transition ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <ul className="flex flex-col gap-2 pb-2">
          {[...shift.excluded].sort(compareIds).map((id) => {
            const hidden = tasks.filter((t) => t.room === id);
            const left = hidden.filter((t) => !t.done).length;
            return (
              <li key={id} className="flex items-center gap-3 rounded-card border border-card-border bg-card py-1 pr-1 pl-4">
                <span className="font-semibold tabular-nums">{idLabel(id)}</span>
                <span className="min-w-0 flex-1 text-sm text-muted">{hidden.length ? `숨긴 할 일 ${hidden.length}개${left ? ` · 미완료 ${left}` : ""}` : "숨긴 할 일 없음"}</span>
                <Button
                  variant="secondary"
                  className="shrink-0 text-sm"
                  onClick={async () => {
                    await addRooms(shift.id, [id]);
                    toast(`${idLabel(id)} 다시 추가했어요`);
                  }}
                >
                  다시 추가
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AddTaskForm({ shift, onDone }: { shift: Shift; onDone: () => void }) {
  const rooms = shift.scope === "ward" ? [...shift.rooms, WARD_MEMO] : shift.rooms;
  const [room, setRoom] = useState<string | null>(rooms.length === 1 ? rooms[0] : null);
  const [time, setTime] = useState("");
  const [text, setText] = useState("");
  const ok = !!room && !!text.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    await addManualTask(shift.id, room!, time || undefined, text.trim(), flagsOf(text).length ? "warning" : "normal");
    toast("할 일을 추가했어요");
    onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <p className="mb-2 font-semibold" id="add-room">
          환자
        </p>
        {rooms.length ? (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="add-room">
            {rooms.map((r) => (
              <Chip key={r} role="radio" aria-checked={room === r} aria-pressed={undefined} tone={room === r ? "patient" : "default"} onClick={() => setRoom(r)} className="tabular-nums">
                {idLabel(r)}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">먼저 담당 환자를 추가하세요</p>
        )}
      </div>
      <div>
        <label htmlFor="add-time" className="mb-2 block font-semibold">
          시간 (선택)
        </label>
        <input
          id="add-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="h-14 w-full rounded-2xl border-2 border-transparent bg-raised px-4 tabular-nums outline-none focus:border-green"
        />
      </div>
      <div>
        <label htmlFor="add-text" className="mb-2 block font-semibold">
          내용
        </label>
        <input
          id="add-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={120}
          placeholder="예: abx 투여"
          className="h-14 w-full rounded-2xl border-2 border-transparent bg-raised px-4 outline-none placeholder:text-muted focus:border-green"
        />
      </div>
      <Button type="submit" size="lg" full disabled={!ok} icon={<Plus className="size-5" />}>
        추가
      </Button>
    </form>
  );
}
