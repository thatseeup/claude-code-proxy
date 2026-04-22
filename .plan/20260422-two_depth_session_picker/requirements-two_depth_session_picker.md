# Requests 페이지의 session picker를 두 단계로

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도

최근에 session picker에 project 이름과 session title을 추가하였다.
이제 project 별로 session을 그룹핑해서 보여주는 것이 가능하다.

## Picker의 계층화

Project / 세션의 두 단계 구성으로 선택할 수 있게 변경한다.
- 매칭되는 project를 못 찾은 경우에는 Unknown project로 묶는다.
  - sessionId가 없는 경우에는 Unknown session
- 상하 2단계 드롭다운 방식으로 구현한다.
[상위] 프로젝트 선택
┌──────────────────────────────┐
│ claude-code-proxy  (3)       │  ← 세션 수
│ another-project    (1)       │
│ Unknown            (2)       │
└──────────────────────────────┘
[하위] 세션 선택
┌──────────────────────────────┐
│ Session title 1              │
│ abc123-...-full-uuid         │
│ 5 req 2026-04-22 17:38       |
│                              │
│ Session title 2              │
│ def456-...-full-uuid         │
│ 20 req 2026-04-22 17:38      |
└──────────────────────────────┘
- 상위 단계 선택에 따라 하위 세션 선택이 달라진다. 
- 기존 세션 picker에 필터링 옵션이 위에 추가된 것과 같다.
- ?project= URL에 추가해서 리로드시에도 유지되도록 하자.

정렬
- 각 Project의 가장 늦은 세션 시각이 project의 정렬 기준 시각
- 가장 늦은 project 우선 / 가장 늦은 세션 우선

## 세션 picker 카드 변경

현재: 세션ID / <req count> 시각 / Project / session title
변경: Session title / 세션ID / <req count> 시각  

- Project는 project 선택 UI로 이동
- Session title을 강조한다.
- 세션ID는 강조할 필요가 없으며 전체 UUID를 모두 표시한다.
  - 한 줄을 넘으면 마지막 ...으로 한다.


