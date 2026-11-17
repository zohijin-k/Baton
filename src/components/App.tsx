"use client";
import { useEffect, useState } from "react";
import { Info, Settings as SettingsIcon, X } from "lucide-react";
import { liveQuery } from "dexie";
import { db } from "@/lib/db";
import { AUTO_END_NOTICE, type AutoEndNotice } from "@/lib/purge";
import { shortDate } from "@/lib/time";
import { SessionProvider, useSession } from "./session";
import { BottomTabs, DemoBadge, TAB_KEYS, type TabKey } from "./ui/Layout";
import { IconButton } from "./ui/Button";
import { Toaster } from "./ui/Overlay";
import { LockScreen, Onboarding } from "./screens/Gate";
import { TasksTab } from "./screens/TasksTab";
import { RecordTab } from "./screens/RecordTab";
import { HandoffTab } from "./screens/HandoffTab";
import { DutyTab } from "./screens/DutyTab";
import { Settings } from "./screens/Settings";

export function App() {
  return (
    <SessionProvider>
      <Shell />
      <Toaster />
    </SessionProvider>
  );
}

function Shell() {
  const { phase, mode } = useSession();
  // 마지막 탭 기억 (탭 화면은 잠금 해제 후에만 그려지므로 서버 렌더와 어긋나지 않음)
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const t = localStorage.getItem("baton-tab") as TabKey | null;
      if (t && TAB_KEYS.includes(t)) return t;
    } catch {}
    return "tasks";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 서비스 워커 (오프라인 실행) — 운영 빌드에서만
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
  }, []);

  const changeTab = (t: TabKey) => {
    setTab(t);
    setSettingsOpen(false);
    window.scrollTo(0, 0);
    try {
      localStorage.setItem("baton-tab", t);
    } catch {}
  };

  // 설정을 읽는 잠깐 동안은 빈 화면 (로고 화면 없이 바로 잠금·시작 화면으로)
  if (phase === "splash") return null;
  if (phase === "onboarding") return <Onboarding />;
  if (phase === "locked") return <LockScreen />;

  const demo = mode === "demo" && <DemoBadge />;
  const settingsButton = (
    <IconButton label="설정" onClick={() => setSettingsOpen(true)}>
      <SettingsIcon className="size-6" />
    </IconButton>
  );
  const headerRight = (
    <>
      {demo}
      {settingsButton}
    </>
  );

  return (
    <div className="min-h-dvh">
      <AutoEndBanner />
      <main>
        {settingsOpen ? (
          <Settings onClose={() => setSettingsOpen(false)} />
        ) : tab === "tasks" ? (
          <TasksTab headerRight={headerRight} />
        ) : tab === "record" ? (
          <RecordTab headerRight={headerRight} goTasks={() => changeTab("tasks")} />
        ) : tab === "handoff" ? (
          <HandoffTab headerRight={headerRight} goRecord={() => changeTab("record")} goTasks={() => changeTab("tasks")} />
        ) : (
          <DutyTab headerRight={settingsButton} demo={demo} />
        )}
      </main>
      <div className="fixed inset-x-0 bottom-0 z-30">
        <BottomTabs active={tab} onChange={changeTab} />
      </div>
    </div>
  );
}

/** 자동 종료된 근무가 있으면 상단에 한 번 안내. 보여주는 즉시 저장된 안내는 지워 다시 뜨지 않게 한다 */
function AutoEndBanner() {
  const [notice, setNotice] = useState<AutoEndNotice | null>(null);
  useEffect(() => {
    const sub = liveQuery(() => db.kv.get(AUTO_END_NOTICE)).subscribe((row) => {
      const v = row?.value as AutoEndNotice | undefined;
      if (!v) return;
      setNotice(v);
      db.kv.delete(AUTO_END_NOTICE).catch(() => {});
    });
    return () => sub.unsubscribe();
  }, []);
  if (!notice) return null;
  return (
    <div role="status" className="fixed inset-x-0 z-40 px-4" style={{ top: "calc(env(safe-area-inset-top) + 60px)" }}>
      <div className="animate-rise mx-auto flex max-w-[448px] items-center gap-3 rounded-2xl bg-toast-bg py-1 pr-1 pl-4 text-toast-ink">
        <Info className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 py-2 font-medium">
          지난 근무({shortDate(notice.date)} {notice.duty})가 자동 종료됐어요
        </span>
        <button type="button" aria-label="안내 닫기" onClick={() => setNotice(null)} className="flex size-12 shrink-0 items-center justify-center rounded-xl active:opacity-70">
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
