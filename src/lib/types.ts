/* 데이터 모델 (v1: 간호사 1인 단독 사용)
   환자는 호실-병상("501-1") 또는 호실 전체("503")로만 식별한다. 실명은 입력·저장하지 않는다. */

export type Duty = "D" | "E" | "N";
/** 캘린더 표시용 듀티. OFF·R은 근무가 아님 (R은 병원마다 뜻이 달라 표시만 함) */
export type DutyMark = Duty | "OFF" | "R";

export const isWorkDuty = (d: DutyMark | null | undefined): d is Duty => d === "D" || d === "E" || d === "N";

/** 담당 방식: 지정한 환자만 / 병동 전체(메모에서 언급된 환자가 자동 추가) */
export type Scope = "assigned" | "ward";
/** 표시만 함 (기능 차이 없음) */
export type Role = "acting" | "charge" | null;

export interface Shift {
  id: string;
  /** 근무가 시작된 날짜 YYYY-MM-DD (나이트는 23시가 속한 날) */
  date: string;
  duty: Duty;
  startAt: number;
  endAt: number;
  /** 담당 환자 ID: "501-1"(병상) 또는 "503"(호실 전체) */
  rooms: string[];
  /** 근무 중 뺀 환자. 메모·할 일은 지우지 않고 숨긴다 (다시 추가하면 보임, 메모 자동 추가에서 제외) */
  excluded: string[];
  scope: Scope;
  role: Role;
  status: "active" | "ended";
  endedAt?: number;
  /** [리스트 만들기]를 누른 시각. 없으면 아직 메모 단계 */
  listAt?: number;
  createdAt: number;
}

/** room = 환자 ID, 또는 병동 전체 모드의 공용 메모 "*" */
export interface HandoverMemo {
  id: string;
  shiftId: string;
  room: string;
  text: string;
  updatedAt: number;
}

export const WARD_MEMO = "*";

export type TaskTag = "warning" | "normal";
/** 'audio'는 녹음 확장용 예약값 (이번 버전에서는 만들지 않음) */
export type TaskSource = "memo" | "manual" | "audio";

export interface Task {
  id: string;
  shiftId: string;
  room: string;
  time?: string; // "HH:MM"
  text: string;
  tag: TaskTag;
  source: TaskSource;
  /** 원래 메모 id (source=memo) */
  memoRef?: string;
  /** '환자 미지정'(병동 공용 메모)에서 환자를 지정해 옮긴 경우 원래 room ("*") */
  assignedFrom?: string;
  /** 규칙·AI가 확신하지 못한 항목 → '확인 필요' */
  needsReview: boolean;
  done: boolean;
  doneAt?: number;
  createdAt: number;
}

export type RecordStatus = "draft" | "confirmed";

export interface NurseRecord {
  id: string;
  shiftId: string;
  room: string;
  keywords: string[];
  draftText: string; // "" 이면 아직 생성 전(오프라인 대기)
  finalText: string;
  status: RecordStatus;
  author: string;
  uncertain: string[];
  createdAt: number;
  confirmedAt?: number;
  /** 마지막으로 복사한 시각 — 자동 삭제 기준 */
  copiedAt?: number;
  /** 확정 후 수정 이력: 수정 전 문장들(오래된 순). 원문은 지우지 않는다 */
  editHistory: { text: string; replacedAt: number }[];
  editedAt?: number;
}

export interface RoomText {
  room: string;
  text: string;
}

export interface VerbalItem {
  room: string;
  /** 핵심 3줄 이내 */
  lines: string[];
  warnings: string[];
  /** 미완료 할 일 ("20:00 abx") */
  pending: string[];
}

export interface Handover {
  id: string;
  shiftId: string;
  /** EMR용: 호실별 간호기록체 문단 */
  emrText: RoomText[];
  /** 말로 인계: 호실별 핵심 + 경고 + 미완료 */
  verbalSummary: VerbalItem[];
  recordIds: string[];
  /** 호실별 근거 문장(기록·미완료·경고) — 숫자 검증 기준 */
  sources: Record<string, string[]>;
  /** 호실별 처음 생성된 문장 — 사용자가 새로 쓴 숫자와 AI가 만든 숫자를 구분 */
  generated: Record<string, string>;
  status: RecordStatus;
  createdAt: number;
  confirmedAt?: number;
}

/** 일정 색 (용도 구분용). 듀티 5색과 겹치지 않는 색만 */
export type EventColor = "violet" | "cyan" | "magenta" | "mint" | "orange";

/** 날짜 일정 (날짜마다 여러 개). time 없으면 종일 */
export interface DutyEvent {
  id: string;
  text: string;
  time?: string; // HH:mm
  end?: string; // HH:mm 종료 (time이 있을 때만, time보다 늦음)
  color?: EventColor; // 없으면 violet
  createdAt: number;
}

export interface DutyDay {
  date: string; // YYYY-MM-DD (PK)
  duty: DutyMark | null;
  /** 일정 목록 (이전 버전의 memo 문자열은 v4 업그레이드에서 줄마다 일정으로 옮김) */
  events?: DutyEvent[];
  /** 그날 역할 (차지/액팅). 달력 칸 오른쪽 위에 '차'·'액'으로 표시 */
  role?: Role;
}

export type ThemePref = "auto" | "light" | "dark";

export interface DutyTime {
  start: string; // "HH:MM"
  end: string;
}

export interface Settings {
  author: string;
  theme: ThemePref;
  dutyTimes: Record<Duty, DutyTime>;
  pinHash: string;
  pinSalt: string;
  abbreviationDict: Record<string, string>;
  guideDone: boolean;
  /** 숫자만 쓴 호실 입력 해석: 3자리("5011" → 501-1) / 4자리("12011" → 1201-1) */
  roomDigits: 3 | 4;
  /** 달력 근무 표기: D·E·N·OFF / 데이·이브닝·나이트·오프 */
  dutyLabel: "short" | "korean";
}
