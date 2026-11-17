"use client";
/* 듀티 탭: 월간 근무표 + 날짜별 일정·역할. 자동 삭제하지 않는다 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Eraser, Pencil, Plus, Share, ShieldAlert, X } from "lucide-react";
import { db, uid } from "@/lib/db";
import { dutyEvents, saveDutyDay, setDuty, sortEvents } from "@/lib/shift";
import { addDays, dateKey, longDate, parseDateKey, shortDate } from "@/lib/time";
import { holidayName } from "@/lib/holidays";
import { HIT_LABEL, patientInfoHits } from "@/lib/deidentify";
import { isWorkDuty, type DutyDay, type DutyEvent, type DutyMark, type EventColor, type Role } from "@/lib/types";
import { Button, IconButton } from "../ui/Button";
import { DUTY_BG, DUTY_BORDER, DUTY_MARKS, DUTY_SWATCH, DUTY_TEXT, EVENT_COLORS, ROLE_LABEL, dutyText, eventColor } from "../ui/Duty";
import { Segmented } from "../ui/Segmented";
import { Content, Header, TabIcon } from "../ui/Layout";
import { Sheet } from "../ui/Overlay";
import { useSession } from "../session";
import { DutyShareSheet } from "../DutyShare";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 근무표 수정 모드에서 고른 도구: 듀티 지정 / 지우기 / 아직 안 고름 */
type EditTool = DutyMark | "erase" | "none";

/** 그 달의 칸: 앞쪽 빈칸(null) + 날짜 키 + 마지막 주 뒤쪽 빈칸. 줄 수 = 그 달이 걸치는 주 수(4~6) */
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(dateKey(new Date(year, month, d)));
  while (cells.length % 7) cells.push(null);
  return cells;
}


