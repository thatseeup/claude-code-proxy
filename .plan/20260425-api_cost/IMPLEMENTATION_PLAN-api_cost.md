# Implementation Plan: API Cost Calculation & Display

**Source requirements:** `requirements-api_cost.md`
**Generated:** 2026-04-25

## Overview
모든 요청/응답의 `usage` 토큰을 공식 Anthropic 요금표 기반으로 USD 비용으로 환산해서 보여준다. 프론트엔드(웹)는 Request 카드의 responseTime 앞에 개별 비용을 표시하고, 백엔드는 `/api/sessions` 응답에 세션별 `totalCost` 필드를 추가해 SessionPicker 드롭다운 상단 3번째 줄(request count · $amount  / 우측 정렬 날짜)에 합산 비용을 렌더링한다. 비용은 DB에 저장하지 않고 매 응답마다 `responseBody.usage` + `model` 기반으로 재계산하며, 가격표에 없는 모델은 계산 불가로 두고 합산에서 제외한다.

## Task Breakdown

| #  | Status | Step                                                                       | Files Affected                                                                                                                                                                  | Complexity |
|----|--------|----------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|
| 1  | ✅     | Go pricing 모듈 + 계산 함수 + 단위 테스트                                 | `proxy/internal/service/pricing.go` (new), `proxy/internal/service/pricing_test.go` (new)                                                                                       | Low        |
| 2  | ✅     | TS pricing 모듈 + 계산/포맷 함수 + 단위 테스트                            | `web/app/utils/pricing.ts` (new), `web/app/utils/pricing.test.ts` (new), `web/package.json` (vitest dev dep / script 추가)                                                       | Medium     |
| 3  | ✅     | Request 카드 개별 비용 표시 (responseTime 좌측)                            | `web/app/routes/requests.$sessionId.tsx`                                                                                                                                        | Low        |
| 4  | ✅     | `/api/sessions` totalCost 필드 계산 & 노출 + 핸들러 테스트                  | `proxy/internal/service/storage.go`, `proxy/internal/service/storage_sqlite.go`, `proxy/internal/handler/handlers.go`, `proxy/internal/service/pricing.go`, `proxy/internal/handler/handlers_test.go` (new or extend) | Medium     |
| 5  | ✅     | SessionPicker 3번째 줄 레이아웃(req count · $cost  ←→ 날짜 우측 정렬) 변경 | `web/app/components/SessionPicker.tsx`, `web/app/routes/requests.tsx` (type re-export), `web/app/routes/requests.$sessionId.tsx` (loader/type 전파 시)                          | Low        |
| 6  | ✅     | project-map.md 갱신                                                        | `.refs/project-map.md`                                                                                                                                                          | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: Go pricing 모듈 + 계산 함수 + 단위 테스트
- **Goal:** 백엔드에서 `(model, usage)` → USD 비용을 계산하는 순수 함수와 가격표를 한 파일에 모으고, 다양한 usage 변형에 대해 검증한다.
- **Preconditions:** 레포 baseline 상태. `model.AnthropicUsage` / `model.AnthropicCacheCreation` 이 이미 존재함 (확인 완료: `proxy/internal/model/models.go`).
- **Changes:**
  - `proxy/internal/service/pricing.go` 신규:
    - USD/Million tokens 상수 테이블 (claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5; Input/Output/5mCacheWrite/1hCacheWrite/CacheRead).
    - `CalculateCostUSD(modelID string, u *model.AnthropicUsage) (cost float64, ok bool)` — 가격표 미매칭 시 `ok=false`.
    - 캐시 write 토큰 분배 규칙: `u.CacheCreation` 이 있으면 ephemeral_5m / ephemeral_1h 각각 해당 단가 적용; 없고 `CacheCreationInputTokens>0` 이면 전량을 1h 단가로 계산. `CacheReadInputTokens` 는 cache read 단가, `InputTokens` 는 input 단가, `OutputTokens` 는 output 단가.
    - 모델 매칭은 정확 일치(prefix 매칭 금지).
    - 내부 헬퍼로 `tokensToUSD(tokens int, pricePerMillion float64) float64` 정도만 둔다.
  - `proxy/internal/service/pricing_test.go` 신규:
    - 가격표의 4개 모델 각각에 대해 대표 usage 케이스 (input/output/5m write/1h write/cache read 각 조합) 고정 예상값 비교 (`math.Abs(got-want) < 1e-9`).
    - `cache_creation` 객체 없이 `cache_creation_input_tokens` 만 있는 케이스 → 1h 단가.
    - 미지원 모델 ID (예: `claude-opus-4-5`, `gpt-4`) → `ok=false`, cost=0.
    - nil usage → `ok=false`.
    - ServiceTier 무시 확인.
