# Implementation Plan: UI 구조 개편 — Sidebar + 세션/프로젝트 그룹핑

**Source requirements:** `requrements-sidebar.md`
**Generated:** 2026-04-19

## Overview
현재 상단 탭으로만 구분되던 Requests/Conversations 뷰를 최상위 라우트(`/requests`, `/conversations`) + Top nav 로 분리하고, 각각 좌측 Sidebar 에 그룹(Requests=세션ID, Conversations=프로젝트) 을 나열해 필터링 기준으로 사용한다. Requests 의 세션 단위 삭제, 최근 활동 기준 정렬, 리로드 시 현재 위치 유지가 포함된다. 마이그레이션은 고려하지 않으며 기존 SQLite 파일을 제거하는 방식으로 스키마를 다시 만든다.

## Task Breakdown

| #  | Status | Step                                                               | Files Affected                                                                 | Complexity |
|----|--------|--------------------------------------------------------------------|--------------------------------------------------------------------------------|------------|
| 1  | ⬜     | 백엔드: 세션ID 저장 컬럼 + DB 리셋 안내                            | `proxy/internal/service/storage_sqlite.go`, `proxy/internal/model/models.go`, `proxy/internal/handler/handlers.go`, `README.md` | Medium     |
| 2  | ⬜     | 백엔드: 세션 그룹 조회/세션 단위 삭제 API                          | `proxy/internal/service/storage.go`, `proxy/internal/service/storage_sqlite.go`, `proxy/internal/handler/handlers.go`, `proxy/cmd/proxy/main.go` | Medium     |
| 3  | ⬜     | 프론트: Top nav 레이아웃 + 라우트 분리 골격                        | `web/app/routes/_index.tsx`, `web/app/routes/requests.tsx`(new), `web/app/routes/conversations.tsx`(new), `web/app/components/TopNav.tsx`(new) | Medium     |
| 4  | ⬜     | 프론트: Requests Sidebar — 세션 목록 + 자동선택 + URL 동기화       | `web/app/routes/requests.tsx`, `web/app/routes/requests.$sessionId.tsx`(new), `web/app/components/SessionSidebar.tsx`(new), `web/app/routes/api.sessions.tsx`(new) | High       |
| 5  | ⬜     | 프론트: Requests Sidebar — 세션 단위 삭제 UI + 기존 상단 휴지통 제거 | `web/app/components/SessionSidebar.tsx`, `web/app/routes/requests.$sessionId.tsx`, `web/app/routes/api.sessions.$sessionId.tsx`(new) | Low        |
| 6  | ⬜     | 프론트: Conversations Sidebar — 프로젝트 목록 + 선택 상태 유지     | `web/app/routes/conversations.tsx`, `web/app/routes/conversations.$projectId.tsx`(new), `web/app/components/ProjectSidebar.tsx`(new) | Medium     |
| 7  | ⬜     | 정리: `_index.tsx` 리다이렉트 + 구 코드 제거 + 종단 검증           | `web/app/routes/_index.tsx`, 기타 정리, `README.md` | Low        |

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
_None._
