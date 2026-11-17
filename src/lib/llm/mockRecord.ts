/* 데모 모드 기록 문장: 키워드를 간호기록체로 바꾼다 (API 키 없이 동작).
   원칙: 입력에 없는 사실·수치·약물을 만들지 않고, 숫자는 입력 그대로 둔다.
   예) "통증 NRS 6 / PRN 진통제 IV / 30분 후 NRS 3"
     → "통증 NRS 6점 호소하여 PRN 진통제 IV 투여함. 30분 후 NRS 3점으로 감소함." */
import type { RecordOut } from "./schemas";

type Clause =
  | { kind: "pain"; text: string; stem: string; score?: number; prefix?: string }
  | { kind: "med"; text: string; prefix?: string }
  | { kind: "other"; text: string; prefix?: string };

const ROUTE = /(?<![A-Za-z])(IV|PO|IM|SC|SL)(?![A-Za-z])/i;
const MED_WORD = /PRN|진통제|해열제|항생제|인슐린|항구토제|수면제|이뇨제|ABx/i;
/** 이 말로 끝나면 "~함"을 붙여 문장으로 만든다 */
const ACTION_END = /(면담|교육|설명|확인|관찰|시행|투여|교체|제거|소독|드레싱|체위\s?변경|흡인|보고|측정|격려|적용|교환)$/;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
/** 받침 유무에 따라 "로/으로" */
const ro = (word: string) => {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return "로"; // 한글이 아니면(숫자·영문) "로"
  const jong = code % 28;
  return jong === 0 || jong === 8 ? "로" : "으로"; // 받침 없음 또는 ㄹ받침
};

function vital(tok: string): string | null {
  let m;
  if ((m = tok.match(/^(?:BT|체온)\s*([\d.]+)\s*(?:℃|도|C)?$/i))) return `체온 ${m[1]}℃`;
  if ((m = tok.match(/^(?:BP|혈압)\s*(\d+\s*\/\s*\d+)\s*(?:mmHg)?$/i))) return `혈압 ${m[1].replace(/\s/g, "")}mmHg`;
  if ((m = tok.match(/^(?:PR|HR|맥박)\s*(\d+)\s*(?:회)?$/i))) return `맥박 ${m[1]}회/분`;
  if ((m = tok.match(/^(?:RR|호흡)\s*(\d+)\s*(?:회)?$/i))) return `호흡 ${m[1]}회/분`;
  if ((m = tok.match(/^(?:SpO2|산소포화도)\s*(\d+)\s*%?$/i))) return `산소포화도 ${m[1]}%`;
  return null;
}

function pain(tok: string): { stem: string; score?: number } | null {
  let m;
  // "통증 NRS 6", "NRS 6", "통증 6 복부", "복부 통증 6", "통증 6점"
  if ((m = tok.match(/^(?:(.+?)\s+)?(?:통증\s*)?NRS\s*(\d{1,2})\s*점?\s*(.*)$/i)) || (m = tok.match(/^(?:(.+?)\s+)?통증\s*(\d{1,2})\s*점?\s*(.*)$/))) {
    const site = clean(`${m[1] ?? ""} ${m[3] ?? ""}`.replace(/통증/g, ""));
    return { stem: `${site ? `${site} ` : ""}통증 NRS ${m[2]}점 호소`, score: Number(m[2]) };
  }
  if ((m = tok.match(/^(?:(.+?)\s+)?통증\s*(.*)$/))) {
    const site = clean(`${m[1] ?? ""}`);
    const tail = clean(m[2] ?? "");
    if (/^(없음|무)$/.test(tail)) return { stem: `${site ? `${site} ` : ""}통증 호소 없음` };
    return { stem: `${site ? `${site} ` : ""}${tail ? `${tail} ` : ""}통증 호소` };
  }
  return null;
}