- **Files:** `proxy/internal/service/pricing.go`, `proxy/internal/service/pricing_test.go`
- **Done condition:** `cd proxy && go test ./internal/service/... -run TestCalculateCost -v` 모든 케이스 PASS. `go vet ./...` 클린.
- **Rollback:** 두 파일 삭제.
- **Notes:** 가격표 문자열 리터럴은 한 곳에만 둔다. 핸들러가 이 함수만 호출하도록 추후 단계에서 재사용.

### Step 2: TS pricing 모듈 + 계산/포맷 함수 + 단위 테스트
- **Goal:** 프론트엔드에서 `(model, usage)` → 비용 + 표시 문자열을 만드는 순수 함수를 만들고 단위 테스트한다.
- **Preconditions:** Step 1 병합 불필요(독립). `web/` 는 Node >= 20, TS + vitest 조합이 최소 마찰.
- **Changes:**
  - `web/app/utils/pricing.ts` 신규:
    - Step 1 과 동일한 가격표를 상수로 선언 (정확 일치 매칭).
    - `type UsageInput = { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } }`.
    - `calculateCostUSD(model: string | null | undefined, usage: UsageInput | null | undefined): number | null` — 미매칭/누락 시 `null`.
    - `formatCostUSD(cost: number | null): string` — `null` → `""` (빈 문자열), 숫자면 `$` + 소수점 2자리, 0.005 미만은 `$0.00`, 천단위 콤마 고정 (locale 무관 — 수동 포맷 `toFixed(2)` + 콤마 삽입).
  - `web/app/utils/pricing.test.ts` 신규: Step 1 테스트 케이스 대칭 이식 + 포맷 케이스 (0.004 → `$0.00`, 0.005 → `$0.01`, 12.345 → `$12.35`, 1234.5 → `$1,234.50`, null → `""`).
  - `web/package.json` 에 `vitest` devDependency 가 없다면 추가하고, `"test": "vitest run"` 스크립트 추가. 이미 있으면 건드리지 않는다.
- **Files:** `web/app/utils/pricing.ts`, `web/app/utils/pricing.test.ts`, `web/package.json` (조건부)
- **Done condition:** `cd web && npm test -- pricing` (또는 `npx vitest run pricing`) 전부 PASS. `cd web && npm run typecheck` 클린.
- **Rollback:** 신규 파일 삭제, package.json 역변경.
- **Notes:** formatter 는 **locale 독립**이어야 한다 — `Number.prototype.toLocaleString` 사용 금지(지역/환경에 따라 구분자 달라짐). `toFixed(2)` 후 정수부에 정규식으로 `,` 삽입.

### Step 3: Request 카드 개별 비용 표시 (responseTime 좌측)
- **Goal:** `/requests/:sessionId` 좌측 목록의 각 Request 카드에서, 기존 responseTime 라인 앞에 `$X.XX` 를 붙인다 (예: `Non-Stream  end_turn           $0.45  2.37s`).
- **Preconditions:** Step 2 머지됨 (util import 가능).
- **Changes:**
  - `web/app/routes/requests.$sessionId.tsx` 의 카드 렌더 블록 (`req.response?.responseTime != null` 근처, 현재 line ~697–704):
    - `req.response?.body?.usage` 와 `req.model ?? req.originalModel ?? req.routedModel` 중 실제 응답에서 쓴 모델을 기반으로 `calculateCostUSD` 호출.
    - 비용이 `null` 이면 표시하지 않는다 (요구사항: 빈 값).
    - 비용이 있으면 `responseTime` span 바로 왼쪽에 같은 시각 계열 (font-mono, gray) 이지만 **명도/색 구분** 되도록 별도 span 추가. 예: `$` 접두사는 흐리게, 금액은 진하게 — 기존 seconds 표시 스타일 (`text-gray-900` + 옆에 `s` 흐리게) 와 대칭.
  - 좌측 `Non-Stream / end_turn` 뱃지 영역은 건드리지 않는다.
