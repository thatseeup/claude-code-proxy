# Response Overview 추가

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도


현재 Request Overview만 있고 Response Overview는 없으며 또한 아래쪽에 위치하기 때문에 주요 정보를 한 번에 파악하기 어렵다. 
Response Overview를 추가하면서 함께 Request Overview도 정리하자.

## Layout

- Requests 페이지에 대해서 작업한다.
- 현재 Request Overview 자리에 새로 추가되는 Response Overview와 함께 좌우로 위치하게 구성한다. 
- 50:50

## Request Overview 내용

현재는 4가지 정보가 있다. 
기존은 무시하고 새롭게 다음의 정보를 표 형태로 나타낸다.

- Timestamp: <현재 사용하고 있는 값>
- Method/URL: POST /v1/messages
- Header
  - User-Agent: <헤더의 값>
  - Model: body.model
- Body
  - system[0]: body.system[0] (string) // x-anthropic-billing-headers: ...
    - 없으면 없다고 표시
  - system[1]: body.system[1] (string) // You are a Claude ...
    - 없으면 없다고 표시
  - max_tokens: body.max_token (number) // 32000
  - stream: body.stream (true | false) 

## Response Overview 내용

- Status // 200, 429 등
- Header
  - Content-Type: // text/event-stream; charset=utf-8
  - Request-Id: // req_011CaEsasthsKq4twhTYrjUT
  - Ratelimit // 없으면 표시하지 않는다.
    - 5h-Utilization: Anthropic-Ratelimit-Unified-5h-Utilization (number) // 0.64
    - 5h-Reset: Anthropic-Ratelimit-Unified-5h-Reset (number) // 1776690000 // localtime으로 변환해서 표시 (2026-04-20 15:30:00)
    - 5h-Status: Anthropic-Ratelimit-Unified-5h-Status (string) // "allowed"
    - 7d-Utilization: Anthropic-Ratelimit-Unified-7d-Utilization (number) // 0.27
    - 7d-Reset: Anthropic-Ratelimit-Unified-7d-Reset (number) // 1776690000 // localtime으로 변환해서 표시
    - 7d-Status: Anthropic-Ratelimit-Unified-7d-Status (string) // "allowed"
- Body (text/event-stream의 경우에도 재조합한 Response Body를 사용하면 똑같다.)
  - id: body.id (string) // "msg_015NvoPkvKuA7pooKnN3wJHn"
  - stop_reason: body.stop_reason (string) // "end_turn"
  - usage
    - input_tokens: body.usage.input_tokens (number) // 386
    - cache_creation_input_tokens: body.usage.cache_creation_input_tokens (number) // 0
    - cache_read_input_tokens: body.usage.cache_read_input_tokens (number) // 0
    - output_tokens: body.usage.output_tokens (number) // 16

## 기타

- 긴 항목은 여러 줄로 표시한다.