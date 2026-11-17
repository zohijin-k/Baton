import type { ReactNode } from "react";

/** 해바라기 + 십자 로고 (assets/icon.svg와 같은 도형). 시작·PIN·잠금 화면 전용 */
export function LogoMark({ size = 80, className = "" }: { size?: number; className?: string }) {
  const petals = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} role="img" aria-label="바통">
      <g fill="#F2C14E">
        {petals.map((r) => (
          <ellipse key={r} cx="256" cy="118" rx="44" ry="92" transform={`rotate(${r} 256 256)`} />
        ))}
      </g>
      <g fill="#E8A93A">
        {petals.map((r) => (
          <ellipse key={r} cx="256" cy="140" rx="30" ry="70" transform={`rotate(${r + 15} 256 256)`} />
        ))}
      </g>
      <circle cx="256" cy="256" r="96" fill="#3F6E5A" />
      <path d="M232 196h48v36h36v48h-36v36h-48v-36h-36v-48h36z" fill="#FCF5EA" stroke="#FCF5EA" strokeWidth="10" strokeLinejoin="round" />
    </svg>
  );
}

/** 로고 뒤 노랑 원형 빛 번짐 (고정, 움직임 없음). 지름 기본 200px. 세기는 테마별 --glow */
export function LogoGlow({ children, size = 200 }: { children: ReactNode; size?: number }) {
  return (
    <div className="relative flex items-center justify-center">
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{ width: size, height: size, background: "radial-gradient(circle, var(--glow) 0%, transparent 70%)" }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