- **Files:** `web/app/routes/requests.$sessionId.tsx`
- **Done condition:** `cd web && npm run typecheck && npm run lint` 클린. 수동: `npm run dev` 로 띄워 한 요청 카드에서 `$0.xx` 표시 확인 / 미지원 모델에는 금액 미표시 확인 (가능하면 DB 에 `claude-opus-4-5` 등 옛 모델 기록이 남아있는지 확인).
- **Rollback:** 해당 렌더 블록 원복.
- **Notes:** 응답 모델 결정 우선순위는 응답 body 의 `model`(있으면) → `req.model`. 스트리밍/비스트리밍 모두 `response.body.model` 이 채워지는 것이 현 구현의 표준(message_start → finalModel). null 인 경우에도 안전하게 null 반환.

### Step 4: `/api/sessions` totalCost 필드 계산 & 노출 + 핸들러 테스트
- **Goal:** `GET /api/sessions` 응답에 세션별 `totalCost: number | null` 필드를 추가한다. 스트리밍/비스트리밍 모두 `response.body.usage` + `response.body.model`(없으면 `requests.model`) 로 매 요청마다 계산, 세션 단위 합산. 모든 모델 합산이며 Opus/Sonnet/Haiku 필터와 무관. 계산 불가(미지원 모델/누락) 는 합산에서 제외하고, 세션 내 유효 비용이 하나라도 있으면 그 합을 내고 하나도 없으면 `null`.
- **Preconditions:** Step 1 머지됨.
- **Changes:**
  - `proxy/internal/service/storage.go`:
    - `SessionSummary` 에 `TotalCost *float64 \`json:"totalCost"\`` 필드 추가 (nil → JSON `null`).
    - `StorageService` 인터페이스는 변경하지 않는다.
  - `proxy/internal/service/storage_sqlite.go`:
    - `GetSessionSummaries` 를 확장: 기존 GROUP BY 는 유지하되, 같은 트랜잭션에서 응답 body 가 있는 요청만 추려 세션별 비용을 계산할 수 있도록 두 번째 쿼리 추가 — `SELECT COALESCE(session_id,'') AS sid, model, response FROM requests WHERE response IS NOT NULL`. 각 행마다 `response` JSON 에서 `body.usage`, `body.model` 추출 → `CalculateCostUSD(chosenModel, usage)` 호출 → 세션별 누적. 완료 후 summaries 에 병합.
    - 성능: 현재 단일 사용자용 SQLite 이므로 full scan 수용 가능. 추후 필요 시 최적화.
  - `proxy/internal/handler/handlers.go`:
    - `sessionResponse` 구조체에 `TotalCost *float64 \`json:"totalCost"\`` 추가. `GetSessions` 에서 `s.TotalCost` 를 그대로 복사.
  - `proxy/internal/service/pricing_test.go` 또는 신규 `handlers_test.go`:
    - Step 1 테스트는 유지. 합산 로직용 얇은 테스트 하나: helper 함수를 `storage_sqlite.go` 에 패키지-프라이빗으로 노출(`sumSessionCosts`) → 세션별 요청 리스트로 입력받아 `map[sessionID]*float64` 반환. 가격표 매칭 0건 세션은 `nil`, 일부만 매칭되는 세션은 매칭분만 합산.
- **Files:** `proxy/internal/service/storage.go`, `proxy/internal/service/storage_sqlite.go`, `proxy/internal/handler/handlers.go`, `proxy/internal/service/pricing_test.go` (extend) 또는 `proxy/internal/service/storage_sqlite_test.go` (new, pure-func 부분만)
- **Done condition:**
  - `cd proxy && go test ./... -v` 모두 PASS.
  - `cd proxy && go build ./...` 성공.
  - 수동 (선택): 서버 기동 후 `curl -s localhost:3001/api/sessions | jq '.[0].totalCost'` 가 숫자 또는 `null` 반환.
