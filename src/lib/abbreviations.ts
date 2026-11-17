/** 기본 약어 사전 (설정에서 편집 가능) */
export const DEFAULT_DICT: Record<string, string> = {
  BT: "체온",
  BP: "혈압",
  PR: "맥박",
  RR: "호흡수",
  SpO2: "산소포화도",
  NRS: "통증점수",
  IV: "정맥주사",
  PO: "경구",
  NPO: "금식",
  BST: "혈당검사",
  "I/O": "섭취배설량",
  O2: "산소",
  NC: "비강캐뉼라",
  prn: "필요시",
  qd: "하루 1회",
  bid: "하루 2회",
  tid: "하루 3회",
  hs: "취침 전",
  ac: "식전",
  pc: "식후",
  Foley: "유치도뇨관",
  "JP drain": "배액관",
  PCA: "자가통증조절기",
  ABx: "항생제",
  CBC: "일반혈액검사",
  EKG: "심전도",
  CXR: "흉부 X선",
  "c/o": "호소",
  "f/u": "추적관찰",
  "r/o": "감별진단",
  ADL: "일상생활동작",
  "s/p": "수술 후",
};

export interface QuickChip {
  label: string;
  /** 값이 필요한 칩은 "BT " 처럼 입력창에 이어 쓰기, 아니면 켜고 끄기 */
  needsValue: boolean;
}

export const QUICK_CHIPS: QuickChip[] = [
  { label: "BT", needsValue: true },
  { label: "BP", needsValue: true },
  { label: "PR", needsValue: true },
  { label: "SpO2", needsValue: true },
  { label: "IV", needsValue: true },
  { label: "PO", needsValue: true },
  { label: "NPO", needsValue: false },
  { label: "통증", needsValue: true },
  { label: "낙상주의", needsValue: false },
  { label: "수면", needsValue: false },
  { label: "식사", needsValue: false },
  { label: "배뇨", needsValue: false },
];

/** 키워드 입력 문자열 ↔ 배열 */
export const splitKeywords = (text: string) =>
  text
    .split(/[,\n]|\s+\/\s+/) // 쉼표·줄바꿈·" / " 로 구분 (BP 120/80의 /는 유지)
    .map((s) => s.trim())
    .filter(Boolean);

export const hasToken = (text: string, label: string) =>
  splitKeywords(text).some((k) => k === label || k.startsWith(label + " "));

/** 마지막 단어 기준 자동완성 후보 */
export function suggest(text: string, dict: Record<string, string>, limit = 5) {
  const m = text.match(/([^\s,]+)$/);
  if (!m) return [];
  const q = m[1].toLowerCase();
  if (/^[\d./%]+$/.test(q)) return [];
  const out: { abbr: string; meaning: string }[] = [];
  for (const [abbr, meaning] of Object.entries(dict)) {
    const a = abbr.toLowerCase();
    if ((a.startsWith(q) && a !== q) || meaning.startsWith(m[1])) out.push({ abbr, meaning });
    if (out.length >= limit) break;
  }
  return out;
}

export function applySuggestion(text: string, abbr: string) {
  return text.replace(/([^\s,]+)$/, abbr + " ");
}

/** 입력에 쓰인 약어만 골라서 LLM에 참고로 전달 */
export function relevantDict(keywords: string[], dict: Record<string, string>) {
  const joined = " " + keywords.join(" ") + " ";
  const out: Record<string, string> = {};
  for (const [abbr, meaning] of Object.entries(dict)) {
    const re = new RegExp(`(^|[^A-Za-z])${abbr.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}($|[^A-Za-z])`, "i");
    if (re.test(joined)) out[abbr] = meaning;
  }
  return out;
}
