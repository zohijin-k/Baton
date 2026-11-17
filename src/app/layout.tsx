import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

export const metadata: Metadata = {
  title: "바통 — 간호 기록·인계",
  description: "키워드로 간호기록을 쓰고, 인계노트와 다음 근무 할 일까지 이어주는 보조 앱",
  applicationName: "바통",
  appleWebApp: { capable: true, title: "바통", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#111214" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};

/* 첫 그리기 전에 테마 결정 (깜빡임 방지). 기본 = 어둡게, auto = 시스템 설정 따르기 */
const themeScript = `(function(){var t='dark';try{t=localStorage.getItem('baton-theme')||'dark';}catch(e){}try{var d=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='dark';}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" data-theme="dark" className={`${pretendard.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
