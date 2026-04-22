# Request 목록 카드에 마지막 message를 보여준다.

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도

LLM의 특성한 계속 과거의 message가 누적되는 구조라 새로 추가된 message 파악이 힘들다.
어떤 새로운 message가 추가로 전달된 것인지 바로 파악하고 싶다.

## 마지막 2개의 message

Request Body의 messages 배열의 마지막 항목 2개는 이전 서버의 응답과 이번의 user 요청을 나타낸다.

개별 항목을 message라고 할 때 다음을 표시하자
- message.role
- message.content 배열의
  - type == "text"중 마지막 요소의 text 값
    - <system-reminder>인 경우에도 예외는 없다.
  - type == "tool_use"인 요소들의 name 값들. |로 구분
  - type == "tool_result"중 마지막 요소의 content 값
  - 나머지 type인 경우에는 type 표시만

text 값이나 content의 경우에 1줄이 넘으면 ...으로 표시한다.

messages가 없으면 "No messages"로 명시

연속으로 user가 2개인 경우에는 마지막 1개만 표시한다.

## 표시 예

(user) "text 중 마지막 요소의 값"

(assistant) "text 중 마지막 요소의 값"
  (tool_use) Grep|Read
(user) "text 중 마지막 요소의 값"
  (tool_result) "..."

(assistant) "text 중 마지막 요소의 값"
  (tool_use) Grep|Read
(user) 
  (tool_result) "..."

- ()은 chip으로 표시하라는 뜻이면 () 문자는 제외한다.
- 해당 사항이 없으면 비운다.
- role 다음의 tool_use, tool_result 등의 행은 왼쪽 여백을 준다.
- 텍스트는 선명하게 표시한다.

## 표시 위치

Request 목록 카드의 최상단에 추가하자.

예) 기존 카드 위에 네 줄 추가된 경우
(assistant) "text 중 마지막 요소의 값"
  (tool_use) Grep|Read
(user) 
  (tool_result) "..."
Opus 200
(end_tern)
Input: ... Output: ...

## 구현 완료

IMPLEMENTATION_PLAN 없이 바로 구현