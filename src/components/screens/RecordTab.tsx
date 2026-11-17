"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronDown, CircleCheck, Copy, Ellipsis, FilePenLine, Play, Sparkles, TriangleAlert, Users } from "lucide-react";
import { db, getInputDraft, setInputDraft, uid } from "@/lib/db";
import { QUICK_CHIPS, applySuggestion, hasToken, relevantDict, splitKeywords, suggest } from "@/lib/abbreviations";
import { blockingNumbers, splitByNumbers } from "@/lib/numbers";
import { generate, OfflineError } from "@/lib/api";
import { hhmm } from "@/lib/time";
import { idLabel } from "@/lib/room";
import { markCopied } from "@/lib/shift";
import type { NurseRecord, Shift } from "@/lib/types";
import { useSession } from "../session";
import { usePiiGuard } from "../PiiGuard";
import { useActiveShift } from "../useShift";
import { Button, IconButton } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { copyText } from "../ui/copy";
import { ActionBar, Content, Empty, Header, OfflineBar, TabIcon } from "../ui/Layout";
import { ConfirmDialog, toast } from "../ui/Overlay";
import { PatientsSheet } from "./TasksTab";

export function RecordTab({ headerRight, goTasks }: { headerRight: React.ReactNode; goTasks: () => void }) {
  const shift = useActiveShift();
  const { online } = useSession();
  const [patientsOpen, setPatientsOpen] = useState(false);
  // 마지막으로 고른 환자 기억 (근무가 바뀌거나 빠졌으면 첫 환자)
  const [chosen, setChosen] = useState<string | null>(() => {
    try {
      return localStorage.getItem("baton-room");
    } catch {
      return null;
    }
  });

  if (shift === undefined) return <Header icon={<TabIcon tab="record" />} title="기록" right={headerRight} />;
  if (!shift)
    return (
      <>
        <Header icon={<TabIcon tab="record" />} title="기록" right={headerRight} />
        <Empty icon={<FilePenLine className="size-12" strokeWidth={1.8} />} title="근무 중이 아니에요" text="근무를 시작하면 담당 환자별로 기록할 수 있어요" />
        <ActionBar>
          <Button size="lg" full icon={<Play className="size-5" />} onClick={goTasks}>
            근무 시작
          </Button>
        </ActionBar>
      </>
    );

  const rooms = shift.rooms;
  const room = chosen && rooms.includes(chosen) ? chosen : (rooms[0] ?? null);
  const select = (id: string) => {
    setChosen(id);
    try {
      localStorage.setItem("baton-room", id);
    } catch {}
  };

  return (
    <>
      <Header icon={<TabIcon tab="record" />} title="기록" right={headerRight} />
      {!online && <OfflineBar />}
      {rooms.length === 0 ? (
        <>
          <Empty icon={<Users className="size-12" strokeWidth={1.8} />} title="담당 환자가 없어요" text="환자를 추가하거나 인계 메모에서 리스트를 만드세요" />
          <ActionBar>
            <Button size="lg" full icon={<Users className="size-5" />} onClick={() => setPatientsOpen(true)}>
              환자 추가
            </Button>
          </ActionBar>
        </>
      ) : (
        <>
          <div className="mx-auto max-w-[480px]">
            <div className="no-scrollbar flex gap-2 overflow-x-auto px-6 pt-2 pb-4" role="radiogroup" aria-label="환자">
              {rooms.map((id) => (
                <Chip key={id} role="radio" aria-checked={id === room} aria-pressed={undefined} tone={id === room ? "patient" : "default"} onClick={() => select(id)} className="tabular-nums">
                  {idLabel(id)}
                </Chip>
              ))}
            </div>
          </div>
          {room && <RoomRecords key={`${shift.id}:${room}`} shift={shift} room={room} />}
        </>
      )}
      <PatientsSheet shift={shift} open={patientsOpen} onClose={() => setPatientsOpen(false)} />
    </>
  );
}