export function DutyTab({ headerRight, demo }: { headerRight: ReactNode; demo?: ReactNode }) {
  const { settings } = useSession();
  const [today, setToday] = useState(() => dateKey(Date.now()));
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [quick, setQuick] = useState<EditTool | null>(null); // null = 근무표 수정 모드 꺼짐
  const [slide, setSlide] = useState<"next" | "prev" | null>(null); // 달 이동 방향 (애니메이션)
  const quickOn = quick !== null;

  // 듀티 탭에 있는 동안만 화면 배경을 달력용(--cal-screen)으로
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.screen = "duty";
    return () => {
      delete root.dataset.screen;
    };
  }, []);

  // 자정이 지나면 '오늘' 표시 갱신
  useEffect(() => {
    const id = setInterval(() => setToday(dateKey(Date.now())), 60_000);
    return () => clearInterval(id);
  }, []);

  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor]);
  const first = cells.find(Boolean)!;
  const last = cells.findLast(Boolean)!;
  // 달 경계의 연속 구간도 이어 보이도록 앞뒤 하루씩 더 읽는다 (합계에는 넣지 않음)
  const days = useLiveQuery(() => db.duty.where("date").between(addDays(first, -1), addDays(last, 1), true, true).toArray(), [first, last], [] as DutyDay[]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { D: 0, E: 0, N: 0, OFF: 0, R: 0 };
    for (const d of days) if (d.duty && d.date >= first && d.date <= last) c[d.duty]++;
    return c;
  }, [days, first, last]);

  // 날짜 시트: 보고 있는 달 밖의 날짜(이번 주 일정)도 열 수 있게 따로 읽는다
  const opened = useLiveQuery(async () => (openDate ? { date: openDate, day: await db.duty.get(openDate) } : null), [openDate]);

  const move = (delta: number) => {
    setSlide(delta > 0 ? "next" : "prev");
    setCursor(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  // 달력 카드 좌우 스와이프: 가로로 충분히(48px 이상, 세로보다 크게) 밀면 이전/다음 달
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swipeStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipe.current = { x: t.clientX, y: t.clientY };
  };
  const swipeEnd = (e: React.TouchEvent) => {
    const s0 = swipe.current;
    swipe.current = null;
    if (!s0) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s0.x;
    const dy = t.clientY - s0.y;
    if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  };

  const tap = async (date: string) => {
    if (!quickOn) return setOpenDate(date);
    if (quick === "none") return;
    if (quick === "erase") return setDuty(date, null);
    // 다른 듀티가 있으면 바꾸고, 같은 듀티를 다시 누르면 해제
    await setDuty(date, byDate.get(date)?.duty === quick ? null : quick);
  };

  const monthLabel = `${cursor.y}년 ${cursor.m + 1}월`;
  const monthKey = `${cursor.y}-${cursor.m}`;
  const emptyMonth = Object.values(counts).every((n) => n === 0);
  const dutyOf = (date: string) => byDate.get(date)?.duty ?? null;
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  // 실제 행 높이(화면 높이에 따라 76~100px)를 재서, 100px 미만이면 일정 1줄 + "+N"
  const [rowPx, setRowPx] = useState(ROW_MAX);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const ro = new ResizeObserver(() => {
      const row = card.querySelector<HTMLElement>("[data-week]");
      if (row) setRowPx(row.getBoundingClientRect().height);
    });
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  const lines = rowPx >= ROW_MAX - 0.5 ? 2 : 1;

  return (
    <>
      <Header
        icon={<TabIcon tab="duty" />}
        title="듀티"
        right={
          <>
            {demo}
            <button
              type="button"
              aria-label="이미지로 공유"
              title="이미지로 공유"
              onClick={() => setSharing(true)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-raised active:bg-raised"
            >
              <Share className="size-5" aria-hidden />
            </button>
            <IconButton
              label="근무표 수정"
              aria-pressed={quickOn}
              onClick={() => setQuick((q) => (q === null ? "none" : null))}
              className={`!size-11 ${quickOn ? "bg-green-soft text-green" : ""}`}
            >
              <Pencil className="size-5" aria-hidden />
            </IconButton>
            {headerRight}
          </>
        }
      />
      <Content
        action={quickOn}
        className={quickOn ? "!pb-[calc(var(--spacing-tabbar)+168px+env(safe-area-inset-bottom))]" : "!pb-[calc(var(--spacing-tabbar)+17px+env(safe-area-inset-bottom))]"}
      >
        {/* 달력 카드(한 덩어리): 헤더(달 이동, 좌우로 밀어도 이동) → 이번 달 요약 한 줄 → 요일 → 날짜 칸(칸 사이 1px 선).
            모서리 16px + overflow hidden(isolate: 슬라이드 애니메이션 중에도 WebKit에서 모서리 밖으로 안 나가게). 글자 선택 막음 */}
        <div ref={cardRef} className="no-select isolate touch-pan-y overflow-hidden rounded-card border border-cal-border bg-card" onTouchStart={swipeStart} onTouchEnd={swipeEnd}>
          <div className="relative flex h-[52px] items-center justify-center gap-2 bg-cal-head px-4">
            <button type="button" aria-label="이전 달" onClick={() => move(-1)} className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-cal-head-press active:bg-cal-head-press">
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <h2 key={monthKey} className={`min-w-[4.5rem] text-center text-[17px] font-semibold text-ink tabular-nums ${slide ? "cal-fade" : ""}`} aria-live="polite">
              {monthLabel}
            </h2>
            <button type="button" aria-label="다음 달" onClick={() => move(1)} className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-cal-head-press active:bg-cal-head-press">
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>
          {/* 이번 달 요약 한 줄 (근무가 없는 달도 0으로 표시) */}
          {/* 근무 횟수 줄: 월 헤더·날짜 칸과 배경색 단계로 구분 */}
          <p className="flex h-10 items-center justify-between bg-cal-sum px-4 text-[13px] tabular-nums" aria-label="이번 달 합계">
            {(["OFF", "D", "E", "N", "R"] as const).map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={`size-2 shrink-0 rounded-full ${DUTY_SWATCH[k]}`} aria-hidden />
                {/* 라벨은 그 듀티 글자색 + 굵게 (R은 라이트에서 대비가 모자라 요약 라벨색) */}
                <span className={`font-semibold ${k === "R" ? "text-sum-label" : DUTY_TEXT[k]}`}>{k}</span>
                <span className="font-semibold text-sum-num">{counts[k]}</span>
              </span>
            ))}
          </p>
          <div className="grid grid-cols-7 gap-px border-t border-grid-line bg-grid-line text-center text-xs" aria-hidden>
            {WEEK.map((w) => (
              <span key={w} className="flex h-7 items-center justify-center bg-cal-week font-medium text-weekday">
                {w}
              </span>
            ))}
          </div>
          <div
            key={monthKey}
            className={`flex flex-col gap-px border-t border-grid-line bg-grid-line ${slide === "next" ? "cal-next" : slide === "prev" ? "cal-prev" : ""}`}
            role="group"
            aria-label={`${cursor.y}년 ${cursor.m + 1}월 근무표`}
          >
            {weeks.map((week, w) => (
              <WeekRow key={week.find(Boolean) ?? w} today={today} week={week} dutyOf={dutyOf} label={settings.dutyLabel} height={rowHeight(weeks.length)}>
                {week.map((date, i) =>
                  date ? (
                    <DayCell key={date} date={date} day={byDate.get(date)} today={date === today} editing={quickOn} lines={lines} onTap={() => tap(date)} />
                  ) : (
                    <span key={`e${i}`} className="bg-cell" aria-hidden />
                  ),
                )}
              </WeekRow>
            ))}
          </div>
        </div>

        {/* 근무가 하나도 없는 달: 달력 카드 아래 안내 + 빠르게 입력 (근무표 수정 중에는 숨김, 근무가 생기면 사라짐) */}
        {emptyMonth && !quickOn && (
          <div className="mt-3 flex h-12 items-center justify-between gap-2 rounded-full border border-card-border bg-card pr-1.5 pl-5">
            <span className="min-w-0 truncate text-sm">{cursor.m + 1}월 근무표가 아직 없어요</span>
            <button
              type="button"
              onClick={() => setQuick("none")}
              className="h-9 shrink-0 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary active:bg-primary-press"
            >
              빠르게 입력
            </button>
          </div>
        )}
      </Content>


      {quickOn && <QuickBar value={quick} onChange={setQuick} onDone={() => setQuick(null)} />}

      <Sheet open={sharing} onClose={() => setSharing(false)} title="이미지로 공유">
        {sharing && <DutyShareSheet year={cursor.y} month={cursor.m} byDate={byDate} />}
      </Sheet>

      {/* '완료'를 눌러야 저장. 바깥 누름·Esc로 닫으면 바꾼 내용(듀티·역할·일정)은 모두 버림 */}
      <Sheet open={!!openDate} onClose={() => setOpenDate(null)} title={openDate ? `${longDate(openDate)} 수정` : ""}>
        {openDate && opened?.date === openDate && <DaySheet key={openDate} date={openDate} day={opened.day} onDone={() => setOpenDate(null)} />}
      </Sheet>
    </>
  );
}

/* 칸 높이 = min(100px, 쓸 수 있는 높이 ÷ 줄 수), 최소 76px (그보다 작으면 화면 전체 세로 스크롤).
   100px: 위 여백 6 → 날짜 18 → 4 → 듀티 배지 32 → 4 → 일정 2줄(14 + 2 + 14) → 아래 여백 6.
   100px 미만: 일정 1줄 + "+N" (76px = 6 + 18 + 4 + 32 + 2 + 14).
   달력은 한 덩어리(칸 사이 1px 선). 배지는 칸 좌우 2px만 남기고 거의 채운다.
   오늘 표시 = 날짜 위 4px ~ 배지 아래 4px, 칸 좌우 안쪽 2px, 모서리 10px (일정 줄은 테두리 밖).
   근무가 없는 날은 날짜 숫자만 감쌈 (높이 28px, 칸 좌우 안쪽 4px) */
const ROW_MAX = 100;
const ROW_MIN = 76;
/* 칸 줄 말고 화면 세로를 차지하는 것: 상단 바 56 + 선 1, 본문 위 여백 8, 카드 테두리 2, 카드 헤더 52, 요약 줄 40,
   요일 줄 28 + 위 선 1, 날짜 칸 위 선 1, 하단 여백 16 + 하단 탭 64 + 선 1 = 270px (+ 줄 사이 1px 선, 안전영역 위·아래) */
const FIXED_H = 270;
const rowHeight = (rows: number) =>
  `clamp(${ROW_MIN}px, calc((100dvh - ${FIXED_H + rows - 1}px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) / ${rows}), ${ROW_MAX}px)`;