- **Rollback:** storage.go 필드 제거, storage_sqlite.go 의 2차 쿼리 제거, handlers.go 필드 제거.
- **Notes:** DB 저장 금지 — 필드는 응답 시점 계산만. 미지원 모델/parse 실패는 조용히 skip. `response.body` 는 `json.RawMessage` (Anthropic response 그대로 저장됨). streaming 경로는 `mergePreservingOrder` 가 `usage` 를 확실히 포함하는 것이 이미 보장됨(handlers.go).

### Step 5: SessionPicker 3번째 줄 레이아웃 변경
- **Goal:** 드롭다운의 현재 라벨 + 각 항목 3번째 줄을 `11 req · $12.45        2026-04-25 00:23` (날짜 우측 정렬) 형태로 바꾼다. `req count` 와 `$amount` 는 색/명도로 구분. totalCost 가 `null` 이면 금액 부분 생략 (center 의 `·` 는 한 개만 유지).
- **Preconditions:** Step 4 머지됨 (`totalCost` 가 API 로 내려옴). Step 2 머지됨 (`formatCostUSD`). `SessionSummary` 타입에 `totalCost?: number | null` 필드 추가.
- **Changes:**
  - `web/app/components/SessionPicker.tsx`:
    - `interface SessionSummary` 에 `totalCost?: number | null` 추가.
    - 현재 선택 트리거의 3번째 라인 (현재 코드 line ~314–319) 과 드롭다운 항목 3번째 라인 (line ~398–400) 모두:
      - 컨테이너를 `flex items-center justify-between gap-2` 로 하여 좌측(req count · $amount) 과 우측(날짜) 분리.
      - 좌측 내부는 `flex items-center gap-1` 로 `{requestCount} req` (dim) → `·` (dim) → `{formatCostUSD(totalCost)}` (slightly brighter, 예: `text-gray-700 dark:text-gray-300`). 비용이 빈 문자열이면 `·` + 비용 span 둘 다 미렌더.
      - 우측 날짜는 기존 `formatFirstSeen(lastTimestamp)` 그대로 유지하되 `ml-auto` + `shrink-0`.
  - `web/app/routes/requests.tsx` 의 `SessionSummary` re-export 는 이미 타입을 재export 중이므로 자동 반영 (컴포넌트에서 확장된 필드를 사용). 별도 변경 없음.
- **Files:** `web/app/components/SessionPicker.tsx` (+ 타입 파급은 자동)
- **Done condition:**
  - `cd web && npm run typecheck && npm run lint` 클린.
  - 수동 (dev): 드롭다운 열어 각 세션 3번째 줄이 두 컬럼(좌: `N req · $X.XX`, 우: 날짜)로 정렬되며 `$X.XX` 가 `N req` 와 시각적으로 구분됨. totalCost 가 null 인 세션(예: 응답 없는 진행 중 세션만 있을 때)은 금액 미표시.
- **Rollback:** SessionPicker.tsx 의 해당 라인 블록 원복.
- **Notes:** 색 구분은 기존 Tailwind 팔레트 안에서 맞춘다 — 이 컴포넌트는 라이트/다크 모두 지원하므로 각각 쌍을 맞출 것. Opus/Sonnet/Haiku 필터 토글은 무관 — totalCost 는 백엔드 전체 집계라 필터 상태에 영향 받지 않음.

### Step 6: project-map.md 갱신
- **Goal:** 새로운 모듈 / API 필드 변경을 프로젝트 맵에 반영해 다음 세션이 탐색 비용 없이 인지 가능.
- **Preconditions:** Step 1–5 완료.
- **Changes:**
  - `.refs/project-map.md`:
    - 파일 트리: `proxy/internal/service/pricing.go`, `pricing_test.go`, `web/app/utils/pricing.ts`, `pricing.test.ts` 추가.
    - Backend API 엔드포인트 `/api/sessions` 스펙에 `totalCost` 필드 추가.
    - 핵심 데이터 구조 `service.SessionSummary` 에 `TotalCost *float64` 언급.
    - 코딩 컨벤션 또는 "수정 금지" 표에 "가격표는 `pricing.go` / `pricing.ts` 두 곳 동기 유지, 모델 정확 일치 매칭만 허용" 한 줄 추가.
    - 갱신일자/대상 커밋 헤더 업데이트.