function RoomRecords({ shift, room }: { shift: Shift; room: string }) {
  const { online, settings } = useSession();
  const { author, abbreviationDict: dict } = settings;
  const { guard, sheet } = usePiiGuard(shift.rooms);
  const [input, setInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // 생성 중인 기록 id 또는 "new"
  const [error, setError] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0); // 확정 직후 입력창에 포커스

  const records = useLiveQuery(
    () =>
      db.records
        .where("shiftId")
        .equals(shift.id)
        .filter((r) => r.room === room)
        .reverse()
        .sortBy("createdAt"),
    [shift.id, room],
    [] as NurseRecord[],
  );

  const draft = records.find((r) => r.status === "draft" && r.draftText);
  const list = records.filter((r) => r !== draft); // 최신순

  // 입력 중인 키워드 불러오기 / 자동 저장 (오프라인에서도 유지)
  useEffect(() => {
    getInputDraft(shift.id, room).then((t) => {
      // 불러오는 사이 이미 입력을 시작했다면 덮어쓰지 않음
      setInput((cur) => cur || t);
      setLoaded(true);
    });
  }, [shift.id, room]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => setInputDraft(shift.id, room, input), 300);
    return () => clearTimeout(t);
  }, [input, loaded, shift.id, room]);

  /** 키워드 → 문장. existing이 있으면 대기 중이던 기록을 생성 */
  const make = (existing?: NurseRecord) => {
    const keywords = existing ? existing.keywords : splitKeywords(input);
    if (!keywords.length) return;
    setError(null);

    // 오프라인: 키워드만 저장해 두고 나중에 생성
    if (!online && !existing) {
      savePending(keywords);
      return;
    }

    guard(keywords, async (clean, how) => {
      const kw = clean.map((k) => k.trim()).filter(Boolean);
      if (!kw.length) return;
      if (!existing && how === "clean") setInput(kw.join(", "));
      setBusy(existing?.id ?? "new");
      try {
        // 호실-병상은 보내지 않는다: 요청마다 임시 가명 하나만
        const res = await generate({ kind: "record", alias: "환자1", keywords: kw, dict: relevantDict(kw, dict) });
        const { sentence, uncertain } = res.data;
        if (existing) {
          await db.records.update(existing.id, { keywords: kw, draftText: sentence, finalText: sentence, uncertain });
        } else {
          await db.records.add(newRecord(shift.id, room, kw, author, sentence, uncertain));
          setInput("");
          await setInputDraft(shift.id, room, "");
        }
      } catch (e) {
        if (e instanceof OfflineError && !existing) savePending(kw);
        else setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    });
  };

  const savePending = async (keywords: string[]) => {
    await db.records.add(newRecord(shift.id, room, keywords, author, "", []));
    setInput("");
    await setInputDraft(shift.id, room, "");
    toast("저장됨 · 연결되면 만들 수 있어요");
  };

  const onConfirmed = (id: string, text: string) => {
    setInput("");
    setInputDraft(shift.id, room, "");
    setFocusKey((k) => k + 1);
    toast("확정했어요", {
      position: "bottom",
      duration: 2400,
      action: { label: "복사", doneLabel: "복사됨 ✓", onClick: () => copyRecord(id, text) },
    });
  };

  const label = idLabel(room);

  return (
    <Content className="!pt-0">
      {/* 중단: 입력 카드 (초안이 있으면 초안 편집) */}
      {draft ? (
        <DraftEditor
          key={draft.id}
          record={draft}
          label={label}
          author={author}
          onRedo={(kw) => setInput(kw.join(", "))}
          onConfirmed={onConfirmed}
        />
      ) : (
        <KeywordInput value={input} onChange={setInput} dict={dict} focusKey={focusKey} />
      )}

      {error && (
        <p className="mt-4 flex items-center gap-2 text-warn" role="alert">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {/* 하단: 이번 근무 기록 (최신순) */}
      <section className="mt-8" aria-labelledby="today-title">
        <h2 id="today-title" className="mb-4 font-semibold">
          이번 근무 기록 {list.length}건
        </h2>
        {list.length === 0 ? (
          <p className="text-sm text-muted">아직 기록이 없어요</p>
        ) : (
          <div className="flex flex-col gap-4">
            {list.map((r) => (
              <RecordCard key={r.id} record={r} label={label} busy={busy === r.id} online={online} onMake={() => make(r)} />
            ))}
          </div>
        )}
      </section>

      {!draft && (
        <ActionBar>
          <Button size="lg" full loading={busy === "new"} disabled={!splitKeywords(input).length} icon={<Sparkles className="size-5" />} onClick={() => make()}>
            {online ? "문장 만들기" : "저장하기"}
          </Button>
        </ActionBar>
      )}
      {sheet}
    </Content>
  );
}

/** 복사하면 자동 삭제 타이머(24시간)가 시작된다 */
async function copyRecord(id: string, text: string) {
  const ok = await copyText(text);
  if (ok) await markCopied([id]);
  return ok;
}

const newRecord = (shiftId: string, room: string, keywords: string[], author: string, text: string, uncertain: string[]): NurseRecord => ({
  id: uid(),
  shiftId,
  room,
  keywords,
  draftText: text,
  finalText: text,
  status: "draft",
  author,
  uncertain,
  createdAt: Date.now(),
  editHistory: [],
});

const COLLAPSED = 8; // 입력 중에는 칩 2줄(4열 × 2)만

function KeywordInput({ value, onChange, dict, focusKey }: { value: string; onChange: (v: string) => void; dict: Record<string, string>; focusKey: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const suggestions = useMemo(() => suggest(value, dict), [value, dict]);
  const [focused, setFocused] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const collapsed = focused && !expanded;
  const chips = collapsed ? QUICK_CHIPS.slice(0, COLLAPSED) : QUICK_CHIPS;
  // 입력창 포커스를 유지한 채 칩·더보기를 누를 수 있게
  const keepFocus = (e: React.PointerEvent) => focused && e.preventDefault();

  // 확정 직후: 비워진 입력창에 포커스
  useEffect(() => {
    if (focusKey > 0) ref.current?.focus();
  }, [focusKey]);

  const toggle = (label: string, needsValue: boolean) => {
    if (hasToken(value, label)) {
      onChange(
        splitKeywords(value)
          .filter((k) => k !== label && !k.startsWith(label + " "))
          .join(", "),
      );
      return;
    }
    const base = value.trim().replace(/,\s*$/, "");
    const next = (base ? base + ", " : "") + label + (needsValue ? " " : "");
    onChange(next);
    if (needsValue && ref.current) {
      // 같은 탭 동작 안에서 포커스해야 모바일 키보드가 바로 올라옴
      const el = ref.current;
      el.value = next;
      el.focus();
      el.setSelectionRange(next.length, next.length);
    }
  };

  return (
    <Card className="!p-4">
      {/* 4열 균등 그리드: 360px에서 12개가 3줄에 정확히 맞음 */}
      <div className="grid grid-cols-4 gap-2" id="kw-chips">
        {chips.map((c) => (
          <Chip key={c.label} fill tone={hasToken(value, c.label) ? "selected" : "default"} onPointerDown={keepFocus} onClick={() => toggle(c.label, c.needsValue)}>
            {c.label}
          </Chip>
        ))}
      </div>
      {focused && (
        <div className="-mb-2 flex justify-end">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls="kw-chips"
            onPointerDown={keepFocus}
            onClick={() => setExpanded((x) => !x)}
            className="-mr-2 inline-flex min-h-12 items-center gap-1 px-2 text-sm font-medium text-green"
          >
            {expanded ? "접기" : "더보기"}
            <ChevronDown className={`size-4 transition ${expanded ? "rotate-180" : ""}`} aria-hidden />
          </button>
        </div>
      )}
      <label htmlFor="kw" className="sr-only">
        키워드
      </label>
      <textarea
        id="kw"
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          setExpanded(false);
        }}
        onBlur={() => setFocused(false)}
        rows={3}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="예: BT 36.8, BP 120/80, 수면 양호"
        className="mt-4 w-full resize-none rounded-2xl border-2 border-transparent bg-raised p-4 outline-none placeholder:text-muted focus:border-green"
      />
      {suggestions.length > 0 && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto" aria-label="자동완성">
          {suggestions.map((s) => (
            <Chip
              key={s.abbr}
              onPointerDown={keepFocus}
              onClick={() => {
                onChange(applySuggestion(value, s.abbr));
                ref.current?.focus();
              }}
            >
              <span className="font-semibold">{s.abbr}</span>
              <span className="text-sm text-muted">{s.meaning}</span>
            </Chip>
          ))}
        </div>
      )}
    </Card>
  );
}

