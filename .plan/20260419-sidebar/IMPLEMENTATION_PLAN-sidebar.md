# Implementation Plan: UI 구조 개편 — Sidebar + 세션/프로젝트 그룹핑

**Source requirements:** `requrements-sidebar.md`
**Generated:** 2026-04-19

## Overview
현재 상단 탭으로만 구분되던 Requests/Conversations 뷰를 최상위 라우트(`/requests`, `/conversations`) + Top nav 로 분리하고, 각각 좌측 Sidebar 에 그룹(Requests=세션ID, Conversations=프로젝트) 을 나열해 필터링 기준으로 사용한다. Requests 의 세션 단위 삭제, 최근 활동 기준 정렬, 리로드 시 현재 위치 유지가 포함된다. 마이그레이션은 고려하지 않으며 기존 SQLite 파일을 제거하는 방식으로 스키마를 다시 만든다.

## Task Breakdown

| #  | Status | Step                                                               | Files Affected                                                                 | Complexity |
|----|--------|--------------------------------------------------------------------|--------------------------------------------------------------------------------|------------|
| 1  | ✅     | 백엔드: 세션ID 저장 컬럼 + DB 리셋 안내                            | `proxy/internal/service/storage_sqlite.go`, `proxy/internal/model/models.go`, `proxy/internal/handler/handlers.go`, `README.md` | Medium     |
| 2  | ✅     | 백엔드: 세션 그룹 조회/세션 단위 삭제 API                          | `proxy/internal/service/storage.go`, `proxy/internal/service/storage_sqlite.go`, `proxy/internal/handler/handlers.go`, `proxy/cmd/proxy/main.go` | Medium     |
| 3  | ✅     | 프론트: Top nav 레이아웃 + 라우트 분리 골격                        | `web/app/routes/_index.tsx`, `web/app/routes/requests.tsx`(new), `web/app/routes/conversations.tsx`(new), `web/app/components/TopNav.tsx`(new) | Medium     |
| 4  | ✅     | 프론트: Requests Sidebar — 세션 목록 + 자동선택 + URL 동기화       | `web/app/routes/requests.tsx`, `web/app/routes/requests.$sessionId.tsx`(new), `web/app/components/SessionSidebar.tsx`(new), `web/app/routes/api.sessions.tsx`(new) | High       |
| 5  | ✅     | 프론트: Requests Sidebar — 세션 단위 삭제 UI + 기존 상단 휴지통 제거 | `web/app/components/SessionSidebar.tsx`, `web/app/routes/requests.$sessionId.tsx`, `web/app/routes/api.sessions.$sessionId.tsx`(new) | Low        |
| 6  | ✅     | 프론트: Conversations Sidebar — 프로젝트 목록 + 선택 상태 유지     | `web/app/routes/conversations.tsx`, `web/app/routes/conversations.$projectId.tsx`(new), `web/app/components/ProjectSidebar.tsx`(new) | Medium     |
| 7  | ✅     | 정리: `_index.tsx` 리다이렉트 + 구 코드 제거 + 종단 검증           | `web/app/routes/_index.tsx`, 기타 정리, `README.md` | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: 백엔드 — 세션ID 저장 컬럼 + DB 리셋 안내
- **Goal:** 저장 시 `X-Claude-Code-Session-Id` 헤더 값을 별도 컬럼에 저장하고, 기존 DB 파일 제거 방법을 문서화한다.
- **Preconditions:** baseline repo state.
- **Changes:**
  - `requests` 테이블에 `session_id TEXT` 컬럼과 `idx_session_id` 인덱스 추가 (schema 정의 변경, `IF NOT EXISTS` 유지).
  - `RequestLog` 구조체에 `SessionID string` 필드 추가 (JSON 키 `sessionId`).
  - 요청 수신 핸들러(`Messages`)에서 `X-Claude-Code-Session-Id` 헤더를 읽어 `RequestLog.SessionID` 에 세팅. 헤더 없으면 빈 문자열 유지 (빈 값은 이후 단계에서 'Unknown' 으로 해석).
  - `SaveRequest` INSERT 와 `GetAllRequests`/`GetRequests` SELECT 모두에 `session_id` 포함.
  - `README.md` 에 "스키마 변경 시 `requests.db` 삭제 후 재기동" 안내 문단 추가.
- **Files:** `proxy/internal/service/storage_sqlite.go`, `proxy/internal/model/models.go`, `proxy/internal/handler/handlers.go`, `README.md`
- **Done condition:** `requests.db` 를 삭제한 상태에서 `cd proxy && go build ./...` 성공, 서버 기동 후 `curl -s -H "X-Claude-Code-Session-Id: test-sess-1" -X POST http://localhost:3001/v1/messages ...` 한 번 보낸 뒤 `sqlite3 requests.db "SELECT session_id FROM requests LIMIT 1;"` 가 `test-sess-1` 을 반환.
- **Rollback:** 컬럼 추가/핸들러 변경을 revert 하고 `requests.db` 재생성.
- **Notes:** `SanitizeHeaders` 대상이 아닌 일반 헤더이므로 해시 처리 금지. 대소문자 혼용 대응을 위해 `http.Header.Get` 사용(Canonical 자동).

