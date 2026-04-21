# Request 목록 카드 UI 개선

/o-implementation-plan의 입력으로 제공할 파일이다.

## 목적

Request 목록 카드 UI를 개선한다.

## 추가 요소

### Agent session 여부
- Request.Body.system[1]이 'You are Claude Code'로 시작하면 Main session 아니면 Agent session
  - system[0]은 "x-anthropic-billing-header: cc_version=2.1.114.6f3; cc_entrypoint=claude-vscode; cch=390a1;"
  - 기존 코드는 system[0]으로 되어 있는데 기존 코드가 오류.
- Agent인 경우에만 Agent Chip 표시

### Stream 여부
- Request.Body.stream 값(true | false)로 판단. stream이 없는 경우는 false
- Stream인 경우에만 Stream Chip 표시

### stop_reason
- Response.Body.stop_reason을 태그 형태로 표시
- 값에 따른 컬러 구분

### Usage 표시 개선
- 전체 input: response.Body.usage.input_tokens + response.Body.usage.cache_creation_input_tokens + response.Body.usage.cache_read_input_tokens 
- 캐시 read: response.Body.usage.cache_read_input_tokens
- Hit ratio: 캐시 read / 전체 input 으로 계산
  - 87.3% 처럼 표시
  - >90% 녹색, 50-90% 주황 등 구간 분기
- Output tokens: response.Body.usage.output_tokens
- 전체 표시
  - Input: input + cache_creation + cache_read [Hit ratio], Output: Output tokens
  - ex) Input: 1 + 0 + 98076 [99.9%], Output: 267
  - Hit ratio는 Chip 형태로 강조

## 현재 구성

1행: <Model> <Status Code>                   <날짜/시각>
2행: /v1/messages                            
3행: <input tokens + output tokens>  <elapsed time>

## 새로운 구성

1행: <Model> <Status Code>                   <날짜/시각>
2행: <Agent Session Chip> <Stream Chip> <stop_reason>
3행: <Usage 표시 개선>                     <elapsed time>

- 기존 /v1/messages는 삭제
- 2행의 각 요소는 chip UI. 해당하지 않는 경우에는 표시하지 않는다.
  - 세 요소 간 순서(Agent → Stream → stop_reason)를 고정
- 3행의 기존 <elapsed time>은 우측 정렬

## 완료

IMPLEMENTATION_PLAN 생성 없이 바로 구현

  