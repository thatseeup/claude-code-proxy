# Token 사용량을 API 요금으로 계산해서 보여준다.

/o-implementation-plan의 입력으로 제공할 파일이다.

## 목적

모든 메시지 응답에는 토큰 사용량이 포함되어 있다. 
토큰 사용량을 API 요금으로 계산해서 보여주자.

## 가격표

먼저 아래 가격표 참고해서 계산 함수를 만든다. 현재 기준으로 만들면 되고 가격이 변경되면 다시 참고해서 만들면 된다.
https://platform.claude.com/docs/en/about-claude/pricing

2026-04-25 기준 공식가 (USD / Million tokens):

| Model ID             | Input | Output | 5m Cache Write | 1h Cache Write | Cache Read |
|----------------------|-------|--------|----------------|----------------|------------|
| claude-opus-4-7      | $5    | $25    | $6.25          | $10            | $0.50      |
| claude-opus-4-6      | $5    | $25    | $6.25          | $10            | $0.50      |
| claude-sonnet-4-6    | $3    | $15    | $3.75          | $6             | $0.30      |
| claude-haiku-4-5     | $1    | $5     | $1.25          | $2             | $0.10      |

- 가격표에 없는 모델(구형/미지원)이 들어오면 비용 계산 불가로 처리하고 UI에는 비용을 표시하지 않는다(빈 값). 빈 값을 포함한 합산은 `$0.00`이 아니라 합산에서 제외한다.
- 모델 매칭은 model ID 정확 일치로 한다. prefix 매칭은 사용하지 않는다 (새 모델 나올 때마다 가격표에 명시적으로 추가).

## 대상 모델

오래된 모델은 계산 함수에 넣을 필요 없다.

- Claude Opus 4.6 이상
- Claude Sonnet 4.6 이상
- Claude Haiku 4.5 이상

## response의 usage

Response Body의 "usage"에 계산에 필요한 token 정보가 있다.

```
  "usage": {
    "input_tokens": 6,
    "output_tokens": 92,
    "cache_creation_input_tokens": 26,
    "cache_read_input_tokens": 41857,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 0,
      "ephemeral_1h_input_tokens": 26
    },
```
- cache_creation_input_tokens 대신에 ephemeral_5m_input_tokens과 ephemeral_1h_input_tokens를 사용하면 된다. cache_creation_input_tokens만 있다면 ephemeral_1h_input_tokens를 계산하면 된다. 
- model은 response body의 model을 참고하면 된다. ex) "claude-opus-4-7"

## UI

Requests 페이지에 수정한다.

왼쪽 페인의 Request 카드에 추가한다.
- 가장 아래에서 윗 줄의 responseTime 앞에 $0.45 처럼 표시한다.
  - ex) Non-Stream end_turn           $0.45  2.37s
- 소수점 2자리
- 0.005미만이면 0.00으로 표시한다.
- 달러 요금이니 locale 적용할 필요없다. 항상 $1,234.45처럼 표시하면 된다.

왼쪽 페인의 Project picker 아래의 세션 picker를 수정한다.
- SessionPicker 드롭다운 항목도 동일하게 변경한다.
- 백엔드 /api/sessions 가 totalCost 필드를 내려주는 방식을 이용하자
  - 당연히 진행 중 요청은 response가 없으므로 계산에서 제외된다.
  - 스트리밍/비스트리밍 모두 responseBody.usage를 참고하면 된다.
  - DB에는 저장하지 말고 response의 정보로 매번 계산한다. 
- 세션 picker의 마지막 줄을 다음과 같이 변경한다. 
- 기존의 날짜는 우측 정렬시키고 request count 다음에 모든 Request 요금 합산을 추가한다.
  - Requests 페이지 상단의 Opus/Sonnet/Haiku 필터 토글과 무관하게 전체 모델에 대한 합산이다.
- 현재 구조는 3줄(title / sessionId / 11 req · 2026-04-25 00:23)
- 수정하면 3줄(title / sessionId / 11 req · $12.45        2026-04-25 00:23)
- 11 req와 $12.45는 구분이 되게 색이나 명도 등으로 구분하자.

## 테스트

가격 계산 관련 테스트도 추가하자