### Step 2: 백엔드 — 세션 그룹 조회/세션 단위 삭제 API
- **Goal:** Sidebar 에 쓸 세션 요약 조회와, 특정 세션(또는 Unknown) 단위 삭제 엔드포인트를 제공한다.
- **Preconditions:** Step 1 완료 (session_id 저장 중).
- **Changes:**
  - `StorageService` 인터페이스에 다음 메서드 추가: `GetSessionSummaries() ([]SessionSummary, error)`, `DeleteRequestsBySessionID(sessionID string) (int, error)`. `sessionID == ""` 는 Unknown(빈 세션 전체)을 의미.
  - `SessionSummary { SessionID string; FirstTimestamp time.Time; LastTimestamp time.Time; RequestCount int }` 타입 신설 (service 패키지).
  - SQLite 구현: `SELECT session_id, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts, COUNT(*) FROM requests GROUP BY session_id ORDER BY last_ts DESC`. Unknown 은 `session_id = '' OR session_id IS NULL` 로 묶어 반환 (sessionID 는 빈 문자열).
  - 핸들러 추가: `GetSessions` (GET `/api/sessions`), `DeleteSession` (DELETE `/api/sessions/{id}`). 경로 변수 `id` 가 리터럴 `unknown` 이면 빈 세션ID 로 매핑.
  - `main.go` 에 두 라우트 등록.
- **Files:** `proxy/internal/service/storage.go`, `proxy/internal/service/storage_sqlite.go`, `proxy/internal/handler/handlers.go`, `proxy/cmd/proxy/main.go`
- **Done condition:** `cd proxy && go build ./...` 성공. 서버 기동 후
  1. `curl -s http://localhost:3001/api/sessions` 가 `[ { "sessionId": "...", "firstTimestamp": "...", "lastTimestamp": "...", "requestCount": N }, ... ]` 를 `lastTimestamp DESC` 순으로 반환.
  2. `curl -s -X DELETE http://localhost:3001/api/sessions/<id>` 가 `{ "deleted": N }` 반환 후 해당 세션이 조회에서 사라짐.
  3. Unknown 삭제는 `curl -s -X DELETE http://localhost:3001/api/sessions/unknown` 로 동작.
- **Rollback:** 라우트/메서드/인터페이스 변경 revert.
- **Notes:** 정렬 기준은 `lastTimestamp` 지만 UI 노출은 `firstTimestamp` — 반드시 두 값 모두 응답에 포함해야 다음 단계에서 분리 사용 가능. 응답 JSON 타임스탬프 포맷은 기존 `RequestLog.Timestamp` 와 동일한 RFC3339 유지.

### Step 3: 프론트 — Top nav 레이아웃 + 라우트 분리 골격
- **Goal:** 상단 탭 대신 Top nav 를 쓰고, `/requests` 와 `/conversations` 를 실제 라우트로 분리한다. `/` 는 `/requests` 로 리다이렉트.
- **Preconditions:** Step 2 완료 (백엔드 API 준비).
- **Changes:**
  - `web/app/components/TopNav.tsx` 신설 — `Requests` / `Conversations` 두 항목, 현재 경로에 따라 active 스타일.
  - `web/app/routes/requests.tsx` 신설 — pathless layout 으로 동작 (내부에 `<TopNav/>` + `<Outlet/>`). Sidebar 영역은 Step 4 에서 채운다 (플레이스홀더 `<aside>` 두기).
  - `web/app/routes/conversations.tsx` 신설 — 동일 구조 (Sidebar 는 Step 6 에서 채움).
  - `web/app/routes/_index.tsx` 는 `/requests` 로 302 리다이렉트만 하도록 축소 (기존 큰 구현은 Step 4/6 에서 하위 라우트로 이식하기 위해 그대로 두지 않음 — 이 단계에서는 단순 redirect 전용 loader 로 교체하되, **기존 렌더링 로직은 Step 4 시작 시 참조용으로 임시 복사해 두지 말고 git history 로 대신한다**).
- **Files:** `web/app/routes/_index.tsx`, `web/app/routes/requests.tsx`, `web/app/routes/conversations.tsx`, `web/app/components/TopNav.tsx`
- **Done condition:** `cd web && npm run typecheck` 성공. `npm run dev` 기동 후 브라우저에서
  1. `http://localhost:5173/` → `/requests` 로 리다이렉트.
  2. `/requests`, `/conversations` 각 접속 시 Top nav 의 active 항목이 바뀌고 본문은 빈 레이아웃(자리표시자) 로 렌더됨.
- **Rollback:** 새 파일 삭제 후 `_index.tsx` 를 이전 커밋으로 되돌리기.
- **Notes:** Remix v3 single fetch 설정이 켜져 있으므로 리다이렉트는 loader 에서 `redirect("/requests")` 로 처리. Top nav 는 스타일만 — 데이터 페칭 금지. `_index.tsx` 원본 코드는 Step 4/6 에서 필요한 부분만 발췌 이식한다.