const CELL_TOP = 6;
const DATE_H = 18;
const BAR_GAP = 4;
const BAR_TOP = CELL_TOP + DATE_H + BAR_GAP;
const BAR_MARGIN = 2;
const TODAY_PAD = 4;
const TODAY_TOP = CELL_TOP - TODAY_PAD;
const TODAY_H = TODAY_PAD + DATE_H + BAR_GAP + 32 + TODAY_PAD;
const TODAY_DATE_H = 28;
const TODAY_DATE_TOP = CELL_TOP + DATE_H / 2 - TODAY_DATE_H / 2;

interface Segment {
  start: number; // 0=일 … 6=토
  end: number;
  duty: DutyMark;
  /** 앞날(지난주 토요일·지난달)·다음날(다음 주 일요일·다음 달)과 같은 듀티로 이어짐: 그쪽 끝은 칸 끝까지 직각 */
  joinLeft: boolean;
  joinRight: boolean;
}

/** 한 주에서 같은 듀티가 이어지는 구간들 */
function weekSegments(week: (string | null)[], dutyOf: (date: string) => DutyMark | null): Segment[] {
  const out: Segment[] = [];
  for (let c = 0; c < 7; c++) {
    const date = week[c];
    const duty = date ? dutyOf(date) : null;
    if (!date || !duty) continue;
    let e = c;
    while (e < 6 && week[e + 1] && dutyOf(week[e + 1]!) === duty) e++;
    out.push({ start: c, end: e, duty, joinLeft: dutyOf(addDays(date, -1)) === duty, joinRight: dutyOf(addDays(week[e]!, 1)) === duty });
    c = e;
  }
  return out;
}

/** 한 주 줄: 날짜 칸(눌러서 수정) 위에 구간 막대 → 듀티 글자 순서로 겹쳐 그린다 (겹층은 눌림을 통과시킴).
    구간 하나 = 요소 하나 (grid-column 시작 / 끝+1), 양 끝 여백 6px · 모서리 10px.
    주·달이 바뀌어 이어지는 쪽은 여백 0 · 직각으로 칸 끝까지 닿는다 */
/** 오늘 표시 영역: 근무가 있으면 날짜 숫자 + 근무 배지(칸 좌우 안쪽 2px), 없으면 날짜 숫자만(좌우 안쪽 4px) */
function TodayMark({ duty, className }: { duty: boolean; className: string }) {
  return duty ? (
    <span className={`${className} pointer-events-none absolute inset-x-0.5 rounded-[10px]`} style={{ top: TODAY_TOP, height: TODAY_H }} aria-hidden />
  ) : (
    <span className={`${className} pointer-events-none absolute inset-x-1 rounded-[10px]`} style={{ top: TODAY_DATE_TOP, height: TODAY_DATE_H }} aria-hidden />
  );
}

function WeekRow({
  week,
  dutyOf,
  label,
  height,
  today,
  children,
}: {
  /** 오늘 날짜 키 (이 주에 있으면 테두리를 근무 막대 위에 그림) */
  today: string;
  week: (string | null)[];
  dutyOf: (date: string) => DutyMark | null;
  /** 근무 표기 (D·E·N·OFF / 데이·이브닝·나이트·오프) */
  label: "short" | "korean";
  /** 줄 높이 (CSS 값) */
  height: string;
  children: ReactNode;
}) {
  const segs = weekSegments(week, dutyOf);
  const todayCol = week.indexOf(today);
  const layer = "pointer-events-none absolute inset-x-0 grid h-8 grid-cols-7 gap-x-px";
  return (
    <div data-week className="relative grid grid-cols-7 gap-px" style={{ height }}>
      {/* 오늘 배경은 칸(DayCell) 안 = 근무 막대 아래, 오늘 테두리는 맨 아래 겹층 = 근무 막대 위 */}
      {children}
      <div className={layer} style={{ top: BAR_TOP }} aria-hidden>
        {segs.map((g) => (
          <span
            key={g.start}
            className={`${DUTY_BG[g.duty]} ${g.duty === "R" ? `border-y border-duty-r-border ${g.joinLeft ? "" : "border-l"} ${g.joinRight ? "" : "border-r"}` : ""} ${
              g.joinLeft ? "" : "rounded-l-[10px]"
            } ${g.joinRight ? "" : "rounded-r-[10px]"}`}
            style={{ gridColumn: `${g.start + 1} / ${g.end + 2}`, marginLeft: g.joinLeft ? 0 : BAR_MARGIN, marginRight: g.joinRight ? 0 : BAR_MARGIN }}
          />
        ))}
      </div>
      <div className={layer} style={{ top: BAR_TOP }} aria-hidden>
        {segs.flatMap((g) =>
          Array.from({ length: g.end - g.start + 1 }, (_, k) => (
            <span
              key={g.start + k}
              className={`flex items-center justify-center overflow-hidden font-bold whitespace-nowrap ${label === "korean" ? "" : "text-[15px]"} ${g.duty === "OFF" && label === "short" ? "tracking-tight" : ""} ${DUTY_TEXT[g.duty]}`}
              // 한글 표기: 13px, 칸 폭에 안 들어가면 자동 축소 (가장 긴 3글자 기준)
              style={{ gridColumn: g.start + k + 1, containerType: "inline-size", ...(label === "korean" ? { fontSize: "min(13px, calc((100cqw - 6px) / 3))" } : {}) }}
            >
              {dutyText(g.duty, label)}
            </span>
          )),
        )}
      </div>
      {/* 오늘 테두리: 근무 막대·글자 위 맨 위 층 (레몬 노랑 2px, D의 호박색과 구분) */}
      {todayCol >= 0 && (
        <div className="pointer-events-none absolute inset-0 grid grid-cols-7 gap-x-px" aria-hidden>
          <span className="relative" style={{ gridColumn: todayCol + 1 }}>
            <TodayMark duty={!!dutyOf(today)} className="today-ring" />
          </span>
        </div>
      )}
    </div>
  );
}

