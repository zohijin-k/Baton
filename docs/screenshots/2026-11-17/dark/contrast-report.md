# 다크 모드 화면 · 대비 측정 (2026-11-17)

- 화면 360×740, 기기 설정 '밝게' 상태에서 첫 실행 → 앱 기본값(어둡게)
- 기준: 모든 글자 4.5:1 이상 (비활성 버튼 글자는 WCAG 예외라 따로 표시)
- 배경은 겹친 레이어·투명도·opacity를 합성한 실제 색으로 계산

| 화면 | 테마 | 측정 글자 | 최저 대비 | 4.5 미만 | 가로 스크롤 |
|---|---|---|---|---|---|
| 01-splash | dark | 1 | 15.66 | 0 | 없음 |
| 02-pin-setup | dark | 12 | 7.08 | 0 | 없음 |
| 03-name-empty | dark | 3 | 5.99 | 0 | 없음 |
| 04-name-filled | dark | 3 | 4.60 | 0 | 없음 |
| 05-guide | dark | 4 | 4.60 | 0 | 없음 |
| 06-record-empty | dark | 8 | 4.60 | 0 | 없음 |
| 07-handoff-empty | dark | 8 | 4.60 | 0 | 없음 |
| 08-receive-empty | dark | 8 | 4.60 | 0 | 없음 |
| 09-add-patient | dark | 8 | 4.60 | 0 | 없음 |
| 10-keywords | dark | 27 | 4.60 | 0 | 없음 |
| 11-pii-sheet | dark | 7 | 4.60 | 0 | 없음 |
| 12-draft | dark | 12 | 4.60 | 0 | 없음 |
| 13-confirm-dialog | dark | 4 | 4.60 | 0 | 없음 |
| 14-number-block | dark | 13 | 4.60 | 0 | 없음 |
| 15-record-list | dark | 19 | 4.60 | 0 | 없음 |
| 16-handoff-select | dark | 13 | 4.60 | 0 | 없음 |
| 17-sbar-draft | dark | 12 | 4.60 | 0 | 없음 |
| 18-shared | dark | 19 | 4.60 | 0 | 없음 |
| 19-share-sheet | dark | 4 | 5.34 | 0 | 없음 |
| 20-tasks | dark | 17 | 4.60 | 0 | 없음 |
| 21-settings | dark | 14 | 4.60 | 0 | 없음 |
| 22-lock | dark | 12 | 7.08 | 0 | 없음 |

**결과: 4.5:1 미만 0건**

## 비활성 요소 (기준 예외)

| 화면 | 글자 | 글자색 | 배경 | 대비 |
|---|---|---|---|---|
| 03-name-empty | 다음 | #5e6661 | #1e2420 | 2.67 |
| 14-number-block | 확인 | #5e6661 | #1e2420 | 2.67 |
| 15-record-list | 문장 만들기 | #5e6661 | #1e2420 | 2.67 |