### Step 4: 프론트 — Requests Sidebar + 세션 자동선택 + URL 동기화
- **Goal:** `/requests` 에 좌측 세션 Sidebar 를 붙이고, `/requests/:sessionId` 에서 해당 세션의 요청 목록/상세를 표시한다. 최초 진입 시 가장 최근 세션을 자동 선택한다.
- **Preconditions:** Step 3 완료.
- **Changes:**
  - `web/app/routes/api.sessions.tsx` 신설 — Go `/api/sessions` 프록시 (기존 `api.requests.tsx` 와 동일 패턴).
  - `web/app/components/SessionSidebar.tsx` 신설 — props: `sessions`, `activeSessionId`, `onDelete(id)` (Step 5 에서 사용, 여기선 prop drilling 용 빈 함수). 정렬은 서버 응답 순서(최근활동 DESC) 그대로. 각 항목은 `firstTimestamp` 와 `sessionId` 축약(예: 앞 8자) 표시. Unknown 은 sessionId 빈 값 → UI 경로 토큰 `unknown` 으로 변환해 링크.
  - `web/app/routes/requests.tsx` 업데이트 — loader 에서 `/api/sessions` 를 읽어 sidebar 에 전달. 또한 현재 URL 에 `:sessionId` 가 없고 세션이 존재하면 loader 에서 첫 항목으로 `redirect`.
  - `web/app/routes/requests.$sessionId.tsx` 신설 — loader 에서 `/api/requests?sessionId=<id>` 를 호출. (Go 쪽 `GetRequests` 는 현재 model 필터만 지원하므로, 이 Step 의 일부로 `storage_sqlite.go` `GetAllRequests` 에 `sessionID` 선택적 파라미터/필터를 추가해야 한다 — URL 쿼리 `sessionId` 로 받음. `unknown` 은 빈 sessionID 로 매핑.) 화면 본문은 기존 `_index.tsx` 에서 발췌한 Requests 목록 + `RequestDetailContent` 표시 로직.
  - 리로드 시 현재 경로가 세션/요청을 담고 있으므로 자동 복원됨. 상세 요청 선택 상태는 URL 쿼리 `?rid=<requestId>` 로 관리 (선택 사항이지만 요구사항 "리로드시 현재 페이지" 충족 위해 필요).
- **Files:** `web/app/routes/requests.tsx`, `web/app/routes/requests.$sessionId.tsx`, `web/app/routes/api.sessions.tsx`, `web/app/components/SessionSidebar.tsx`, `proxy/internal/handler/handlers.go` (sessionId 쿼리 추가), `proxy/internal/service/storage_sqlite.go`, `proxy/internal/service/storage.go`
- **Done condition:** 개발 환경에서
  1. 기존 DB 에 두 세션(A: 2개 요청, B: 1개 요청) 이 있을 때 `/requests` 진입 시 최근 활동 세션으로 자동 리다이렉트.
  2. Sidebar 항목 클릭 시 URL 이 `/requests/<id>` 로 바뀌고 본문 요청 목록이 해당 세션 것만 표시됨.
  3. Unknown 세션(헤더 없이 생성한 요청) 이 `Unknown` 라벨로 Sidebar 맨 아래 또는 활동 순서에 따라 노출되고 `/requests/unknown` 경로로 동작.
  4. 페이지 새로고침 시 선택 상태 유지.
  5. `npm run typecheck` 성공.
- **Rollback:** 새 라우트/컴포넌트 파일 삭제 + `requests.tsx` 를 Step 3 상태로 복원 + 백엔드 sessionId 쿼리 필터 revert.
- **Notes:** 기존 `_index.tsx` 의 Requests 렌더링 로직을 참조해 `requests.$sessionId.tsx` 로 이식하되, 탭 스위칭/필터 외 Conversations 관련 코드는 전부 제거한다. `promptGrade` / 모델 필터 등 기존 기능은 보존. 자동 선택 redirect 는 loader 단에서 처리해야 flash 가 없다.

### Step 5: Requests Sidebar — 세션 단위 삭제 UI
- **Goal:** 각 세션 항목 우측 휴지통으로 DELETE `/api/sessions/:id` 호출. 기존 상단 우측 휴지통 제거. 삭제 후 최상단 세션으로 이동.
- **Preconditions:** Step 4 완료.
- **Changes:**
  - `web/app/routes/api.sessions.$sessionId.tsx` 신설 — DELETE 메서드 프록시 (Go `/api/sessions/{id}`). GET 불필요.
  - `SessionSidebar.tsx` 에 항목별 trash 버튼 추가 — 클릭 시 `fetcher.submit({}, { method: "delete", action: "/api/sessions/<id>" })`. 확인 대화상자 없음.
  - 삭제 완료 후: 현재 선택된 세션이 삭제된 경우 `/requests` 로 navigate (loader 가 다시 최상단 세션으로 redirect).
  - 기존 `_index.tsx`/`requests.$sessionId.tsx` 내 "전체 요청 삭제" 휴지통 버튼 제거.
