# 라이트 모드 화면 · 대비 측정 (2026-11-17)

- 화면 360×740, 기기 설정 '어둡게' 상태에서 앱 테마 '밝게' 지정
- 기준: 모든 글자 4.5:1 이상 (비활성 버튼 글자는 WCAG 예외라 따로 표시)
- 배경은 겹친 레이어·투명도·opacity를 합성한 실제 색으로 계산

| 화면 | 테마 | 측정 글자 | 최저 대비 | 4.5 미만 | 가로 스크롤 |
|---|---|---|---|---|---|
| 01-splash | light | 1 | 12.35 | 0 | 없음 |
| 02-pin-setup | light | 12 | 5.10 | 0 | 없음 |
| 03-name-empty | light | 3 | 4.59 | 0 | 없음 |
| 04-name-filled | light | 3 | 5.10 | 0 | 없음 |
| 05-guide | light | 4 | 5.10 | 0 | 없음 |
| 06-record-empty | light | 8 | 4.63 | 0 | 없음 |
| 07-handoff-empty | light | 8 | 4.63 | 0 | 없음 |
| 08-receive-empty | light | 8 | 4.63 | 0 | 없음 |
| 09-add-patient | light | 8 | 4.63 | 0 | 없음 |
| 10-keywords | light | 27 | 4.59 | 0 | 없음 |
| 11-pii-sheet | light | 7 | 5.61 | 0 | 없음 |
| 12-draft | light | 12 | 4.63 | 0 | 없음 |
| 13-confirm-dialog | light | 4 | 5.61 | 0 | 없음 |
| 14-number-block | light | 13 | 4.63 | 0 | 없음 |
| 15-record-list | light | 19 | 4.59 | 0 | 없음 |
| 16-handoff-select | light | 13 | 4.63 | 0 | 없음 |
| 17-sbar-draft | light | 12 | 4.63 | 0 | 없음 |
| 18-shared | light | 19 | 4.63 | 0 | 없음 |
| 19-share-sheet | light | 4 | 5.61 | 0 | 없음 |
| 20-tasks | light | 17 | 4.63 | 0 | 없음 |
| 21-settings | light | 14 | 4.59 | 0 | 없음 |
| 22-lock | light | 12 | 5.10 | 0 | 없음 |

**결과: 4.5:1 미만 0건**

## 비활성 요소 (기준 예외)

| 화면 | 글자 | 글자색 | 배경 | 대비 |
|---|---|---|---|---|
| 03-name-empty | 다음 | #918e87 | #ece8e0 | 2.68 |
| 14-number-block | 확인 | #918e87 | #ece8e0 | 2.68 |
| 15-record-list | 문장 만들기 | #918e87 | #ece8e0 | 2.68 |