function other(tok: string): string | null {
  let m;
  // 혈당
  if ((m = tok.match(/^(식전|식후|공복)?\s*(?:BST|혈당)\s*(\d+)\s*(?:mg\/dL)?\s*(식전|식후|공복|ac|pc)?$/i))) {
    const when = (m[1] || m[3] || "").replace(/^ac$/i, "식전").replace(/^pc$/i, "식후");
    return `${when ? `${when} ` : ""}혈당 ${m[2]}mg/dL 확인함`;
  }
  // 낙상
  if ((m = tok.match(/^낙상\s*(주의|고위험|위험)?\s*(교육)?$/))) {
    if (m[2]) return "낙상 예방 교육 시행함";
    return m[1] === "고위험" ? "낙상 고위험으로 주의 요함" : "낙상 위험 있어 주의 요함";
  }
  // 금식
  if ((m = tok.match(/^(?:NPO|금식)\s*(.*)$/i))) {
    const tail = clean(m[1].replace(/유지|중/g, ""));
    if (/해제/.test(tail)) return "금식(NPO) 해제됨";
    return `${tail ? `${tail} ` : ""}금식(NPO) 유지 중임`;
  }
  // 수면
  if ((m = tok.match(/^수면\s*(.*)$/))) {
    const t = clean(m[1]);
    if (!t) return "수면 상태 관찰함";
    if (/^(양호|좋음|숙면)$/.test(t)) return "수면 양호함";
    if (/^(불량|나쁨)$/.test(t)) return "수면 불량함";
    if (/^(부족|못\s?잠|못\s?함|어려움|장애)$/.test(t)) return "수면 어려움 호소함";
    if (/^\d+(\.\d+)?\s*시간$/.test(t)) return `${t} 수면 취함`;
    return `수면 ${t} 관찰됨`;
  }
  // 식사
  if ((m = tok.match(/^식사\s*(.*)$/))) {
    const t = clean(m[1]);
    if (!t) return "식사 상태 관찰함";
    if (/^(\d+\/\d+|전량|반|절반)$/.test(t)) return `식사 ${t} 섭취함`;
    if (/^(양호|좋음)$/.test(t)) return "식사 양호함";
    if (/^거부$/.test(t)) return "식사 거부함";
    if (/^(불량|저하|부진)$/.test(t)) return `식사 섭취 ${t}함`;
    return `식사 ${t} 관찰됨`;
  }
  // 배뇨
  if ((m = tok.match(/^배뇨\s*(.*)$/))) {
    const t = clean(m[1]);
    if (!t) return "배뇨 상태 관찰함";
    let n;
    if ((n = t.match(/^(\d+)\s*(cc|ml|mL)?$/))) return `배뇨량 ${n[1]}${n[2] ?? ""} 확인함`;
    if (/^(양호|자가|자가\s?배뇨)$/.test(t)) return "자가 배뇨 양호함";
    if (/^(곤란|어려움|불편)$/.test(t)) return `배뇨 ${t} 호소함`;
    return `배뇨 ${t} 관찰됨`;
  }
  // 수액
  if ((m = tok.match(/^수액\s*(.*)$/))) {
    const t = clean(m[1]);
    if (!t) return "수액 주입 중임";
    const rest = clean(t.replace(/교체|유지|중단|제거/g, ""));
    const lead = rest ? `${rest} ` : "";
    if (/교체/.test(t)) return `${lead}수액 교체함`;
    if (/중단/.test(t)) return `${lead}수액 주입 중단함`;
    if (/제거/.test(t)) return `${lead}수액 제거함`;
    if (/유지/.test(t)) return `${lead}수액 주입 유지함`;
    return `${t}${ro(t)} 수액 주입 중임`;
  }
  // 산소
  if ((m = tok.match(/^O2\s*(.*)$/i))) return `산소 ${clean(m[1]) ? `${clean(m[1])} ` : ""}적용 중임`;
  return null;
}

function med(tok: string): string | null {
  const route = tok.match(ROUTE)?.[1];
  if (!route && !MED_WORD.test(tok)) return null;
  const drug = clean(tok.replace(ROUTE, "").replace(/투여|주사/g, ""));
  if (!drug) return null;
  return `${drug}${route ? ` ${route.toUpperCase()}` : ""} 투여함`;
}