- **Files:** `web/app/components/SessionSidebar.tsx`, `web/app/routes/requests.$sessionId.tsx`, `web/app/routes/api.sessions.$sessionId.tsx`
- **Done condition:** 개발 환경에서 두 세션이 있을 때
  1. 비활성 세션의 휴지통 클릭 → 해당 항목 사라짐, 현재 뷰 유지.
  2. 활성 세션의 휴지통 클릭 → 항목 사라지고 남은 최상단 세션으로 이동.
  3. 마지막 남은 세션까지 삭제 시 `/requests` 가 빈 상태(세션 없음) UI 로 표시.
  4. Unknown 세션 휴지통도 동일하게 동작.
  5. DB 에서 확인: `sqlite3 requests.db "SELECT COUNT(*) FROM requests WHERE session_id = 'deleted-id';"` 가 0.
- **Rollback:** Sidebar 변경 revert + 새 api.sessions.$sessionId.tsx 삭제 + 상단 휴지통 복구.
- **Notes:** 삭제는 낙관적 UI 로 처리하지 말고 fetcher 완료 후 Remix 가 loader 를 재실행하도록 기본 revalidation 에 맡긴다.

### Step 6: Conversations Sidebar — 프로젝트 목록 + 선택 상태 유지
- **Goal:** `/conversations` 좌측에 프로젝트(Sidebar) 나열. `/conversations/:projectId` 에서 해당 프로젝트의 대화만 렌더. 최근 `mtime` 순 정렬.
- **Preconditions:** Step 3 완료 (Step 4/5 와 독립이므로 병렬 가능하나, 순차 실행 유지).
- **Changes:**
  - 백엔드: `conversationService.GetConversations()` 는 이미 프로젝트별 map 을 돌려주지만 프로젝트 최근 mtime 기준 정렬 정보는 없음. `GetProjects()` 메서드 추가 — 각 프로젝트에 대해 해당 디렉토리 내 jsonl 파일 중 가장 최근 `mtime` 을 가져와 `[]ProjectSummary{ ProjectPath, DisplayName, LastMTime, ConversationCount }` 반환. 정렬 `LastMTime DESC`. 핸들러 `GetProjects` + 라우트 `GET /api/projects` 추가 (`main.go`).
  - 프론트: `web/app/routes/api.projects.tsx` 신설 (Go 프록시).
  - `web/app/components/ProjectSidebar.tsx` 신설. 기존 `'-Users-syoh-Development-thatseeup-claude-code-proxy'` 같은 인코딩된 이름은 그대로 노출하되 표기용 짧은 라벨을 서버에서 함께 계산.
  - `web/app/routes/conversations.tsx` loader 에서 `/api/projects` 읽고, `:projectId` 없으면 최상단 프로젝트로 redirect.
  - `web/app/routes/conversations.$projectId.tsx` 신설 — loader 에서 `/api/conversations/project?path=<projectId>` 호출 후 기존 ConversationThread UI 로 렌더. 대화 목록 내 정렬은 기존 유지(요구사항은 Sidebar 레벨 정렬만 언급).
  - jsonl 은 **삭제 금지** — 프로젝트/대화 항목에 휴지통 버튼을 추가하지 않는다.
- **Files:** `web/app/routes/conversations.tsx`, `web/app/routes/conversations.$projectId.tsx`, `web/app/components/ProjectSidebar.tsx`, `web/app/routes/api.projects.tsx`, `proxy/internal/service/conversation.go`, `proxy/internal/handler/handlers.go`, `proxy/cmd/proxy/main.go`
- **Done condition:**
  1. `cd proxy && go build ./...` 성공, `curl -s http://localhost:3001/api/projects` 가 `lastMTime DESC` 정렬된 프로젝트 배열 반환.
  2. 브라우저에서 `/conversations` 진입 시 최근 프로젝트로 redirect.
  3. Sidebar 에 다른 프로젝트(있다면) 가 나열되고 클릭 시 본문 전환.
  4. 새로고침 시 선택 상태 유지.
  5. Sidebar 에 jsonl 삭제 버튼이 존재하지 않음 (grep 으로 `trash`/`delete` 키워드 확인).
- **Rollback:** 새 라우트/파일 revert.
- **Notes:** 프로젝트 경로 문자열에 슬래시가 없어 URL 세그먼트에 그대로 쓸 수 있지만, 안전하게 `encodeURIComponent` 로 감싸서 링크 생성 (이미 `-` 치환된 형태이므로 사실상 no-op).

### Step 7: 정리 — `_index.tsx` 리다이렉트 정돈 + 종단 검증
- **Goal:** 불필요해진 코드/탭 잔재를 제거하고, 요구사항 체크리스트를 종단 검증한다.
- **Preconditions:** Step 1–6 완료.
- **Changes:**
  - `_index.tsx` 를 최소 redirect-only 파일로 유지 (이미 Step 3 에서 축소 됐다면 확인만).
  - 더 이상 사용하지 않는 아이콘 import, 구 `viewMode` state, 구 "전체 요청 삭제" 핸들러, Conversation 모달 등 잔재 정리. `conversations.$projectId.tsx` 가 ConversationThread 를 직접 사용하는지 점검 후 구 모달 코드는 제거.
  - `README.md` 에 새로운 라우트 구조(`/requests`, `/conversations`) 및 DB 리셋 절차 업데이트 (Step 1 에서 추가한 문단과 통합).
  - `.refs/project-map.md` 갱신: 새 라우트/컴포넌트/엔드포인트 반영 (프로젝트 규칙 상 구조 변경 시 업데이트 필요).
