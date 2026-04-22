# Projects/Sessions 매칭

/o-implementation-plan의 입력으로 제공할 파일이다.

## 문제점

전체적인 계층 구조는 다음과 같다. 
Projects(directory) > Sessions > Requests

현재 Web 페이지는 크게 다음 두개로 구성되어 있는데 서로 독립적이다.
- Conversations: ~/.claude/projects 내용
- Requests: API 수집

이 둘은 Session ID라는 공통 분모가 있지만 이 둘을 연결시키지는 못하고 있다. 

## Conversations 페이지

Conversations에 개별 세션 페이지에 해당 Request로 가는 바로가기 추가
- /requests/:sessionId로 이동
- 개별 세션에 Request 바로가기 추가한다.
  - 왼쪽 페인의 세션 목록 카드의 title 우측에 버튼 추가
  - 우측 페인의 상세 상단 제목 옆에도 버튼 추가
- Request DB 확인해서 없는 경우에는 바로가기 비활성화

## Requests 페이지

상단의 세션목록에 Projects 디렉토리 표기
- 먼저 ~/.claude/projects/<Encoded Project Path>를 찾아서 conversation.go의 decodeProjectPath()를 호출해서 Project directory를 얻는다.
- 서버는 최초 실행시 먼저 ~/.claude/projects 아래의 파일로부터 프로젝트별/세션ID 및 title을 구축한다. title은 변경될 수 있으므로 별도로 저장하지 않고 서버 실행시 재구축한다. 성능에 문제가 있으면 나중에 다시 고려한다.
- title을 찾는 방법은 이미 conversation.go의 parseConversationFile()에서 제공하고 있다.  
  - parseConversationFile()을 참고해서 title 추출 전용 함수 생성해서 사용하자.
- ~/.claude/projects의 파일 변화를 모니터링해서 추가,변경이 있으면 다시 프로젝트별/세션ID 및 title을 업데이트한다.
  - 새로운 프로젝트 디렉토리 생성, 새로운 jsonl 파일 생성, 기존 파일 jsonl 변경 이벤트를 처리해야 한다. 프로젝트 디렉토리 삭제, jsonl 파일 삭제도 감시 필요.
  - OS에서 제공하는 파일 변경 감시 API를 이용하고 여의치 않으면 10초 간격으로 폴링하자. 필요한 go 모듈은 추가한다.
- 웹은 이 정보를 이용해서 세션ID로 부터 프로젝트 디렉토리 이름, 세션 title을 얻는다.
- 세션 목록의 세션ID 아래에 두 줄을 추가한다. 
  1. 프로젝트 디렉토리 이름
  2. 세션 title
  - 못 찾은 경우에는 'Project Not Found' 표시. Conversation 바로가기도 비활성화

Conversations로 바로가기 추가
- 세션 목록의 휴지통 옆에 추가

초기 인덱스 구축 완료 전 API 호출 처리
- 서버 부팅 직후 /api/sessions가 호출될 때 인덱스가 아직 비어 있으면 일시적으로 모든 세션이 'Project Not Found'로 보일 수 있으므로 async 하지 말고 blocking으로 한다.