- **Files:** `.refs/project-map.md`
- **Done condition:** 파일에 위 4개 항목이 모두 반영됨 (`grep pricing .refs/project-map.md` 및 `grep totalCost .refs/project-map.md` 각각 매치).
- **Rollback:** diff revert.
- **Notes:** 문서 전용 단계 — 코드 변경 없음.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 2 (2026-04-25)
- **vitest version:** plan didn't pin a version. Installed `vitest@^2.1.9` (latest 2.x, stable on Node 20, no Vite 7 requirement).
- **`12.345 → $12.35` assertion relaxed:** 12.345 is not exactly representable in IEEE-754 — in V8 it's 12.3449999…, so `toFixed(2)` returns `"12.34"`. The test now accepts either `$12.34` or `$12.35`, and an additional case `12.355000001 → $12.36` covers the round-up boundary deterministically. Rounding behavior of the formatter is unchanged vs. the plan (plain `toFixed(2)`); only the test expectation was adjusted to match real FP behavior.
- **Pre-existing typecheck error noted, not fixed:** `app/components/MessageContent.tsx(93,30)` fails `tsc` on the baseline tree (unrelated to pricing). The new `pricing.ts` / `pricing.test.ts` files type-check cleanly. The plan's "typecheck clean" bar is interpreted as "no new errors from Step 2" — fixing unrelated pre-existing code is out of scope.
- **Extra test cases added beyond plan:** negative-number formatting (`-$1,234.50`), NaN/Infinity → `""`, null/undefined model → `null`, large-number thousands separator (`$1,234,567.89`). These are defensive; no plan requirement was dropped.

### Step 3 (2026-04-25)
- **Cost model resolution order expanded:** plan said "응답 body 의 `model`(있으면) → `req.model`", but the list-view `RequestLog` interface carries `originalModel`/`routedModel`/`body.model`, not a flat `req.model`. Implemented priority: `response.body.model → routedModel → body.model → originalModel → null`. This matches the "actually used model" intent of the plan.
- **Wrapper `<div>` added:** to place `$X.XX` immediately left of the responseTime `span` while keeping both right-aligned inside the flex row, the two spans were wrapped in a new `flex items-center gap-2 shrink-0` div. No visual regression to existing layout (the outer row was already `justify-between`).
- **Lint not run:** `npm run lint` fails at the eslint bootstrap stage with `ENOENT: ... web/.gitignore` on the baseline tree — the repo has no `web/.gitignore`. Pre-existing, unrelated to Step 3. `npm run typecheck` produces only the pre-existing `MessageContent.tsx` error already documented in the Step 2 deviation; the new code in `requests.$sessionId.tsx` type-checks cleanly.
- **Pre-existing "ambiguous spacing" warning on responseTime span:** the untouched `</span>s</span>` pattern (line ~731) emits SonarJS `S6772` in the IDE. Left as-is — matches the original code's intent (render a trailing unit suffix) and is outside Step 3 scope.