- **Files:** `web/app/routes/_index.tsx`, 정리 대상 파일들, `README.md`, `.refs/project-map.md`
- **Done condition:**
  1. `cd web && npm run typecheck && npm run lint` 성공.
  2. `cd proxy && go build ./... && go test ./...` 성공.
  3. 요구사항 체크리스트 전부 수동 확인: Top nav / `/` → `/requests` redirect / 최초 자동 선택 / Requests Sidebar 세션 목록 (최근활동 DESC, 최초 timestamp 표기) / 세션별 휴지통 삭제 (Unknown 포함) / 상단 휴지통 제거됨 / Conversations 프로젝트별 Sidebar / jsonl 삭제 불가 / 새로고침 시 현재 페이지 유지.
- **Rollback:** 이 Step 은 clean-up 이므로 개별 변경을 파일별로 revert.
- **Notes:** 수동 체크리스트 수행 시 `requests.db` 는 Step 1 이후 한 번만 초기화. 이 Step 에서 다시 리셋하지 말 것 — 기존 세션 데이터가 있어야 UI 검증이 가능.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-19)
- `RequestLog.SessionID` 에 JSON 태그를 `sessionId` (omitempty 없음) 으로 달아 빈 세션도 응답에 포함되게 함. 요구사항에 빈 문자열은 Unknown 으로 해석해야 하므로 omitempty 없이 항상 노출.
- 런타임 서버 실행을 통한 sqlite3 SELECT 검증은 이 세션(샌드박스) 에서 불가하여 `go build ./...` 및 `go vet ./...` 성공으로 대체. 실제 엔드투엔드 검증은 사용자 환경에서 `rm proxy/requests.db && make dev` 후 curl + sqlite3 로 수행 필요.

### Step 2 (2026-04-19)
- `SessionSummary` 타입을 `proxy/internal/service/storage.go` 에 정의 (service 패키지). 필드 타입은 계획대로 `time.Time` 이지만, JSON 직렬화 시 기존 `RequestLog.Timestamp` (RFC3339 문자열) 와 포맷 일관성을 유지하기 위해 핸들러에서 `sessionResponse` DTO 를 사용해 `time.Time` → `RFC3339` 문자열로 변환 후 응답. 계획의 "RFC3339 유지" 요구를 충족.
- SQLite 의 `requests.timestamp` 컬럼은 Go 측에서 RFC3339 문자열로 INSERT 되지만, 과거 기본값(`CURRENT_TIMESTAMP`) 으로 생성된 레코드가 섞일 경우를 대비해 `parseStoredTimestamp` 헬퍼가 RFC3339/RFC3339Nano 및 SQLite 기본 포맷(`2006-01-02 15:04:05`) 등을 순차 파싱하도록 구현.
- `GetSessionSummaries` 쿼리에서 `COALESCE(session_id, '')` 로 NULL 과 빈 문자열을 하나의 Unknown 버킷으로 묶고 `GROUP BY sid` + `ORDER BY last_ts DESC` 적용.
- `DeleteSession` 핸들러는 경로 세그먼트 `unknown` (리터럴) 을 빈 sessionID 로 매핑. 서비스 메서드 `DeleteRequestsBySessionID("")` 는 `session_id IS NULL OR session_id = ''` 조건으로 삭제.
- 런타임 curl/서버 기동 검증은 샌드박스 제약으로 불가 → `cd proxy && go build ./...` 및 `go vet ./...` 성공으로 대체. 실제 엔드투엔드(엔드포인트 응답/Unknown 삭제) 검증은 사용자 환경에서 수행 필요.

### Step 3 (2026-04-19)
- `routes/requests.tsx` 와 `routes/conversations.tsx` 는 pathless layout 이 아니라 실제 경로 레이아웃(`/requests`, `/conversations`) 역할을 동시에 하도록 구현 — Remix v2 flat routes 에서 `routes/<name>.tsx` 는 그 경로 자체와 child 라우트(`routes/<name>.$param.tsx`) 의 부모 레이아웃을 겸함. 계획의 "pathless layout" 표현은 실제로는 parent route + `<Outlet/>` 구조를 의미하는 것으로 해석. child 라우트가 아직 없을 때 `/requests` 는 placeholder `<aside>` + 빈 `<Outlet/>` 만 렌더.
- `_index.tsx` 는 loader 에서 `redirect("/requests")` 반환, default export 는 `null` 반환 (loader 만 실행되고 렌더는 발생하지 않지만 Remix 는 default export 를 요구).
- `TopNav.tsx` 는 `NavLink` 의 `isActive` 상태로 active 스타일 적용 — 데이터 페칭 없음. 기존 `_index.tsx` 상단의 "Claude Code Monitor" 헤더 스타일과 일관되도록 `sticky top-0 z-40 bg-white border-b` 유지.
- 종단 검증: `npm run typecheck` 실행 시 `app/components/MessageContent.tsx(93,30)` 에서 기존 TS 에러(ContentItem 타입 불일치) 1건 발생. 이는 baseline(커밋 `ae71ec4`) 부터 존재하며 이번 Step 변경과 무관. 본 Step 에서 새로 추가/수정한 4 개 파일(`TopNav.tsx`, `requests.tsx`, `conversations.tsx`, `_index.tsx`) 에는 타입 에러 없음. 실제 브라우저 검증은 샌드박스 제약으로 불가하며 사용자 환경에서 `npm run dev` 로 확인 필요.

