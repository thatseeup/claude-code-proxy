# UI 구조 개편

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도

현재 웹 화면은 1개의 SESSION에 대해서 REQUESTS와 REQUEST DETAILS가 수직으로 배열되었고 1개의 PROJECT에 대해서 CONVERSATIONS와 CONVERSATION이 수직으로 배열되어 보기에 불편하다.

## Sidebar

현재 Sidebar는 고정폭을 차지하고 있지만 SESSION이나 PROJECT를 선택한 이후에는 계속 자리를 차지할 필요가 없다.

열고 닫을 수 있는 형태로 변경하라.
- 열고 닫힘 상태는 저장할 필요없다. 최초 상태는 열림이다.
- 수동 닫힘이다.

## REQUEST 2단 구성

현재의 REQUESTS, REQUEST DETAILS의 수직 구성을 좌: 리스트, 우: 상세 구성으로 변경.
- 리스트 패널은 폭 조절 가능. 드래그 splitter
- 조절한 값은 저장할 필요없다. 리로드하면 디폴트.

## CONVERSATION 2단 구성

현재의 CONVERSATIONS, CONVERSATION의 수직 구성을 좌: 리스트, 우: 상세 구성으로 변경.
- 세부 UI 내용은 REQUEST 2단 구성과 동일하다.