function DayCell({
  date,
  day,
  today,
  editing,
  lines,
  onTap,
}: {
  date: string;
  day?: DutyDay;
  today: boolean;
  editing: boolean;
  /** 일정 줄 수 (칸 100px = 2줄, 그보다 작으면 1줄) */
  lines: 1 | 2;
  onTap: () => void;
}) {
  const d = parseDateKey(date);
  const duty = day?.duty ?? null;
  const role = day?.role ?? null;
  const events = dutyEvents(day);
  const holiday = holidayName(date);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${longDate(date)}${today ? " 오늘" : ""}${holiday ? ` ${holiday}` : ""}, ${duty ? (isWorkDuty(duty) ? `${duty} 근무` : duty === "R" ? "기타" : duty) : "근무 없음"}${role ? `, ${ROLE_LABEL[role]}` : ""}${
        events.length ? `, 일정 ${events.length}개: ${events.map((e) => (e.time ? `${e.time} ${e.text}` : e.text)).join(", ")}` : ""
      }${editing ? "" : ", 눌러서 수정"}`}
      className="relative flex h-full flex-col items-stretch overflow-hidden bg-cell px-[3px] active:bg-raised"
      style={{ paddingTop: CELL_TOP }}
    >
      {/* 오늘 배경(라이트 연레몬, 다크 없음)만 칸 안에: 근무 막대 겹층·날짜 숫자보다 아래. 테두리는 주 줄 겹층(WeekRow)에서 막대 위에 그린다 */}
      {today && <TodayMark duty={!!duty} className="today-fill" />}
      {/* 날짜 숫자: 공휴일만 색. 오늘도 숫자 색은 그대로(굵게만), 오늘 표시는 노란 테두리로 */}
      {/* 날짜 숫자 + 역할(차·액): 숫자 바로 오른쪽 위에 작은 위첨자로 붙여 한 덩어리로 가운데 정렬.
          칸 오른쪽 위 고정 위치는 두 자리 날짜·좁은 화면에서 숫자와 겹쳐서 바꿈 */}
      <span className="relative flex items-start justify-center">
        <span className={`inline-flex h-[18px] items-center justify-center text-sm tabular-nums ${holiday ? "text-holiday" : ""} ${today ? "font-bold" : ""}`}>
          {d.getDate()}
        </span>
        {role && (
          <span className="relative left-px mt-px ml-0.5 text-[10px] leading-none font-medium text-role-ink" aria-hidden>
            {role === "charge" ? "차" : "액"}
          </span>
        )}
      </span>
      {/* 듀티 막대·글자는 주 줄(WeekRow)의 겹층에 그린다. 여기서는 그 높이만큼 자리만 비워 둠 */}
      {/* 듀티 배지 자리 (막대·글자는 주 줄 겹층에 그림). 근무가 없어도 비워 둬 일정 줄 위치를 맞춤 */}
      <span className="h-8 shrink-0" style={{ marginTop: BAR_GAP }} aria-hidden />
      {/* 일정 최대 2줄: 공휴일 이름(공휴일 색, 막대 없음) → 개인 일정(시간 있는 것 먼저). 남은 개수 "+N"은 마지막 줄 끝 */}
      {(holiday || events.length > 0) && (
        <span className={`${lines === 2 ? "mt-1" : "mt-0.5"} flex min-w-0 flex-col gap-0.5`} aria-hidden>
          {[...(holiday ? [{ id: "holiday", text: holiday, holiday: true as const }] : []), ...events.map((e) => ({ ...e, holiday: false as const }))]
            .slice(0, lines)
            .map((e, i, shown) => {
              const rest = i === shown.length - 1 ? events.length - shown.filter((x) => !x.holiday).length : 0;
              return (
                <span key={e.id} className="flex min-w-0 items-center gap-0.5">
                  <span
                    className={`min-w-0 flex-1 truncate text-left text-[11px] leading-[14px] ${
                      e.holiday ? "font-medium text-holiday" : `border-l-2 pl-[3px] text-ev-text ${eventColor("color" in e ? e.color : undefined).border}`
                    }`}
                  >
                    {e.text}
                  </span>
                  {rest > 0 && <span className="shrink-0 text-[11px] leading-[14px] text-muted tabular-nums">+{rest}</span>}
                </span>
              );
            })}
        </span>
      )}
    </button>
  );
}

/** 듀티 5개(+ 선택적으로 지우기) 가로 배치. 선택 = 그 듀티 글자색 2px 테두리만. 선택된 듀티를 다시 누르면 해제 */
function DutyButtons({
  value,
  onChange,
  label,
  erase,
}: {
  value: EditTool | null;
  onChange: (d: EditTool | null) => void;
  label: string;
  /** 지우기 버튼 표시 */
  erase?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`grid gap-2 ${erase ? "grid-cols-6" : "grid-cols-5"}`}>
      {DUTY_MARKS.map((k) => {
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? null : k)}
            className={`flex h-14 flex-col items-center justify-center rounded-2xl border-2 bg-raised font-bold text-ink transition-colors ${k === "OFF" ? "text-base" : "text-heading"} ${
              on ? DUTY_BORDER[k] : "border-transparent"
            }`}
          >
            <span>{k}</span>
            <span className={`mt-0.5 h-1.5 w-6 rounded-full ${DUTY_SWATCH[k]}`} aria-hidden />
          </button>
        );
      })}
      {erase && (
        <button
          type="button"
          role="radio"
          aria-checked={value === "erase"}
          onClick={() => onChange(value === "erase" ? null : "erase")}
          className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 bg-raised text-xs font-semibold text-ink transition-colors ${
            value === "erase" ? "border-ink" : "border-transparent"
          }`}
        >
          <Eraser className="size-5" aria-hidden />
          지우기
        </button>
      )}
    </div>
  );
}