export function mockRecord(keywords: string[], dict: Record<string, string>): RecordOut {
  const vitals: string[] = [];
  const clauses: Clause[] = [];
  const uncertain: string[] = [];
  let demoInvent = false;

  // "a / b / c" 형태도 나눠서 처리
  const tokens = keywords.flatMap((k) => k.split(/\s+\/\s+/)).map(clean).filter(Boolean);

  for (const raw of tokens) {
    if (raw === "#검증") {
      demoInvent = true; // 숫자 검증 데모용: 일부러 입력에 없는 숫자를 넣음
      continue;
    }
    // "30분 후 …", "1시간 후 …"
    const pm = raw.match(/^(\d+\s*(?:분|시간)\s*(?:후|뒤))\s+(.+)$/);
    const prefix = pm?.[1];
    const tok = pm ? pm[2] : raw;

    const v = !prefix && vital(tok);
    if (v) {
      vitals.push(v);
      continue;
    }
    const p = pain(tok);
    if (p) {
      clauses.push({ kind: "pain", stem: p.stem, score: p.score, prefix, text: `${p.stem}함` });
      continue;
    }
    const o = other(tok) ?? (vital(tok) ? `${vital(tok)} 측정됨` : null);
    if (o) {
      clauses.push({ kind: "other", text: o, prefix });
      continue;
    }
    const md = med(tok);
    if (md) {
      clauses.push({ kind: "med", text: md, prefix });
      continue;
    }
    // 그 밖의 말: 행위로 끝나면 "~함", 이미 서술형이면 그대로, 아니면 "~ 관찰됨"
    if (/(함|임|됨)$/.test(tok)) clauses.push({ kind: "other", text: tok, prefix });
    else if (ACTION_END.test(tok)) clauses.push({ kind: "other", text: `${tok}함`, prefix });
    else if (/[가-힣]/.test(tok)) clauses.push({ kind: "other", text: `${tok} 관찰됨`, prefix });
    else {
      const known = Object.keys(dict).some((a) => tok.toLowerCase().startsWith(a.toLowerCase()));
      if (!known) uncertain.push(tok);
      clauses.push({ kind: "other", text: `${tok} 확인함`, prefix });
    }
  }

  // 문장 조립: 통증 → 투약은 "~하여"로 잇고, "N분 후 통증"은 이전 점수와 비교
  const parts: string[] = [];
  let lastScore: number | undefined;
  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i];
    const next = clauses[i + 1];
    if (c.kind === "pain" && !c.prefix && next?.kind === "med" && !next.prefix) {
      parts.push(`${c.stem}하여 ${next.text}`);
      lastScore = c.score ?? lastScore;
      i++;
      continue;
    }
    if (c.kind === "pain" && c.prefix && c.score !== undefined) {
      const head = `${c.prefix} NRS ${c.score}점`;
      if (lastScore === undefined) parts.push(`${c.prefix} 통증 NRS ${c.score}점임`);
      else if (c.score < lastScore) parts.push(`${head}으로 감소함`);
      else if (c.score > lastScore) parts.push(`${head}으로 증가함`);
      else parts.push(`${head}으로 변화 없음`);
      lastScore = c.score;
      continue;
    }
    if (c.kind === "pain") lastScore = c.score ?? lastScore;
    parts.push(c.prefix ? `${c.prefix} ${c.text}` : c.text);
  }

  const sentences: string[] = [];
  if (vitals.length) sentences.push(`활력징후 ${vitals.join(", ")} 측정됨.`);
  const slots = 3 - sentences.length;
  if (parts.length <= slots) parts.forEach((p) => sentences.push(`${p}.`));
  else {
    // 3문장을 넘으면 쉼표로 묶어 나눔
    const size = Math.ceil(parts.length / slots);
    for (let i = 0; i < parts.length; i += size) sentences.push(`${parts.slice(i, i + size).join(", ")}.`);
  }
  if (demoInvent) sentences.push("체온 37.5℃로 재측정 예정임.");
  return { sentence: sentences.join(" "), uncertain };
}
