"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getSettings, saveSettings, DEFAULT_SETTINGS } from "@/lib/db";
import { hashPin, randomSalt, safeEqual } from "@/lib/crypto";
import { purgeExpired, PURGE_INTERVAL } from "@/lib/purge";
import { setRoomDigits } from "@/lib/room";
import type { Settings, ThemePref } from "@/lib/types";

type Phase = "splash" | "onboarding" | "locked" | "ready";

interface Session {
  phase: Phase;
  settings: Settings;
  mode: "demo" | "live" | null;
  online: boolean;
  setupPin: (pin: string) => Promise<void>;
  unlock: (pin: string) => Promise<boolean>;
  lock: () => void;
  update: (patch: Partial<Settings>) => Promise<void>;
  finishOnboarding: () => void;
}

const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("SessionProvider 필요");
  return s;
};

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

const AUTO_LOCK_MS = 5 * 60 * 1000;

export function applyTheme(pref: ThemePref) {
  try {
    localStorage.setItem("baton-theme", pref);
  } catch {}
  const dark = pref === "dark" || (pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** 자동 삭제: 앱을 열 때 + 1시간마다 + 화면으로 돌아올 때 */
function usePurgeSchedule() {
  useEffect(() => {
    const run = () => purgeExpired().catch(() => {});
    run();
    const id = setInterval(run, PURGE_INTERVAL);
    const onVis = () => !document.hidden && run();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("splash");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [mode, setMode] = useState<Session["mode"]>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const hiddenAt = useRef<number | null>(null);
  usePurgeSchedule();

  // 숫자만 쓴 호실 입력 해석 기준 (room.ts 모듈 설정)
  useEffect(() => setRoomDigits(settings.roomDigits), [settings.roomDigits]);

  // 시작: 설정을 읽고 바로 잠금·시작 화면으로 (로고 화면 없음)
  useEffect(() => {
    getSettings().then(async (s) => {
      // 첫 실행(PIN 전)에는 머리 스크립트가 이미 적용한 테마를 그대로 이어받아 저장
      if (!s.pinHash) {
        let stored: string | null = null;
        try {
          stored = localStorage.getItem("baton-theme");
        } catch {}
        if ((stored === "light" || stored === "dark" || stored === "auto") && stored !== s.theme) s = await saveSettings({ theme: stored });
      }
      setSettings(s);
      applyTheme(s.theme);
      setPhase(s.pinHash ? "locked" : "onboarding");
    });
  }, []);

  // 데모/실제 모드 확인
  useEffect(() => {
    fetch("/api/generate")
      .then((r) => r.json())
      .then((j) => setMode(j.mode))
      .catch(() => setMode(null));
  }, [online]);

  // 자동 테마: 시스템 설정이 바뀌면 바로 따라감
  useEffect(() => {
    if (settings.theme !== "auto") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("auto");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings.theme]);

  const lock = useCallback(() => {
    setPhase((p) => (p === "ready" ? "locked" : p));
  }, []);

  // 백그라운드 5분 이상이면 잠금
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > AUTO_LOCK_MS) lock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [lock]);

  const setupPin = useCallback(async (pin: string) => {
    const pinSalt = randomSalt();
    const pinHash = await hashPin(pin, pinSalt);
    setSettings(await saveSettings({ pinSalt, pinHash }));
  }, []);

  const unlock = useCallback(async (pin: string) => {
    const s = await getSettings();
    const h = await hashPin(pin, s.pinSalt);
    if (!safeEqual(h, s.pinHash)) return false;
    setSettings(s);
    setPhase("ready");
    return true;
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    if (patch.theme) applyTheme(patch.theme);
  }, []);

  const finishOnboarding = useCallback(() => setPhase("ready"), []);

  const value = useMemo<Session>(
    () => ({ phase, settings, mode, online, setupPin, unlock, lock, update, finishOnboarding }),
    [phase, settings, mode, online, setupPin, unlock, lock, update, finishOnboarding],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
