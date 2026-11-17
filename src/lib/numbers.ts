/* 출력 숫자 검증: LLM이 입력에 없는 숫자를 만들면 확정을 막는다. */

const NUM_RE = /\d+(?:\.\d+)?/g;

/** "07" → "7", "36.80" → "36.8" 처럼 정규화 */
const norm = (s: string) => String(Number(s));

export function numbersIn(text: string): string[] {
  return (text.match(NUM_RE) ?? []).map(norm);
}

/** 초안에서 입력(키워드)에 없는 숫자 */
export function inventedNumbers(draft: string, keywords: string[]): string[] {
  const allowed = new Set(numbersIn(keywords.join(" ")));
  return [...new Set(numbersIn(draft).filter((n) => !allowed.has(n)))];
}

/**
 * 현재 편집 중인 문장에 '초안이 만들어낸 숫자'가 남아 있으면 확정 차단.
 * 사용자가 직접 새로 입력한 숫자는 사용자의 입력이므로 허용한다.
 */
export function blockingNumbers(current: string, draft: string, keywords: string[]): string[] {
  const invented = new Set(inventedNumbers(draft, keywords));
  if (invented.size === 0) return [];
  return [...new Set(numbersIn(current).filter((n) => invented.has(n)))];
}

/** 문장을 [일반, 강조] 조각으로 나눔 (경고 숫자 강조 표시용) */
export function splitByNumbers(text: string, targets: string[]) {
  const set = new Set(targets);
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(NUM_RE)) {
    const i = m.index ?? 0;
    if (set.has(norm(m[0]))) {
      if (i > last) parts.push({ text: text.slice(last, i), hit: false });
      parts.push({ text: m[0], hit: true });
      last = i + m[0].length;
    }
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}