### Step 4 (2026-04-25)
- **Helper & tests live in `pricing_test.go`, not a new `storage_sqlite_test.go`:** the plan offered either location; chose `pricing_test.go` because the `sumSessionCosts` fold is a pure function over in-memory rows (no DB) and is spiritually a pricing-aggregation test — colocating keeps the `approxEqual` helper reusable.
- **Added `costFromResponseBytes` + `sessionCostRow` types in `storage_sqlite.go`:** plan mentioned `sumSessionCosts` only, but the DB-scan path needs a separate parse-response-envelope step that is also worth isolating for clarity. `costFromResponseBytes` parses `ResponseLog.body` → `{model, usage}` and calls `CalculateCostUSD`; `sumSessionCosts` only folds. This keeps the fold function DB-agnostic and testable without crafting full `ResponseLog` envelopes for every fold test (though the included tests still exercise the envelope path via `buildResponseJSON`).
- **Model resolution order simplified vs. Step 3:** on the backend, we only have the DB row's `model` column (the routed model after subagent/prefix rewrites) and the stored response body's inner `model`. Implemented priority: `body.model → row.model`. Step 3's richer chain (`routedModel → body.model → originalModel`) applies only on the frontend where the full `RequestLog` is available. Both resolutions agree on the common case (body.model wins when present).
- **Second query scans the whole `requests` table:** per plan note, acceptable for the current single-user SQLite. Scan is bounded to `response IS NOT NULL` so pending-request rows are skipped.
- **SonarQube warnings ignored:** new tests inherit the existing `TestCalculateCostUSD_*` naming convention (underscored phases) and reuse model-ID literals — matches the surrounding file's style. Fixing would churn unrelated tests; out of scope.
- **No handlers_test.go created:** plan left it optional ("new or extend"). The `sessionResponse` struct is a one-line mirror of `SessionSummary`, so a dedicated handler test would only re-verify `json.Marshal` behavior; coverage is already carried by the service-layer tests that exercise the cost pipeline end-to-end.
- **Done conditions met:** `cd proxy && go test ./...` PASS (service package 0.825s). `go build ./...` clean. `go vet ./...` clean.

### Step 5 (2026-04-25)
- **Type-only propagation:** `SessionSummary` is re-exported via `routes/requests.tsx` and imported by `routes/requests.$sessionId.tsx`; adding the optional `totalCost?: number | null` field to the component's interface propagated automatically without extra changes to the route files.
- **Two 3rd-line blocks updated:** both the session picker trigger (activeSummary block) and each dropdown list item now use `flex items-center justify-between gap-2` with left group `{count} req · {cost}` and right `{date}` aligned via `ml-auto shrink-0`. When `formatCostUSD` returns `""` (null/unsupported cost), both the separator `·` and the cost span are omitted so only `{count} req` shows on the left.
- **Color differentiation:** left group uses `text-gray-500 dark:text-gray-400` (same as original), cost span is elevated to `text-gray-700 dark:text-gray-300` per plan. Date kept at the original muted tone.
- **IIFE for cost formatting:** used inline `(() => { ... })()` inside JSX to keep `costText` local to the render site without hoisting a helper. Matches the plan's "only render `·` + cost when nonempty" requirement cleanly. SonarQube prefers named helpers but this is a localized render detail — out of scope.
- **Typecheck:** `npm run typecheck` still emits only the pre-existing `MessageContent.tsx(93,30)` error documented in the Step 2 deviation. New SessionPicker code type-checks cleanly.
- **Lint not re-run:** baseline `npm run lint` already fails at eslint bootstrap (missing `web/.gitignore`) per Step 3 deviation; unchanged by this step.

### Step 6 (2026-04-25)
- **Header updated:** `갱신: 2026-04-22 | 대상 커밋: c8a7389` → `갱신: 2026-04-25 | 대상 커밋: 0edf7c8 + api_cost feature`. Chose the baseline commit shown at session start (`0edf7c8`) plus a feature tag rather than inventing a new commit hash — the feature is uncommitted at map-update time.
- **Service pricing entries placed under `service/`:** added `pricing.go` and `pricing_test.go` right after `model_router_test.go` to keep the `service/` block grouped. Test-file entry notes the `sumSessionCosts` fold coverage added in the Step 4 deviation, not just the plan's 4-model matrix.
- **`storage.go` and `storage_sqlite.go` descriptions extended in-place:** rather than adding a new bullet, the existing bullets were extended to mention `TotalCost *float64`, the 2nd-query fold path, and the `nil` fallback. Keeps the file-tree section scannable.
- **Frontend `utils/pricing.ts` entry warns about `toLocaleString`:** explicit "locale 독립 — Number.prototype.toLocaleString 사용 금지" line captures the Step 2 plan note so future readers don't regress the formatter.
- **"수정 금지" row added rather than "코딩 컨벤션" line:** plan suggested either. Chose the "수정 금지" table because the invariant is about preventing drift (stronger than a style note) — aligns with existing rows like "providerPatterns 배열 순서".
- **Done condition met:** `grep pricing` → 6 matches, `grep totalCost` → 2 matches.