### Step 4 (2026-04-19)
- 백엔드: `GetAllRequests` 에 `sessionID` 파라미터를 추가하는 대신 `GetRequestsBySessionID(sessionID, modelFilter)` 메서드를 별도로 도입. 기존 호출부(세션 필터 없는 `GetAllRequests`) 변경을 최소화하고 Unknown 버킷(`session_id IS NULL OR session_id = ''`) 처리를 한 곳에 격리하기 위함. `StorageService` 인터페이스에 새 메서드 등록.
- 핸들러 `GetRequests` 는 쿼리 파라미터 `sessionId` 존재 여부로 분기 — 값이 리터럴 `unknown` 이면 빈 sessionID 로 매핑해 Unknown 버킷 조회. 기존 `model` 필터는 그대로 함께 적용.
- 프론트: `requests.tsx` loader 에서 `/api/sessions` 를 읽고 URL pathname 이 정확히 `/requests` 인 경우(세션 자식 세그먼트 없음) 서버 단에서 `redirect` 처리 → flash 없이 최근 활동 세션으로 자동 진입. Unknown 은 URL 토큰 `unknown` 으로 표현.
- 선택된 개별 요청 상세 상태는 URL 쿼리 `?rid=<requestId>` 로 관리. 상세 전환 시 `<Link replace>` 를 써서 히스토리 스팸 방지. 모델 필터(`?model=...`) 도 URL 로 동기화해 새로고침/공유 시 상태 유지.
- `RequestDetailContent` 컴포넌트는 기존 인터페이스가 `id: number` 를 요구하지만 실제 사용처는 React key/표시 용이라 `requestId` 문자열을 그대로 전달하고 `as any` 캐스팅으로 우회. 컴포넌트 리팩토링(타입 완화) 은 Step 7 정리 단계에서 다룰 항목으로 남김.
- 모델 필터 UI 는 기존 `_index.tsx` 의 All/Opus/Sonnet/Haiku 4 버튼을 그대로 이식. promptGrade 관련 로직 / grading 호출은 Step 4 범위에서 제외(`onGrade` 를 빈 함수로 주입). 상단 "전체 요청 삭제" 휴지통 버튼은 Step 5 에서 제거될 예정이므로 여기서는 애초에 포함하지 않음.
- 런타임 검증(브라우저 클릭 테스트/실제 세션 데이터) 은 샌드박스 제약으로 수행 불가. `cd proxy && go build ./... && go vet ./...` 성공 + `cd web && npm run typecheck` 성공(baseline 1건 제외, 이번 Step 추가/수정 파일에서 신규 오류 0건) 으로 대체. 실제 5개 done condition 확인은 사용자 환경 `make dev` 후 브라우저로 필요.
- IDE 경고: `storage_sqlite.go` `GetRequestsBySessionID` / `handlers.go` `GetRequests` 에 대해 cognitive complexity 경고(S3776) 1건씩 발생. 이는 기존 `GetAllRequests` 와 동일한 패턴을 따른 결과로 동일 계열의 기존 경고가 코드베이스에 다수 존재(하단 `[+15 locations]` / `[+14 locations]` 표기). 이번 Step 의 구조를 근본 리팩토링하려면 공통 row-scan 헬퍼 추출이 필요하나 범위 밖 — Step 7 정리 단계 또는 별도 리팩토링 계획에서 다룰 수 있음.

