# Implementation Plan: Response Overview 추가 및 Request Overview 재구성

**Source requirements:** `requirements-response_overview.md`
**Generated:** 2026-04-20

## Overview

현재 Requests 페이지 상세 뷰는 Request Overview만 존재하고 Response 주요 정보는 하단에 분산되어 한눈에 파악하기 어렵다. Request Overview를 요구사항에 맞는 표 형태로 재구성하고, 동일한 구조의 Response Overview 카드를 신규로 추가하여 둘을 50:50 좌우 배치한다. Response Overview는 Status / Headers / Body 핵심 필드를 표로 제공하며, Rate-limit 헤더가 있을 때만 노출하고 Reset 타임스탬프는 localtime으로 변환 표시한다.

## Task Breakdown

| #  | Status | Step                                                   | Files Affected                                               | Complexity |
|----|--------|--------------------------------------------------------|--------------------------------------------------------------|------------|
| 1  | ✅     | Request Overview 내용을 표 형태로 재구성                | `web/app/components/RequestDetailContent.tsx`                | Low        |
| 2  | ✅     | Response Overview 컴포넌트 신규 작성                    | `web/app/components/RequestDetailContent.tsx`                | Medium     |
| 3  | ✅     | Request/Response Overview 좌우 50:50 레이아웃 적용      | `web/app/components/RequestDetailContent.tsx`                | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: Request Overview 내용을 표 형태로 재구성

- **Goal:** 기존 Request Overview 섹션(Method/Endpoint/Timestamp/User Agent 4개 필드)을 요구사항이 정의한 표 구조로 교체한다.
- **Preconditions:** baseline 저장소 상태. `RequestDetailContent`의 `Request Overview` 카드가 현재 grid 2-col 4-field 구성임.
- **Changes:**
  - Request Overview 카드 내부를 2열 테이블(또는 label/value row 리스트)로 재구성:
    - Timestamp: 기존 `new Date(request.timestamp).toLocaleString()` 사용
    - Method/URL: `POST /v1/messages` 형태 단일 셀 (method + endpoint 조합)
    - Header.User-Agent: `request.headers['User-Agent']?.[0]`
    - Header.Model: `request.body?.model` (없으면 "없음")
    - Body.system[0]: `request.body?.system?.[0]?.text` 전체 (없으면 "없음")
    - Body.system[1]: `request.body?.system?.[1]?.text` 전체 (없으면 "없음")
    - Body.max_tokens: `request.body?.max_tokens` (없으면 "없음")
    - Body.stream: `request.body?.stream` → true/false 문자열
  - 긴 값(system text 등)은 줄바꿈 허용(`whitespace-pre-wrap` / `break-words`)으로 여러 줄 표시.
  - 기존 `getMethodColor`/`getChatCompletionsEndpoint` 참조는 새 구성에 맞게 유지 또는 제거(Method/URL 단일 셀에서 필요한 경우에만 사용).
- **Files:** `web/app/components/RequestDetailContent.tsx`
- **Done condition:** `cd web && npm run typecheck` 이 error 0 으로 통과하고, 수동 확인 시 `/requests/<sid>?rid=<id>` 페이지에서 Request Overview 카드가 Timestamp / Method/URL / User-Agent / Model / system[0] / system[1] / max_tokens / stream 8개 행을 갖는 표 형태로 렌더링된다. system[0] 또는 system[1]이 없는 요청에서는 해당 행에 "없음"이 표시된다.
- **Rollback:** `git checkout web/app/components/RequestDetailContent.tsx`
- **Notes:** 기존 `ResponseDetails`(하단 API Response 카드)는 이 단계에서 건드리지 않는다. Overview만 수정.

### Step 2: Response Overview 컴포넌트 신규 작성