/** 펼친(수정 중인) 일정: 목록의 기존 일정(id) 또는 아래 '일정 추가'로 새로 만드는 일정("new") */
type EditingEvent = { id: string; text: string; time?: string; end?: string; color: EventColor };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const LAST_MIN = 23 * 60 + 55;
/** "19:00" → "오후 7:00" */
const ampm = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${t.slice(3, 5)}`;
};
/** 종료가 시작보다 늦을 때만 유효 */
const validEnd = (time?: string, end?: string) => (time && end && toMin(end) > toMin(time) ? end : undefined);

/** 날짜 시트: 듀티·역할·일정. '완료'를 눌러야 저장하고, 그냥 닫으면(바깥 누름·Esc) 바꾼 내용은 모두 버린다.
    일정(맥 캘린더 방식): 줄을 누르면 그 자리에서 상세 카드로 펼침(한 번에 하나) → 카드 바깥을 누르면 목록에 반영하고 접힘.
    목록 아래 '일정 추가' → 위에 겹친 새 일정 시트(✓ 목록에 추가 / X 취소). 줄 옆 X → 목록에서 삭제 */
function DaySheet({ date, day, onDone }: { date: string; day?: DutyDay; onDone: () => void }) {
  const savedDuty = day?.duty ?? null;
  const [initial] = useState(() => dutyEvents(day));
  const savedRole = day?.role ?? null;
  // 초안은 state(화면)와 ref(저장용) 둘 다에 둔다: 바깥 누름 → 카드 반영 → 닫기·완료가 한 번의 누름에서 이어져도
  // 저장은 다시 그리기를 기다리지 않고 항상 최신 초안을 쓴다
  const [duty, setDutyState] = useState<DutyMark | null>(savedDuty);
  const [role, setRoleState] = useState<Role>(savedRole);
  const [events, setEventsState] = useState<DutyEvent[]>(initial);
  const draft = useRef({ duty: savedDuty, role: savedRole, events: initial });
  const setDraftDuty = (d: DutyMark | null) => {
    draft.current.duty = d;
    setDutyState(d);
  };
  const setRole = (r: Role) => {
    draft.current.role = r;
    setRoleState(r);
  };
  const setEvents = (f: (l: DutyEvent[]) => DutyEvent[]) => {
    draft.current.events = f(draft.current.events);
    setEventsState(draft.current.events);
  };
  const [editing, setEditingState] = useState<EditingEvent | null>(null);
  // 바깥 누름 처리(문서 click 캡처)가 항상 최신 값을 쓰고, 같은 누름에서 두 번 반영되지 않게 ref로도 둔다
  const editingRef = useRef(editing);
  const setEditing = (v: EditingEvent | null) => {
    editingRef.current = v;
    setEditingState(v);
  };
  const cardRef = useRef<HTMLDivElement>(null);
  // 일정 입력에도 비식별 필터 (환자 정보 경고)
  const hits = useMemo(() => patientInfoHits([editing?.text ?? "", ...events.map((e) => e.text)].join("\n")), [editing?.text, events]);

  /** 펼친 일정을 목록에 반영한 결과. 제목이 비면 새 일정은 버리고, 기존 일정은 지운다 */
  const applyEditing = (list: DutyEvent[], ed: EditingEvent | null): DutyEvent[] => {
    if (!ed) return list;
    const text = ed.text.trim();
    const end = validEnd(ed.time, ed.end);
    const fields = { text, color: ed.color, ...(ed.time ? { time: ed.time } : {}), ...(end ? { end } : {}) };
    if (ed.id === "new") return text ? sortEvents([...list, { id: uid(), createdAt: Date.now(), ...fields }]) : list;
    if (!text) return list.filter((e) => e.id !== ed.id);
    return sortEvents(list.map((e) => (e.id === ed.id ? { id: e.id, createdAt: e.createdAt, ...fields } : e)));
  };
  const commit = () => {
    const ed = editingRef.current;
    if (!ed) return;
    setEvents((l) => applyEditing(l, ed));
    setEditing(null);
  };
  const removeEditing = () => {
    const ed = editingRef.current;
    if (ed && ed.id !== "new") setEvents((l) => l.filter((x) => x.id !== ed.id));
    setEditing(null);
  };

  // 카드 바깥 누름 → 반영하고 접힘. 캡처 단계라 다른 줄·'일정 추가'·'완료'의 동작보다 먼저 일어난다
  const open = !!editing;
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) commit();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 새 일정의 색은 마지막으로 고른 색을 이어서
  const lastColor = useRef<EventColor>("violet");

  /** 바뀐 것이 있으면 저장. 펼쳐 둔 일정도 함께 (제목이 비었으면 빼고) */
  const save = async () => {
    const { duty: d, role: r, events: l } = draft.current;
    const list = applyEditing(l, editingRef.current);
    if (d !== savedDuty || r !== savedRole || JSON.stringify(list) !== JSON.stringify(initial)) await saveDutyDay(date, d, list, r);
  };
  const done = async () => {
    await save();
    onDone();
  };

  const holiday = holidayName(date);
  const [adding, setAdding] = useState<EventColor | null>(null); // 새 일정 시트 (값 = 시작 색)
  const card = editing && (
    <EventCard
      key={editing.id}
      ref={cardRef}
      date={date}
      value={editing}
      onChange={(v) => {
        lastColor.current = v.color;
        setEditing(v);
      }}
      onCommit={commit}
      onDelete={removeEditing}
    />
  );
  return (
    <div className="flex flex-col gap-5">
      {holiday && (
        <p className="-mt-3 text-sm font-semibold text-holiday tabular-nums">
          {shortDate(date)} · {holiday}
        </p>
      )}
      <div>
        <span className="mb-2 block font-semibold">듀티</span>
        <DutyButtons label="듀티" value={duty} onChange={(d) => setDraftDuty(d === "erase" || d === "none" ? null : d)} />
      </div>

      <div>
        <span className="mb-2 block font-semibold">역할</span>
        <Segmented
          label="역할"
          allowDeselect
          value={role}
          onChange={(v) => setRole(v)}
          options={[
            { value: "charge", label: "차지" },
            { value: "acting", label: "액팅" },
          ]}
        />
      </div>

      <div>
        <span className="mb-2 block font-semibold">일정</span>
        {events.length > 0 && (
          <ul aria-label="일정 목록" className="mb-2 divide-y divide-line overflow-hidden rounded-2xl bg-raised">
            {events.map((e) =>
              editing?.id === e.id ? (
                <li key={e.id}>{card}</li>
              ) : (
                <SwipeToDelete key={e.id} onDelete={() => setEvents((l) => l.filter((x) => x.id !== e.id))}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setEditing({ id: e.id, text: e.text, time: e.time, end: e.end, color: e.color ?? "violet" })}
                      aria-label={`일정 열기: ${e.time ? `${e.time}${e.end ? `~${e.end}` : ""} ` : "하루 종일 "}${e.text}`}
                      className="flex min-h-12 min-w-0 flex-1 items-center gap-3 pl-3 text-left active:bg-sheet"
                    >
                      <span className={`h-5 w-[3px] shrink-0 rounded-full ${eventColor(e.color).bg}`} aria-hidden />
                      <span className="w-14 shrink-0 text-[13px] text-muted tabular-nums">{e.time ?? "종일"}</span>
                      <span className="min-w-0 flex-1 py-2 text-[15px] leading-snug break-all text-ink">{e.text}</span>
                    </button>
                    {/* 저장된 일정 바로 지우기 */}
                    <button
                      type="button"
                      onClick={() => setEvents((l) => l.filter((x) => x.id !== e.id))}
                      aria-label={`일정 삭제: ${e.text}`}
                      className="flex size-11 shrink-0 items-center justify-center text-muted transition-colors active:bg-sheet"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                </SwipeToDelete>
              ),
            )}
          </ul>
        )}
        <button
          type="button"
          aria-label="일정 추가"
          // 펼친 카드는 문서 click 캡처에서 먼저 반영·접힘. 새 일정은 위에 겹친 시트에서 (✓ 저장 / X 취소)
          onClick={() => setAdding(lastColor.current)}
          className="flex h-11 w-full items-center justify-center rounded-xl bg-raised text-green transition-colors active:bg-sheet"
        >
          <Plus className="size-5" aria-hidden />
        </button>
        {hits.length > 0 && (
          <p className="mt-2 flex items-start gap-2 text-sm font-semibold text-warn" role="alert">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              환자 정보는 적지 않아요 <span className="font-normal">({[...new Set(hits.map((h) => HIT_LABEL[h.type]))].join(", ")})</span>
            </span>
          </p>
        )}
      </div>

      <Button full size="lg" onClick={done}>
        완료
      </Button>

      {adding && (
        <NewEventSheet
          date={date}
          color={adding}
          onCancel={() => setAdding(null)}
          onSave={(ev) => {
            lastColor.current = ev.color;
            setEvents((l) => applyEditing(l, ev));
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

/** 새 일정 시트 (날짜 시트 위에 겹침): 왼쪽 위 X = 취소, 오른쪽 위 ✓ = 저장 (제목이 있어야 누를 수 있음).
    하루 종일 꺼진 상태(오전 9:00)로 시작하고 제목·색·하루 종일·시작·종료를 한 화면에서 바로 고른다. 바깥을 누르거나 Esc도 취소 */
function NewEventSheet({ date, color, onCancel, onSave }: { date: string; color: EventColor; onCancel: () => void; onSave: (ev: EditingEvent) => void }) {
  const [value, setValue] = useState<EditingEvent>({ id: "new", text: "", time: "09:00", color });
  const canSave = value.text.trim().length > 0;
  const save = () => canSave && onSave(value);
  const hits = useMemo(() => patientInfoHits(value.text), [value.text]);
  return (
    <Sheet
      open
      onClose={onCancel}
      title="새 일정"
      left={
        // 취소 = 빨강 (연한 빨강 원 + 빨간 X)
        <button type="button" aria-label="취소" onClick={onCancel} className="flex size-11 items-center justify-center rounded-full bg-warn-soft text-warn transition-opacity active:opacity-70">
          <X className="size-6" strokeWidth={2.75} aria-hidden />
        </button>
      }
      right={
        <button
          type="button"
          aria-label="저장"
          aria-disabled={!canSave}
          onClick={save}
          // 저장 = 초록 (채운 초록 원 + 흰 체크). 제목이 없으면 회색으로 비활성
          className={`flex size-11 items-center justify-center rounded-full transition-colors ${canSave ? "bg-green text-on-green active:opacity-70" : "bg-disabled-bg text-disabled-ink"}`}
        >
          <Check className="size-6" strokeWidth={3} aria-hidden />
        </button>
      }
    >
      <div className="rounded-2xl bg-raised">
        <EventCard date={date} value={value} isNew onChange={setValue} onCommit={save} />
      </div>
      {hits.length > 0 && (
        <p className="mt-2 flex items-start gap-2 text-sm font-semibold text-warn" role="alert">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            환자 정보는 적지 않아요 <span className="font-normal">({[...new Set(hits.map((h) => HIT_LABEL[h.type]))].join(", ")})</span>
          </span>
        </p>
      )}
    </Sheet>
  );
}

/** 일정 상세 카드 (맥 캘린더 방식). 목록 안에서 펼친 기존 일정과 새 일정 시트가 함께 쓴다.
    1행 제목 + 색 선택(팝오버) / 2행 시간 요약 → 누르면 라벨 행(하루 종일·시작·종료)으로 펼침 (새 일정은 처음부터 라벨 행) / 맨 아래 '일정 삭제'(기존 일정만).
    시작·종료 값을 누르면 그 행 아래에 휠 선택기(오전/오후 · 시 · 분 5분 단위) */
function EventCard({
  ref,
  date,
  value,
  isNew,
  onChange,
  onCommit,
  onDelete,
}: {
  ref?: React.Ref<HTMLDivElement>;
  date: string;
  value: EditingEvent;
  isNew?: boolean;
  onChange: (v: EditingEvent) => void;
  onCommit: () => void;
  onDelete?: () => void;
}) {
  // 시간 요약 대신 라벨 행 표시. 새 일정은 처음부터 펼쳐 하루 종일 토글을 바로 보여 줌
  const [details, setDetails] = useState(!!isNew);
  const [wheel, setWheel] = useState<"start" | "end" | null>(null);
  const [palette, setPalette] = useState(false);
  const paletteBox = useRef<HTMLDivElement>(null);
  // 하루 종일을 켰다 끄면 이전 시간으로 되돌린다
  const lastTime = useRef<{ time: string; end?: string }>({ time: value.time ?? "09:00", end: value.end });
  const allDay = !value.time;
  const color = eventColor(value.color);
  const endValid = !value.end || !!validEnd(value.time, value.end);

  // 팔레트 바깥을 누르면 닫힘
  useEffect(() => {
    if (!palette) return;
    const onDown = (e: PointerEvent) => {
      if (!paletteBox.current?.contains(e.target as Node)) setPalette(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [palette]);

  const setStart = (t: string) => {
    // 종료가 있으면 길이를 유지한 채 함께 옮긴다 (23:55를 넘지 않게)
    const end = value.time && value.end ? toHHMM(Math.min(LAST_MIN, toMin(value.end) + toMin(t) - toMin(value.time))) : value.end;
    onChange({ ...value, time: t, end });
  };
  const toggleAllDay = () => {
    if (allDay) onChange({ ...value, ...lastTime.current });
    else {
      lastTime.current = { time: value.time!, end: value.end };
      setWheel(null);
      onChange({ ...value, time: undefined, end: undefined });
    }
  };
  const addEnd = () => {
    onChange({ ...value, end: toHHMM(Math.min(LAST_MIN, toMin(value.time!) + 60)) });
    setWheel("end");
  };

  const summary = `${longDate(date)} · ${allDay ? "하루 종일" : value.end ? `${ampm(value.time!)}~${ampm(value.end)}` : ampm(value.time!)}`;
  const labelRow = "grid min-h-11 grid-cols-[64px_1fr] items-center gap-x-4";
  const label = "text-right text-[15px] text-muted";
  const valueBtn = (on: boolean) => `-ml-2 h-9 rounded-lg px-2 text-left text-[15px] tabular-nums transition-colors active:bg-sheet ${on ? "font-semibold text-green" : "text-ink"}`;

  return (
    <div ref={ref} className="px-4" aria-label="일정 상세" role="group">
      {/* 1행: 제목 + 색 */}
      <div className="flex min-h-12 items-center gap-2">
        <input
          autoFocus={isNew}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onCommit();
          }}
          enterKeyHint="done"
          placeholder="제목"
          aria-label={isNew ? "새 일정 제목" : "일정 제목"}
          // 전역 포커스 링(2px, 바깥 2px)은 목록의 둥근 모서리에 잘려 보이므로 끔: 커서만으로 충분 (맥 캘린더처럼)
          data-ring="border"
          className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
        <div ref={paletteBox} className="relative -mr-2 shrink-0">
          <button
            type="button"
            aria-label={`일정 색: ${color.label}`}
            aria-expanded={palette}
            aria-haspopup="true"
            onClick={() => setPalette((p) => !p)}
            className="flex h-9 items-center gap-1 rounded-full px-2 text-muted transition-colors active:bg-sheet"
          >
            <span className={`size-3.5 rounded-full ${color.bg}`} aria-hidden />
            <ChevronDown className="size-4" aria-hidden />
          </button>
          {palette && (
            <div role="radiogroup" aria-label="일정 색" className="absolute top-full right-0 z-10 mt-1 flex rounded-xl border border-line bg-sheet p-1">
              {EVENT_COLORS.map((c) => {
                const on = value.color === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={c.label}
                    onClick={() => {
                      onChange({ ...value, color: c.key });
                      setPalette(false);
                    }}
                    className="flex size-9 items-center justify-center rounded-lg active:bg-raised"
                  >
                    <span className={`flex size-5 items-center justify-center rounded-full ${c.bg}`} aria-hidden>
                      {on && <Check className="size-3 text-sheet" strokeWidth={3.5} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="h-px bg-line" aria-hidden />

      {/* 2행: 시간 요약 → 누르면 라벨 행 */}
      {!details ? (
        <button
          type="button"
          onClick={() => setDetails(true)}
          aria-label={`시간: ${summary}, 눌러서 변경`}
          className="-mx-2 flex min-h-11 w-[calc(100%+16px)] items-center rounded-lg px-2 text-left text-[15px] text-ink tabular-nums active:bg-sheet"
        >
          {summary}
        </button>
      ) : (
        <div className="py-1">
          <div className={labelRow}>
            <span className={label} id={`allday-${value.id}`}>
              하루 종일
            </span>
            <Toggle checked={allDay} onChange={toggleAllDay} labelledBy={`allday-${value.id}`} />
          </div>
          {!allDay && (
            <>
              <div className={labelRow}>
                <span className={label}>시작</span>
                <span>
                  <button type="button" aria-label={`시작 ${ampm(value.time!)}`} aria-expanded={wheel === "start"} onClick={() => setWheel((w) => (w === "start" ? null : "start"))} className={valueBtn(wheel === "start")}>
                    {ampm(value.time!)}
                  </button>
                </span>
              </div>
              {wheel === "start" && <TimeWheel label="시작 시간" value={value.time!} onChange={setStart} />}
              <div className={labelRow}>
                <span className={label}>종료</span>
                {value.end ? (
                  <span className="flex items-center justify-between">
                    <button
                      type="button"
                      aria-label={`종료 ${ampm(value.end)}`}
                      aria-expanded={wheel === "end"}
                      onClick={() => setWheel((w) => (w === "end" ? null : "end"))}
                      className={`${valueBtn(wheel === "end")} ${endValid ? "" : "!text-warn line-through"}`}
                    >
                      {ampm(value.end)}
                    </button>
                    <button
                      type="button"
                      aria-label="종료 시간 지우기"
                      onClick={() => {
                        setWheel(null);
                        onChange({ ...value, end: undefined });
                      }}
                      className="-mr-2 flex size-9 items-center justify-center rounded-full text-muted active:bg-sheet"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </span>
                ) : (
                  <span>
                    <button type="button" onClick={addEnd} className="-ml-2 h-9 rounded-lg px-2 text-left text-[15px] text-muted active:bg-sheet">
                      + 종료 시간
                    </button>
                  </span>
                )}
              </div>
              {wheel === "end" && value.end && <TimeWheel label="종료 시간" value={value.end} onChange={(t) => onChange({ ...value, end: t })} />}
            </>
          )}
        </div>
      )}
      {onDelete && (
        <>
          <div className="h-px bg-line" aria-hidden />
          <button type="button" onClick={onDelete} className="h-11 w-full text-center text-[15px] font-medium text-warn active:bg-sheet">
            일정 삭제
          </button>
        </>
      )}
    </div>
  );
}

/** 토글 스위치 (켜짐 = 민트) */
function Toggle({ checked, onChange, labelledBy }: { checked: boolean; onChange: () => void; labelledBy: string }) {
  return (
    <span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} onClick={onChange} className="flex h-9 items-center">
        <span className={`flex h-[26px] w-[44px] shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? "bg-green" : "bg-dot-empty"}`} aria-hidden>
          <span className={`size-[22px] rounded-full bg-sheet transition-transform ${checked ? "translate-x-[18px]" : ""}`} />
        </span>
      </button>
    </span>
  );
}

const WHEEL_ITEM = 32; // 휠 한 칸 높이. 높이 160px = 5칸, 가운데 칸이 선택
const AP_ITEMS = ["오전", "오후"];
const HOUR_ITEMS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MIN_ITEMS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/** 시간 휠 (브라우저 기본 선택기 대신): 오전/오후 · 1~12 · 00~55(5분). 스크롤 스냅, 멈추는 칸이 바로 값이 된다 */
function TimeWheel({ value, onChange, label }: { value: string; onChange: (t: string) => void; label: string }) {
  const h = Number(value.slice(0, 2));
  const m = Number(value.slice(3, 5));
  const ap = h >= 12 ? 1 : 0;
  const h12 = h % 12 || 12;
  const set = (nap: number, nh12: number, nm: number) => onChange(toHHMM(((nh12 % 12) + nap * 12) * 60 + nm));
  return (
    <div role="group" aria-label={label} className="relative mb-2 grid h-40 grid-cols-[1fr_1fr_1fr] overflow-hidden rounded-xl">
      <div className="pointer-events-none absolute inset-x-1 rounded-lg bg-sheet" style={{ top: (160 - WHEEL_ITEM) / 2, height: WHEEL_ITEM }} aria-hidden />
      <WheelColumn label="오전/오후" items={AP_ITEMS} index={ap} onSelect={(i) => set(i, h12, m)} />
      <WheelColumn label="시" items={HOUR_ITEMS} index={h12 - 1} onSelect={(i) => set(ap, i + 1, m)} />
      <WheelColumn label="분" items={MIN_ITEMS} index={Math.min(11, Math.round(m / 5))} onSelect={(i) => set(ap, h12, i * 5)} />
    </div>
  );
}

function WheelColumn({ items, index, onSelect, label }: { items: string[]; index: number; onSelect: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // 값이 밖에서 바뀌면(처음 열 때·시작을 옮겨 종료가 따라갈 때) 그 칸으로 바로 이동. 사용자가 굴리는 중엔 이미 같은 칸이라 그대로
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && Math.round(el.scrollTop / WHEEL_ITEM) !== index) el.scrollTop = index * WHEEL_ITEM;
  }, [index]);
  const pick = (i: number) => {
    const n = Math.max(0, Math.min(items.length - 1, i));
    if (n !== index) onSelect(n);
  };
  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={index}
      aria-valuemin={0}
      aria-valuemax={items.length - 1}
      aria-valuetext={items[index]}
      onScroll={(e) => pick(Math.round(e.currentTarget.scrollTop / WHEEL_ITEM))}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          pick(index + (e.key === "ArrowUp" ? -1 : 1));
        }
      }}
      className="no-scrollbar no-select relative snap-y snap-mandatory overflow-y-auto overscroll-contain"
      style={{
        paddingBlock: (160 - WHEEL_ITEM) / 2,
        maskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)",
      }}
    >
      {items.map((t, i) => (
        <div
          key={t}
          onClick={() => pick(i)}
          className={`flex snap-center items-center justify-center text-[17px] tabular-nums ${i === index ? "font-semibold text-ink" : "text-muted"}`}
          style={{ height: WHEEL_ITEM }}
          aria-hidden
        >
          {t}
        </div>
      ))}
    </div>
  );
}

/** 일정 한 줄: 왼쪽으로 밀면 오른쪽에 '삭제' 버튼이 드러난다 (누르면 삭제). 다시 오른쪽으로 밀거나 줄을 누르면 닫힘. 세로 스크롤은 그대로 */
function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: ReactNode }) {
  const OPEN = -80;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // 밀린 거리는 ref에도 둔다: 빠른 스와이프에서 touchend가 다시 그리기 전에 와도 최신 값으로 판단
  const start = useRef<{ x: number; y: number; base: number; horizontal: boolean; dx: number } | null>(null);
  const open = dx === OPEN;
  return (
    <li
      className="relative touch-pan-y overflow-hidden"
      onTouchStart={(e) => {
        start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: dx, horizontal: false, dx };
      }}
      onTouchMove={(e) => {
        const s0 = start.current;
        if (!s0) return;
        const d = e.touches[0].clientX - s0.x;
        if (!s0.horizontal && Math.abs(d) > 8 && Math.abs(d) > Math.abs(e.touches[0].clientY - s0.y)) {
          s0.horizontal = true;
          setDragging(true);
        }
        if (s0.horizontal) {
          s0.dx = Math.max(-120, Math.min(0, s0.base + d));
          setDx(s0.dx);
        }
      }}
      onTouchEnd={() => {
        const s0 = start.current;
        start.current = null;
        setDragging(false);
        if (s0?.horizontal) setDx(s0.dx <= OPEN / 2 ? OPEN : 0);
      }}
    >
      <button
        type="button"
        onClick={onDelete}
        tabIndex={-1}
        aria-hidden
        // 밀지 않았을 때는 숨김: 둥근 모서리 가장자리로 빨간색이 비치지 않게
        className={`absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-warn text-sm font-semibold text-bg ${dx === 0 && !dragging ? "invisible" : ""}`}
      >
        삭제
      </button>
      <div
        className={`relative bg-raised ${dragging ? "" : "transition-transform duration-150"}`}
        style={{ transform: `translateX(${dx}px)` }}
        onClickCapture={(e) => {
          // 열려 있을 때 줄을 누르면 수정 대신 닫기
          if (open) {
            e.stopPropagation();
            setDx(0);
          }
        }}
      >
        {children}
      </div>
    </li>
  );
}

function QuickBar({ value, onChange, onDone }: { value: EditTool; onChange: (d: EditTool) => void; onDone: () => void }) {
  const hint =
    value === "erase" ? "누른 날짜의 듀티를 지워요" : value === "none" ? "듀티를 고르고 날짜를 누르세요" : `누른 날짜를 ${value}로 바꿔요`;
  return (
    <div className="fixed inset-x-0 z-20 border-t border-line bg-sheet" style={{ bottom: "calc(var(--spacing-tabbar) + env(safe-area-inset-bottom))" }}>
      <div className="mx-auto max-w-[480px] px-6 pt-4 pb-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {hint}
          </p>
          <Button variant="ghost" className="-mr-4 shrink-0 whitespace-nowrap" onClick={onDone}>
            완료
          </Button>
        </div>
        <DutyButtons label="근무표 수정 도구" value={value} onChange={(d) => onChange(d ?? "none")} erase />
      </div>
    </div>
  );
}