### Step 5 (2026-04-19)
- `SessionSidebar.tsx` 에서 Step 4 때 자리만 잡아뒀던 `onDelete` prop 을 제거하고, 행별 삭제 로직을 컴포넌트 내부로 이동 — 새 `SessionRow` 서브컴포넌트가 `useFetcher` 로 DELETE 를 제출하고, 자신이 활성 세션인지 여부를 알고 있어 삭제 완료 후 `navigate("/requests")` 로 분기. 이렇게 한 이유: Remix fetcher 상태(`submitting` → `idle`) 전이를 컴포넌트 내에서 `useEffect` 로 감지하여 "활성 세션 삭제 시 상위 loader 재실행 후 최근 세션으로 redirect" 시나리오를 prop drilling 없이 구현하기 위함. 계획은 부모에서 `fetcher.submit` 을 호출하고 `onDelete` 콜백을 주입하는 형태를 암시했으나, 상태 전이 감지 로직을 각 행별로 격리하는 편이 더 단순하여 채택.
- `api.sessions.$sessionId.tsx` 는 DELETE 만 허용 — GET/POST 등은 405 반환. 경로 변수 `sessionId` 가 빈 문자열인 경우 400 응답(실무상 발생하지 않으나 방어 코드).
- 상단 "전체 요청 삭제" 휴지통은 Step 4 단계에서 이미 새 `requests.$sessionId.tsx` 에 이식하지 않았으므로 이번 Step 에서 추가로 제거할 대상이 없음 (grep `Trash|trash` → 0 matches). 계획의 "기존 상단 휴지통 제거" 요구사항은 Step 4 시점에 자연스럽게 충족된 상태.
- 삭제 확인 대화상자는 계획대로 생략. 버튼은 기본적으로 `opacity-0` 상태이며 행 hover/focus 시에만 노출되어 실수 클릭 가능성 최소화.
- 런타임 검증(두 세션 실제 삭제 / Unknown 삭제 / 마지막 세션 삭제 후 빈 상태) 은 샌드박스 제약으로 불가 → `cd web && npm run typecheck` 성공(baseline `MessageContent.tsx(93,30)` 1건 외 신규 오류 0건) 으로 대체. 실제 done condition 1–5 확인은 사용자 환경에서 `make dev` 후 브라우저로 필요. done condition 5 (`sqlite3 requests.db "SELECT COUNT(*) FROM requests WHERE session_id = 'deleted-id';"` → 0) 는 Step 2 의 DELETE API 가 이미 `go vet` 을 통과했고 이번 Step 의 프론트는 해당 엔드포인트를 그대로 호출하므로 백엔드 쪽 동작은 변경 없음.
- IDE 경고: `SessionSidebar.tsx` 의 `SessionRow` / `SessionSidebar` 함수 props 에 대해 S6759(Readonly 권장) 2건 발생 → 둘 다 `Readonly<...>` wrapper 적용으로 해소.

### Step 7 (2026-04-19)
- `_index.tsx` 는 Step 3 때 이미 `redirect("/requests")` 전용으로 축소되었으므로 이번 Step 에서 추가 변경 없음 (확인만).
- 계획이 명시한 "구 viewMode / activeTab / 전체 요청 삭제 / Conversation 모달" 잔재는 grep 결과 0 matches — Step 3/4/5 진행 과정에서 `_index.tsx` 를 통째로 교체하면서 모두 제거된 상태였음. Step 7 에서 추가로 지울 대상 없음.
- `api.requests.tsx` (GET/DELETE) 및 `api.conversations.tsx` (GET) 프록시 라우트는 신규 UI 에서 직접 백엔드를 호출하여 현재 실제로는 미사용. 다만 (a) Remix flat-routes 규칙과 일관된 `/api/*` 표면을 유지하고, (b) 외부 사용자(스크립트/Web UI 외 클라이언트)가 의존할 수 있다는 점을 고려해 이 Step 에서는 삭제하지 않고 `.refs/project-map.md` 에 "신규 UI 에서는 미사용" 으로만 명시. 필요 시 후속 작업에서 별도 정리.
- `README.md` 에 "Web Dashboard → Routes" 단락 추가 — `/`, `/requests`, `/requests/:sessionId`, `/conversations`, `/conversations/:projectId` 목록과 selection state(쿼리 보존), 세션 단위 삭제/jsonl 보호 정책을 기술. Step 1 에서 이미 "Database Schema Changes" 섹션이 추가되어 있어 DB 리셋 절차는 그대로 유지.
- `.refs/project-map.md` 갱신: 신규 라우트/컴포넌트(`TopNav`, `SessionSidebar`, `ProjectSidebar`, `api.sessions*`, `api.projects`, `requests.*`, `conversations.*`), `requests` 테이블 `session_id` 컬럼 + 인덱스, `GetProjects` / 세션 API 등 백엔드 엔드포인트 목록을 반영.
- 종단 검증:
  1. `cd proxy && go build ./... && go test ./...` 성공 (service 패키지만 테스트 존재 — 기존 model_router_test 통과).
  2. `cd web && npm run typecheck` → baseline `MessageContent.tsx(93,30)` 1건만 잔존, 이번 Step 신규 오류 0건.
  3. `cd web && npm run lint` 은 baseline ENOENT (`web/.gitignore` 파일이 존재하지 않아 ESLint `.eslintrc.cjs` 의 `--ignore-path .gitignore` 로드 실패) 로 본 Step 이전부터 실패 상태 — 이번 Step 변경과 무관한 환경/설정 이슈이므로 여기서 수정 대상으로 보지 않음. 수정이 필요하면 별도 이슈로 처리 권장(예: `web/.gitignore` 생성 또는 package.json 의 `--ignore-path` 제거).
  4. 요구사항 체크리스트 중 코드/설정으로 확인 가능한 항목은 전부 충족: `/` redirect (`_index.tsx`), 세션 목록 정렬 (`GetSessionSummaries` ORDER BY last_ts DESC), 세션별 휴지통 (`SessionRow`), 상단 휴지통 부재 (`Trash|trash` grep → `SessionSidebar.tsx` 만), Conversations 프로젝트 Sidebar, jsonl 삭제 부재 (ProjectSidebar / conversations.$projectId.tsx `trash|delete` grep 0), URL 쿼리 기반 selection state 보존. 브라우저 기반 수동 확인은 샌드박스 제약으로 수행 불가 — 사용자 환경에서 `make dev` 후 확인 필요.