/** 카드 머리: 왼쪽 "501-1" + 상태, 오른쪽 ⋯ 메뉴 */
function CardHead({ label, state, menu }: { label: string; state: "draft" | "confirmed" | "pending"; menu: MenuItem[] }) {
  return (
    <div className="-mt-2 -mr-2 mb-2 flex min-h-12 items-center gap-2">
      <span className="font-semibold tabular-nums">{label}</span>
      <StateBadge state={state} />
      <span className="flex-1" />
      <MoreMenu items={menu} />
    </div>
  );
}

function StateBadge({ state }: { state: "draft" | "confirmed" | "pending" }) {
  return state === "confirmed" ? (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-green">
      <CircleCheck className="size-4" aria-hidden />
      확정
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-muted">
      <span className="size-2 rounded-full border border-dashed border-muted" aria-hidden />
      {state === "draft" ? "초안" : "대기"}
    </span>
  );
}

type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!items.length) return null;
  return (
    <div ref={box} className="relative">
      <IconButton label="더보기 메뉴" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Ellipsis className="size-5 text-muted" />
      </IconButton>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-10 min-w-32 overflow-hidden rounded-xl border border-card-border bg-sheet py-1">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={`flex min-h-12 w-full items-center px-4 text-left active:bg-raised ${it.danger ? "text-warn" : "text-ink"}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ id, text }: { id: string; text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button variant="secondary" icon={copied ? <Check className="size-5" /> : <Copy className="size-5" />} onClick={async () => (await copyRecord(id, text)) && setCopied(true)}>
      {copied ? "복사됨 ✓" : "복사"}
    </Button>
  );
}

