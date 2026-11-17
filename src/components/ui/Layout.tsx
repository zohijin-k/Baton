"use client";
import type { ReactNode } from "react";
import { CalendarDays, ClipboardList, FilePenLine, SquareCheck, WifiOff } from "lucide-react";

export type TabKey = "tasks" | "record" | "handoff" | "duty";
export const TAB_KEYS: TabKey[] = ["tasks", "record", "handoff", "duty"];

const TABS: { key: TabKey; label: string; icon: typeof FilePenLine }[] = [
  { key: "tasks", label: "할 일", icon: SquareCheck },
  { key: "record", label: "기록", icon: FilePenLine },
  { key: "handoff", label: "인계", icon: ClipboardList },
  { key: "duty", label: "듀티", icon: CalendarDays },
];

/** 탭 아이콘 (하단 탭과 각 탭 상단 바 제목 앞에 같은 아이콘) */
export function TabIcon({ tab }: { tab: TabKey }) {
  const Icon = TABS.find((t) => t.key === tab)!.icon;
  return <Icon className="size-6 shrink-0 text-green" aria-hidden />;
}

/** 하단 탭: 높이 64px + 안전영역. 활성 = 초록 아이콘·라벨 + 아이콘 위 노랑 점 */
export function BottomTabs({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  return (
    <nav className="border-t border-line bg-card pb-safe" aria-label="주요 메뉴">
      <div className="relative mx-auto max-w-[480px]">
        <ul className="flex h-tabbar">
          {TABS.map(({ key, label, icon: Icon }) => {
            const on = key === active;
            return (
              <li key={key} className="flex-1">
                <button
                  type="button"
                  onClick={() => onChange(key)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex h-full w-full flex-col items-center justify-center gap-1 text-xs ${on ? "font-semibold text-green" : "text-tab-off"}`}
                >
                  <span className={`absolute top-1 size-1 rounded-full ${on ? "bg-sun" : "bg-transparent"}`} aria-hidden />
                  <Icon className="size-6" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** 상단 바: 높이 56px, 제목 20px SemiBold. 배경 = 화면 배경, 아래 구분선 항상 표시. icon = 제목 앞 탭 아이콘 */
export function Header({ title, right, left, icon }: { title: ReactNode; right?: ReactNode; left?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className={`mx-auto flex h-14 max-w-[480px] items-center gap-2 pr-3 ${left ? "pl-3" : "pl-6"}`}>
        {left}
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-heading font-semibold">
          {icon}
          <span className="min-w-0 truncate">{title}</span>
        </h1>
        {right}
      </div>
    </header>
  );
}

/** '데모' 배지: 상단 바 오른쪽. 연한 노랑 배경 + 진한 노랑 계열 글자, 12px, 라운드 8px */
export function DemoBadge() {
  return <span className="shrink-0 rounded-lg bg-sun-soft px-2 py-1 text-xs font-semibold text-on-sun-soft">데모</span>;
}

/** 본문 영역: 좌우 24px, 하단 고정 요소만큼 여백 */
export function Content({ children, action = true, tabs = true, className = "" }: { children: ReactNode; action?: boolean; tabs?: boolean; className?: string }) {
  return (
    <div
      className={`mx-auto max-w-[480px] px-6 pt-2 ${className}`}
      style={{
        paddingBottom: `calc(${tabs ? "var(--spacing-tabbar)" : "0px"} + ${action ? "var(--spacing-action)" : "0px"} + 24px + env(safe-area-inset-bottom))`,
      }}
    >
      {children}
    </div>
  );
}

/** 하단 고정 주요 버튼 자리 (탭이 있으면 탭 바로 위, 없으면 화면 맨 아래) */
export function ActionBar({ children, overTabs = true }: { children: ReactNode; overTabs?: boolean }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-20"
      style={{ bottom: overTabs ? "calc(var(--spacing-tabbar) + env(safe-area-inset-bottom))" : "env(safe-area-inset-bottom)" }}
    >
      <div className="pointer-events-auto mx-auto max-w-[480px] bg-gradient-to-t from-bg from-70% to-bg/0 px-6 pt-4 pb-4">{children}</div>
    </div>
  );
}

/** 탭 바를 덮는 전체 화면 (근무 시작 설정처럼 한 번에 끝내는 흐름) */
export function FullScreen({ children }: { children: ReactNode }) {
  return <div className="fixed inset-0 z-40 overflow-y-auto bg-bg">{children}</div>;
}

/** 빈 화면: 원형(노랑 10%) 아이콘 + 제목 + 설명 1줄. 주요 버튼은 ActionBar로 하단 고정 */
export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[calc(100dvh-56px-var(--spacing-tabbar)-var(--spacing-action))] flex-col items-center justify-center px-6 pb-16 text-center">
      <div className="flex size-24 items-center justify-center rounded-full bg-sun-soft text-empty-icon">{icon}</div>
      <h2 className="mt-6 text-heading font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted">{text}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function OfflineBar() {
  return (
    <div className="mx-auto max-w-[480px] px-6 pb-2">
      <div className="flex items-center gap-2 rounded-2xl bg-sun-soft px-4 py-2 text-sm text-on-sun-soft" role="status">
        <WifiOff className="size-4" aria-hidden />
        오프라인 · 입력은 저장돼요
      </div>
    </div>
  );
}

/** 작은 제목 + 내용 (설정 화면 구역) */
export function Field({ label, hint, children, id }: { label: string; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="py-3" aria-labelledby={id}>
      <h2 id={id} className="mb-2 font-semibold">
        {label}
      </h2>
      {children}
      {hint && <div className="mt-2 text-sm text-muted">{hint}</div>}
    </section>
  );
}