- **Goal:** 요구사항에 정의된 Response Overview 카드를 `RequestDetailContent.tsx` 내부에 추가한다. 이 단계에서는 단순히 Request Overview 카드 아래에 세로로 배치되어도 되며, Step 3에서 좌우로 재배치한다.
- **Preconditions:** Step 1 완료.
- **Changes:**
  - `RequestDetailContent.tsx`에 `ResponseOverview` 컴포넌트를 신규로 정의 (파일 내부 함수 선언).
  - Props: `response: NonNullable<Request['response']>` (이미 정의된 타입 재사용).
  - 표 구조 (label/value 2-col):
    - Status: `response.statusCode`
    - Header.Content-Type: `response.headers['Content-Type']?.[0]`
    - Header.Request-Id: `response.headers['Request-Id']?.[0] ?? response.headers['request-id']?.[0]` (헤더 key case insensitive 조회 헬퍼 사용)
    - Ratelimit: `Anthropic-Ratelimit-Unified-5h-*` / `7d-*` 6개 헤더 중 하나라도 존재하면 하위 6개 행을 노출, 전혀 없으면 Ratelimit 그룹 자체를 렌더링하지 않음.
      - 5h-Utilization (number)
      - 5h-Reset (number → `new Date(sec * 1000).toLocaleString()` 로 변환)
      - 5h-Status (string)
      - 7d-Utilization (number)
      - 7d-Reset (number → localtime 문자열)
      - 7d-Status (string)
    - Body.id: `response.body?.id`
    - Body.stop_reason: `response.body?.stop_reason`
    - Body.usage.input_tokens: `response.body?.usage?.input_tokens`
    - Body.usage.cache_creation_input_tokens
    - Body.usage.cache_read_input_tokens
    - Body.usage.output_tokens
  - 값이 없는 필드는 "없음" 또는 빈 문자열로 표시(일관성 유지). 요구사항의 "없으면 없다고 표시"는 Request의 system[0/1]에만 명시되었으나 Response도 동일 규칙을 적용한다.
  - 긴 값(id 등)은 줄바꿈 허용.
  - streaming 응답의 경우 `response.body`는 `handler`에서 재조합되어 동일한 구조로 채워진다(요구사항 line 48). 특별 분기 불필요.
  - 헤더 key 대소문자 혼재(`Content-Type` vs `content-type`)에 대응하는 소형 헬퍼: `getHeader(headers, name)` 을 컴포넌트 근처에 로컬 함수로 추가.
  - 기존 하단 `ResponseDetails` 컴포넌트는 그대로 둔다 (요구사항은 Overview 추가이지 기존 섹션 제거가 아님).
- **Files:** `web/app/components/RequestDetailContent.tsx`
- **Done condition:** `cd web && npm run typecheck` 통과. 수동 확인 시 (a) Ratelimit 헤더가 있는 실제 요청에서 Response Overview 카드에 6개 Ratelimit 행이 표시되고 `5h-Reset`/`7d-Reset`가 `2026-04-20 ...` 형식의 로컬타임 문자열로 렌더링된다. (b) Ratelimit 헤더가 없는 요청에서는 Ratelimit 관련 행이 전혀 나타나지 않는다. (c) Body.id / stop_reason / usage.* 필드가 실제 값과 일치한다.
- **Rollback:** `git checkout web/app/components/RequestDetailContent.tsx`
- **Notes:** Response가 아직 없는 요청(`request.response == null`)에서는 Response Overview 카드 자체를 렌더링하지 않는다. `request.response &&` 조건부 렌더링.

### Step 3: Request/Response Overview 좌우 50:50 레이아웃 적용

- **Goal:** Request Overview와 Response Overview 카드를 좌우 50:50으로 배치한다.
- **Preconditions:** Step 1, 2 완료.
- **Changes:**
  - 두 카드를 감싸는 상위 `div`를 Tailwind grid (`grid grid-cols-1 lg:grid-cols-2 gap-6`) 또는 flex (`flex flex-col lg:flex-row gap-6`) 로 구성.
  - 각 카드(`bg-white border ... rounded-xl`)는 기존 스타일 유지, 너비는 grid cell이 50:50으로 분배.
  - `request.response`가 없는 경우: Request Overview만 전체 폭을 차지하도록 자연스럽게 fallback (grid cell이 하나만 렌더링되면 자동으로 1열 차지하므로 `grid-cols-2`만 쓰면 왼쪽만 차고 오른쪽이 빈다 → `request.response ? 2열 : 1열` 로 분기하거나, Response 카드 영역을 조건부 placeholder로 채움).
    - 선택: `request.response`가 없을 때 Request Overview를 `col-span-2` 로 넓히는 방식. 구현 시 `grid-cols-1 lg:grid-cols-2` + Request card에 `request.response ? '' : 'lg:col-span-2'` 조건부 클래스.
  - 작은 화면(`< lg`)에서는 세로 스택 (grid-cols-1) — 요구사항 "50:50"은 데스크톱 전제이며 모바일 스택 허용.
