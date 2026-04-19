# UI 구조 개편

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도

현재 화면은 세션이나 프로젝트에 대한 구분이 없어서 필요한 내용을 찾기가 어렵다. Requests와 Conversations를 그룹핑해서 보여주자.

## 전체 웹 구조 변경

Requests와 Conversations는 서로 연관이 없기 때문에 최상위 단계에서 구분하고 UI적으로 확실하게 구분하자.
- 현재 Tab 대신에 Top nav로 분리하고 별도 라우트도 부여하자.
- / 라우트는 requests 로 한다.
- 최초에는 가장 최근 세션을 자동 선택한다.

Requests인 경우에는 Sidebar를 추가하고 Sidebar에서 세션(X-Claude-Code-Session-Id 헤더의 값)을 나열해서 세션을 필터링 기준으로 삼는다.
- X-Claude-Code-Session-Id 헤더 값이 없는 경우에는 'Unknown' 세션 그룹으로 지정한다.
- 세션 목록에는 세션 요청 timestamp의 최초 시작과 세션ID를 함께 보여주자.

Conversations의 경우에는 프로젝트별로 Sidebar에 나열하고 해당 프로젝트에 대한 내용만 보여준다.
- 이미 보여주고 있는 '-Users-syoh-Development-thatseeup-claude-code-proxy' 내용이 프로젝트가 된다.

리로드시에도 현재 페이지를 보여주도록 최대한 노력한다.

## 정렬

각 Sidebar에는 가장 최근에 변화가 있는 경우를 상단에 표시한다. 
Requests의 경우에는 해당 세션의 마지막 요청 timestamp 기준. 표시는 최초 timestamp이어야 메뉴가 바꾸지 않는다.
Conversations의 경우에는 가장 최근 jsonl 파일의 mtime

## 세션 제거

Requests의 경우에는 각 세션 목록 우측에 휴지통 아이콘을 추가해서 클릭하면 관련 내용을 DB에서 제거한다.
기존 최상단 우측에 있던 휴지통을 제거한다.
삭제 확인 대화 상자 불필요.
삭제 후에는 최상단의 세션을 보여준다.
Unknown의 경우에도 일괄 제거한다.

Conversations jsonl 파일은 다른 곳에서 생성한 것이므로 삭제하면 안된다.

## 스키마 재정의

필요하면 스키마를 변경한다. Migration은 고려하지 않아도 된다. 
기존 sqlite 파일 제거 방법 안내만으로 충분하다.