function DraftEditor({
  record,
  label,
  author,
  onRedo,
  onConfirmed,
}: {
  record: NurseRecord;
  label: string;
  author: string;
  onRedo: (keywords: string[]) => void;
  onConfirmed: (id: string, text: string) => void;
}) {
  const [text, setText] = useState(record.finalText);
  const [confirming, setConfirming] = useState(false);
  const [del, setDel] = useState(false);
  const blocked = blockingNumbers(text, record.draftText, record.keywords);

  // 편집 내용 저장
  useEffect(() => {
    const t = setTimeout(() => db.records.update(record.id, { finalText: text }), 400);
    return () => clearTimeout(t);
  }, [text, record.id]);

  const confirm = async () => {
    setConfirming(false);
    const final = text.trim();
    await db.records.update(record.id, { finalText: final, status: "confirmed", confirmedAt: Date.now(), author });
    onConfirmed(record.id, final);
  };

  return (
    <>
      <Card state="draft">
        <CardHead
          label={label}
          state="draft"
          menu={[
            {
              label: "다시 쓰기",
              onSelect: async () => {
                onRedo(record.keywords);
                await db.records.delete(record.id);
              },
            },
            { label: "삭제", danger: true, onSelect: () => setDel(true) },
          ]}
        />
        <label htmlFor="draft" className="sr-only">
          초안 문장
        </label>
        <textarea
          id="draft"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full resize-none rounded-xl bg-transparent outline-none"
        />
        <p className="mt-2 text-sm text-muted">{record.keywords.join(", ")}</p>
      </Card>

      {blocked.length > 0 && (
        <div className="mt-4 rounded-2xl bg-warn-soft p-4" role="alert">
          <p className="flex items-center gap-2 font-semibold text-warn">
            <TriangleAlert className="size-5 shrink-0" aria-hidden />
            입력에 없는 숫자예요. 고치거나 지우세요
          </p>
          <p className="mt-2">
            {splitByNumbers(text, blocked).map((p, i) =>
              p.hit ? (
                <mark key={i} className="rounded bg-sun-soft px-1 font-semibold text-on-sun-soft underline decoration-warn decoration-2 underline-offset-4">
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
        </div>
      )}
      {record.uncertain.length > 0 && blocked.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <span className="size-2 shrink-0 rounded-full bg-sun" aria-hidden />
          확인 필요: {record.uncertain.join(", ")}
        </p>
      )}

      <ActionBar>
        <Button size="lg" full disabled={blocked.length > 0 || !text.trim()} icon={<Check className="size-5" />} onClick={() => setConfirming(true)}>
          확인
        </Button>
      </ActionBar>
      <ConfirmDialog
        open={confirming}
        title="이 문장으로 확정할까요?"
        message="확정한 기록만 복사할 수 있어요. 수정은 이력이 남아요"
        confirmLabel="확정"
        onClose={() => setConfirming(false)}
        onConfirm={confirm}
      />
      <DeleteDialog open={del} onClose={() => setDel(false)} id={record.id} />
    </>
  );
}

function DeleteDialog({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  return (
    <ConfirmDialog
      open={open}
      title="이 초안을 삭제할까요?"
      confirmLabel="삭제"
      danger
      onClose={onClose}
      onConfirm={async () => {
        onClose();
        await db.records.delete(id);
      }}
    />
  );
}

function RecordCard({ record, label, busy, online, onMake }: { record: NurseRecord; label: string; busy: boolean; online: boolean; onMake: () => void }) {
  const [del, setDel] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const pending = !record.draftText;
  const confirmed = record.status === "confirmed";
  const revisions = record.editHistory ?? [];

  // 확정 기록은 '수정'만, 초안(대기 포함)만 '삭제'
  const menu: MenuItem[] = confirmed ? [{ label: "수정", onSelect: () => setEditing(true) }] : [{ label: "삭제", danger: true, onSelect: () => setDel(true) }];

  return (
    <Card state={confirmed ? "confirmed" : "draft"}>
      <CardHead label={label} state={confirmed ? "confirmed" : pending ? "pending" : "draft"} menu={editing ? [] : menu} />

      {editing ? (
        <EditConfirmed record={record} onDone={() => setEditing(false)} />
      ) : (
        <p className={pending ? "text-muted" : ""}>{pending ? record.keywords.join(", ") : record.finalText}</p>
      )}

      {/* 수정 이력: 원문은 지우지 않고 펼쳐 볼 수 있게 */}
      {!editing && record.editedAt && (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((x) => !x)}
            className="-ml-2 inline-flex min-h-12 items-center gap-1 px-2 text-sm text-muted"
          >
            수정됨 · {hhmm(record.editedAt)}
            <ChevronDown className={`size-4 transition ${showHistory ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {showHistory && (
            <ol className="flex flex-col gap-2 border-l border-line pl-4">
              {revisions.map((rv, i) => (
                <li key={rv.replacedAt} className="text-sm text-muted">
                  <span className="font-semibold">{i === 0 ? "원문" : `수정 ${i}`}</span> · {hhmm(i === 0 ? record.confirmedAt ?? record.createdAt : revisions[i - 1].replacedAt)}
                  <p className="mt-1 whitespace-pre-wrap">{rv.text}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {!editing && (
        <div className="mt-2 -mb-2 flex items-center justify-between gap-2">
          <span className="text-sm text-muted">{confirmed ? `${record.author} · ${hhmm(record.confirmedAt!)}` : hhmm(record.createdAt)}</span>
          {confirmed && <CopyButton id={record.id} text={record.finalText} />}
          {pending && (
            <Button variant="secondary" loading={busy} disabled={!online} icon={<Sparkles className="size-5" />} onClick={onMake}>
              만들기
            </Button>
          )}
        </div>
      )}
      {!confirmed && <DeleteDialog open={del} onClose={() => setDel(false)} id={record.id} />}
    </Card>
  );
}

/** 확정 기록 수정: 이전 문장은 revisions에 남기고 "수정됨 · 시각" 표시 */
function EditConfirmed({ record, onDone }: { record: NurseRecord; onDone: () => void }) {
  const [text, setText] = useState(record.finalText);
  const save = async () => {
    const next = text.trim();
    if (next && next !== record.finalText) {
      const now = Date.now();
      await db.records.update(record.id, {
        finalText: next,
        editedAt: now,
        editHistory: [...(record.editHistory ?? []), { text: record.finalText, replacedAt: now }],
      });
      toast("수정했어요");
    }
    onDone();
  };
  return (
    <div>
      <label htmlFor={`edit-${record.id}`} className="sr-only">
        기록 수정
      </label>
      <textarea
        id={`edit-${record.id}`}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        className="w-full resize-none rounded-2xl border-2 border-transparent bg-raised p-4 outline-none focus:border-green"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          취소
        </Button>
        <Button disabled={!text.trim()} onClick={save}>
          저장
        </Button>
      </div>
    </div>
  );
}