- **Files:** `web/app/components/RequestDetailContent.tsx`
- **Done condition:** `cd web && npm run typecheck` 통과. 수동 확인 시 `lg` 이상 너비에서 Request Overview와 Response Overview가 좌우로 동일 너비(50:50)로 배치된다. `request.response`가 없는 요청에서는 Request Overview가 전체 폭을 차지한다. 작은 화면에서는 세로 스택으로 자연스럽게 전환된다.
- **Rollback:** `git checkout web/app/components/RequestDetailContent.tsx`
- **Notes:** `RequestDetailContent`의 최상위 `<div className="space-y-6">` 는 유지하되, 두 Overview 카드를 공통 부모로 감싸서 그 부모에 `grid` 클래스를 부여하는 방식이 가장 영향 범위가 작다.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-20)
- `getMethodColor` 헬퍼를 제거했다. 새 Method/URL 단일 셀 구성에서 method 배지가 아닌 단순 텍스트(`POST /v1/messages`)를 사용하므로 헬퍼가 더 이상 필요하지 않다. 기존 사용처는 Request Overview 한 곳뿐이었다.
- 기존 `cd web && npm run typecheck` 결과 `MessageContent.tsx:93` 의 TS2559 에러가 **이미 베이스라인에 존재**한다 (Step 1 변경 전에도 동일). 이 에러는 본 단계에서 도입된 것이 아니며, Step 1 변경으로 인한 신규 에러는 0건이다.

### Step 2 (2026-04-20)
- Response Overview 카드는 Step 2에서 Request Overview 카드 바로 아래에 세로 스택으로 배치했다 (계획서 허용 범위). Step 3에서 좌우 50:50으로 재배치할 예정.
- `ResponseOverviewTable` 내부에서 `body.id`/`stop_reason`/`usage.*` 필드에 접근할 때 기존 `Request['response']` 타입의 `body?: any` 덕분에 별도 타입 정의 없이 optional chaining 으로 안전하게 접근 가능했다. 추가 interface 선언 없음.
- 헤더 키 대소문자 혼재 대응을 위해 `getHeader(headers, name)` 헬퍼를 파일 내 로컬 함수로 추가했다 (계획서에 기술된 대로).
- `cd web && npm run typecheck` 결과: 베이스라인 `MessageContent.tsx:93` TS2559 에러만 출력. Step 2 변경으로 인한 신규 에러 0건.

### Step 3 (2026-04-20)
- Request Overview와 Response Overview 두 카드를 공통 부모 `<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">` 로 감싸 lg 이상에서 좌우 50:50, 작은 화면에서는 세로 스택이 되도록 구성했다.
- `request.response`가 없을 때 Request Overview 카드에 `lg:col-span-2` 조건부 클래스를 부여하여 자연스럽게 전체 폭을 차지하도록 fallback 처리했다 (계획서 제안 방식).
- 기존 `RequestDetailContent`의 최상위 `<div className="space-y-6">` 는 유지했다. 이후 섹션들(Headers, Request Body, System Messages, Tools, Conversation, Model Configuration, API Response, Prompt Grade)은 변동 없음.
- IDE 진단으로 `line 132`에 `typescript:S125` (commented-out code) 경고가 발생했으나, 해당 주석은 Step 1 이전부터 존재하는 기존 grading 버튼 주석으로 본 단계에서 도입된 것이 아니다. 현 요구사항 범위 밖이므로 그대로 유지.
- `cd web && npm run typecheck` 결과: 베이스라인 `MessageContent.tsx:93` TS2559 에러만 출력. Step 3 변경으로 인한 신규 에러 0건.