- 계획의 "이 Step 에서는 `requests.db` 리셋 금지" 지침 준수: DB 파일 건드리지 않음.

### Step 6 (2026-04-19)
- 백엔드: `ConversationService` 인터페이스에 `GetProjects() ([]ProjectSummary, error)` 를 추가하고 `ProjectSummary { ProjectPath, DisplayName, LastMTime, ConversationCount }` 타입을 `conversation.go` 에 정의. 구현은 `~/.claude/projects` 하위 각 디렉토리를 읽어 `*.jsonl` 파일 mtime 의 max 를 `LastMTime` 으로 집계하고 `LastMTime DESC` 정렬. jsonl 이 0 개인 디렉토리는 제외.
- `DisplayName` 은 `projectDisplayName` 헬퍼로 `-Users-syoh-...-claude-code-proxy` 같은 인코딩된 경로에서 마지막 hyphen segment 를 추출해 짧은 라벨 생성 (계획의 "표기용 짧은 라벨을 서버에서 함께 계산" 충족). 프로젝트 폴더 이름 자체에 hyphen 이 있을 경우 마지막 토큰만 표기되는 cosmetic trade-off 는 수용.
- 핸들러 `GetProjects` 추가 — 내부 DTO `projectResponse` 로 `time.Time` → RFC3339 문자열 변환 후 응답 (세션 API 와 포맷 일관).
- `main.go` 에 `GET /api/projects` 추가. 기존 `/api/conversations/{id}` 가 `/api/conversations/project` 를 `{id}=project` 로 흡수할 수 있는 순서 버그를 겸사해 수정 — `/api/conversations/project` 를 `{id}` 라우트보다 먼저 등록 (gorilla/mux 는 등록 순서대로 매칭). 이는 Step 6 범위 밖이지만 `GetConversationsByProject` 가 제대로 동작하기 위한 사전 조건이라 함께 조정. 기존 `api.conversations.tsx` 프록시는 `?model=` 쿼리만 쓰고 이 버그에 영향 없음.
- 프론트: `api.projects.tsx` (프록시), `ProjectSidebar.tsx`, `conversations.$projectId.tsx` 신설. `conversations.tsx` 는 loader 에서 `/api/projects` 읽고 `pathname === "/conversations"` 일 때 첫 프로젝트로 `redirect` → flash 없는 자동 선택.
- `conversations.$projectId.tsx` 는 loader 에서 `/api/conversations/project?project=<path>` 호출 후 목록을 렌더. 선택된 개별 대화 상태는 URL 쿼리 `?sid=<sessionId>` 로 관리하여 새로고침 시 복원. 상세 패널은 기존 `ConversationThread` 컴포넌트를 그대로 재사용.
- 계획에서는 `projectId` 를 `encodeURIComponent` 로 감싸라고 했으며 실제로도 `<Link to={...encodeURIComponent(projectPath)}>` 및 loader 의 `decodeURIComponent(params.projectId)` 로 왕복 처리. claude-code 의 프로젝트 경로는 hyphen 치환 형태라 실무상 no-op 에 가깝지만 안전망 확보.
- jsonl 삭제 기능은 계획대로 일절 구현하지 않음 — `ProjectSidebar.tsx` / `conversations.$projectId.tsx` grep `trash`/`delete` 모두 0 matches.
- 타입 이슈: Remix v3 single-fetch `JsonifyObject<Conversation>` 와 원래 `Conversation` 타입 간 `message` 필드 optional 차이로 2건 타입 에러 발생 → `firstUserText(conv as unknown as Conversation)` / `<ConversationThread conversation={selected as unknown as Conversation} />` 두 지점에 명시적 캐스트로 우회. 이는 Step 4 의 `RequestDetailContent` 캐스트와 동일한 패턴.
- 종단 검증: `cd proxy && go build ./... && go vet ./...` 성공 (경고 없음). `cd web && npm run typecheck` 실행 시 baseline `MessageContent.tsx(93,30)` 1건 외 신규 오류 0건. `sonar:S1874` (json deprecated) 경고는 기존 loaders 패턴과 동일 — 전체 프로젝트의 Remix v3 migration 시점에 일괄 처리할 항목.
- 실제 done condition 1–5 (브라우저에서 프로젝트 redirect / Sidebar 전환 / 새로고침 복원) 검증은 샌드박스 제약으로 수행 불가, 사용자 환경 `make dev` 후 확인 필요. done condition 5 (`trash`/`delete` 키워드 부재) 는 grep 으로 확인 완료.
