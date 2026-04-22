# Implementation Plan: Projects/Sessions 매칭

**Source requirements:** `requirements-matching_projects.md`
**Generated:** 2026-04-22

## Overview
Requests 페이지와 Conversations 페이지가 공통 Session ID 를 공유함에도 UI 상 분리되어 있는 상태를 해결한다. 서버는 기동 시 `~/.claude/projects` 전체를 블로킹으로 인덱싱해 `sessionID → {projectPath, displayName, title}` 매핑을 메모리에 보관하고, 파일 변경(OS 이벤트 + 폴링 폴백)을 감시해 유지한다. `/api/sessions` 응답이 이 정보를 함께 반환해 Requests 세션 카드에 프로젝트/타이틀을 표시하고, 양 페이지 사이의 바로가기 버튼을 추가한다.

## Task Breakdown

| #  | Status | Step                                               | Files Affected                                                                                                     | Complexity |
|----|--------|----------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|------------|
| 1  | ✅     | Title 추출 전용 함수 분리                           | `proxy/internal/service/conversation.go`, `conversation_test.go`                                                   | Low        |
| 2  | ✅     | SessionIndex 서비스(메모리 맵 + 초기 구축)          | `proxy/internal/service/session_index.go`, `session_index_test.go`, `cmd/proxy/main.go`                            | Medium     |
| 3  | ✅     | 파일 변경 감시(fsnotify + 폴링 폴백)                | `proxy/internal/service/session_index.go`, `proxy/go.mod`, `proxy/go.sum`, `cmd/proxy/main.go`                     | Medium     |
| 4  | ✅     | `/api/sessions` 응답에 project/title 필드 추가      | `proxy/internal/service/storage.go`, `proxy/internal/handler/handlers.go`, `cmd/proxy/main.go`                     | Medium     |
| 5  | ✅     | Requests 세션 카드에 프로젝트 이름 + 타이틀 표시    | `web/app/components/SessionPicker.tsx`, `web/app/routes/requests.tsx`, `web/app/routes/requests.$sessionId.tsx`    | Medium     |
| 6  | ✅     | Requests → Conversations 바로가기 버튼             | `web/app/components/SessionPicker.tsx`                                                                             | Low        |
| 7  | ✅     | Conversations → Requests 바로가기 버튼             | `web/app/routes/conversations.$projectId.tsx`                                                                      | Medium     |
| 8  | ✅     | `.refs/project-map.md` 업데이트                     | `.refs/project-map.md`                                                                                             | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: Title 추출 전용 함수 분리
- **Goal:** `parseConversationFile` 이 수행하는 title 추출 로직을 독립 함수로 떼어내 SessionIndex 가 파일 전체 메시지를 파싱하지 않고도 title 만 얻을 수 있게 한다.
- **Preconditions:** baseline repo state.
- **Changes:**
  - `conversation.go` 에 `extractSessionTitle(filePath string) (title string, err error)` 신설. 내부는 기존 `extractTitleFromLine` 재사용, `type == "ai-title" | "custom-title"` 라인만 스캔해서 마지막 등장값을 돌려준다. 버퍼 크기는 기존 `parseConversationFile` 과 동일(10MB).
  - 기존 `parseConversationFile` 동작은 변경 없음(현재 사용처 보존).
  - 단위 테스트(`conversation_test.go` 신설 또는 확장): customTitle 우선 / aiTitle 폴백 / 제목 없음 / 여러 번 등장 시 마지막 값 / 파일 미존재 / 라인 불량 케이스.
- **Files:** `proxy/internal/service/conversation.go`, `proxy/internal/service/conversation_test.go`.
- **Done condition:** `go test ./proxy/internal/service -run TestExtractSessionTitle -count=1` 전체 PASS.
- **Rollback:** 새 함수 + 테스트 삭제.
- **Notes:** 다른 모듈에서 사용할 수 있도록 export 여부는 패키지 내부 노출이면 충분(패키지 동일). 이름은 소문자로 유지해도 무방.

### Step 2: SessionIndex 서비스 (메모리 맵 + 초기 구축)
- **Goal:** `sessionID → {projectPath(encoded), displayName, title}` 매핑을 메모리에 보관하는 `SessionIndex` 서비스를 도입하고, 서버 기동 시 HTTP listen 이전에 블로킹으로 초기 구축한다.
- **Preconditions:** Step 1 완료.
- **Changes:**
  - `proxy/internal/service/session_index.go` 신설:
    - `type SessionIndexEntry struct { SessionID, ProjectPath, DisplayName, Title string }`
    - `type SessionIndex interface { Lookup(sessionID string) (SessionIndexEntry, bool); Rebuild() error }`
    - 구현체는 `sync.RWMutex` 로 보호된 `map[string]SessionIndexEntry` 하나. `NewSessionIndex(rootDir string)` 생성자.
    - `Rebuild`: `rootDir` (`~/.claude/projects`) 하위 각 디렉토리 순회 → `*.jsonl` 을 찾아 파일명(확장자 제거)을 sessionID 로, 디렉토리 이름은 encoded projectPath, `projectDisplayName(encoded)` 은 displayName, `extractSessionTitle(path)` 은 title 로 하여 엔트리 생성. 맵을 새로 만들어 atomic swap.
    - `rootDir` 이 존재하지 않으면 빈 인덱스로 취급(에러 아님). jsonl 개별 파일 오류는 로그만 남기고 스킵.
  - `cmd/proxy/main.go`:
    - `homeDir, _ := os.UserHomeDir(); rootDir := filepath.Join(homeDir, ".claude", "projects")`
    - `idx := service.NewSessionIndex(rootDir); if err := idx.Rebuild(); err != nil { log.Fatalf(...) }`
    - `idx` 를 handler 생성 시 주입하도록 시그니처 수정 준비(실제 사용은 Step 4).
  - 테스트(`session_index_test.go`): 임시 디렉토리에 `proj-dir-A/{sid1,sid2}.jsonl` + 그 안에 `ai-title`/`custom-title` 라인 구성 → `Rebuild` → `Lookup` 결과 검증. 동시성 테스트 하나(Lookup 과 Rebuild 병행).
- **Files:** `proxy/internal/service/session_index.go`, `proxy/internal/service/session_index_test.go`, `proxy/cmd/proxy/main.go`.
- **Done condition:** `go test ./proxy/internal/service -run TestSessionIndex -count=1` PASS 및 `go build ./...` 성공.
- **Rollback:** 새 파일 삭제 + main.go 의 인덱스 초기화 호출 제거.
- **Notes:** `projectDisplayName` 은 파일시스템 stat 을 하므로 Rebuild 중 초당 호출 수가 많아도 로컬에서는 충분히 빠르다. 성능 이슈가 관측되면 추후 단일 호출 결과를 디렉토리 단위로 메모이즈.

### Step 3: 파일 변경 감시 (fsnotify + 폴링 폴백)
- **Goal:** 프로젝트 디렉토리/jsonl 의 생성·변경·삭제 이벤트를 감지해 인덱스를 자동 갱신한다. OS 이벤트 사용이 여의치 않으면 10초 폴링으로 폴백한다.
- **Preconditions:** Step 2 완료.
- **Changes:**
  - `proxy/go.mod` 에 `github.com/fsnotify/fsnotify` 추가 (`go get github.com/fsnotify/fsnotify@latest` → `go mod tidy`).
  - `SessionIndex` 에 `Watch(ctx context.Context) error` 추가:
    - 1차: `fsnotify.NewWatcher()` 시도. `rootDir` + 현재 존재하는 각 프로젝트 서브디렉토리를 `Add`.
    - 이벤트 처리:
      - `Create` 가 디렉토리 → watcher 에 추가하고 그 안의 jsonl 들을 인덱스에 삽입.
      - `Create` / `Write` 가 `*.jsonl` → 해당 sessionID 엔트리를 upsert (title 재추출).
      - `Remove` / `Rename` 가 `*.jsonl` → 해당 엔트리 삭제.
      - `Remove` / `Rename` 가 프로젝트 디렉토리 → 하위 sessionID 엔트리 모두 삭제 + watcher 에서 해제.
    - 2차(폴백): watcher 생성 실패 시 `time.Ticker(10*time.Second)` 로 `Rebuild()` 반복. `ctx.Done()` 수신 시 종료.
  - `cmd/proxy/main.go`: HTTP 서버 기동 **뒤에** `go idx.Watch(ctx)` (이 때 ctx 는 shutdown 시 cancel). 기존 shutdown hook 에 cancel 호출 추가.
  - 테스트(`session_index_test.go`에 추가 또는 `session_index_watch_test.go`): 폴링 모드를 강제하는 내부 플래그(`WithPollInterval(d time.Duration)` 옵션 또는 package-private setter) 제공. 임시 디렉토리에 파일 생성/수정/삭제 → 인덱스가 반영되는지 확인. fsnotify 경로는 CI 환경 이식성을 위해 선택적 테스트(`-tags fsnotify`) 로 남겨도 됨.
- **Files:** `proxy/internal/service/session_index.go`, `proxy/go.mod`, `proxy/go.sum`, `proxy/cmd/proxy/main.go`, `proxy/internal/service/session_index_test.go`.
- **Done condition:** `go build ./...` 성공 + `go test ./proxy/internal/service -run TestSessionIndexWatch -count=1` PASS.
- **Rollback:** watcher 기동 호출 제거, 새 의존성 revert, 감시 코드 삭제.
- **Notes:** fsnotify 는 재귀 감시를 지원하지 않아 프로젝트 서브디렉토리마다 `Add` 필요. 디렉토리가 지워지면 watcher 에서 자동 제거되므로 내부 레지스트리와 동기화에 유의.

### Step 4: `/api/sessions` 응답에 project/title 필드 추가
- **Goal:** 세션 목록 API 가 인덱스를 조회해 project/title 을 함께 반환한다. 인덱스에 없으면 "Project Not Found" 로 프런트가 구분할 수 있도록 빈 문자열 + `hasConversation=false` 를 명시한다.
- **Preconditions:** Step 3 완료.
- **Changes:**
  - `SessionSummary` 타입(`proxy/internal/service/storage.go`)에 JSON 필드 추가:
    - `ProjectPath string    "projectPath"`
    - `ProjectDisplayName string "projectDisplayName"`
    - `Title string            "title"`
    - `HasConversation bool    "hasConversation"`
  - 스토리지 레이어는 인덱스를 직접 알지 않는다. 핸들러 레이어에서 `GetSessionSummaries()` 결과를 순회하며 `idx.Lookup(sessionID)` 로 필드를 채운다.
  - `handler.Handler` 생성자에 `SessionIndex` 주입 파라미터 추가(`handler.New(... , idx service.SessionIndex)`). `cmd/proxy/main.go` 에서 전달.
  - `GET /api/sessions` 핸들러: 요약 로드 → 각 항목에 대해 인덱스 lookup → 성공 시 필드 채움 + `HasConversation=true`; 실패 또는 sessionID 빈 값(Unknown 버킷) 시 빈 값 + `HasConversation=false`.
- **Files:** `proxy/internal/service/storage.go`, `proxy/internal/handler/handlers.go`, `proxy/cmd/proxy/main.go`.
- **Done condition:** 서버 기동 후 `curl -s localhost:3001/api/sessions | jq '.[0]'` 에 새 필드 4개가 포함되어 있고, 실제 `~/.claude/projects` 와 매칭되는 세션에서 `projectDisplayName`/`title` 이 비어있지 않고 `hasConversation=true`. 매칭되지 않는 세션은 네 필드 모두 빈 값 + `hasConversation=false`.
- **Rollback:** 필드 추가/핸들러 수정 revert + 핸들러 생성자 시그니처 복구.
- **Notes:** Unknown 버킷(빈 sessionID)은 lookup 하지 않고 바로 `hasConversation=false` 로 고정. 기존 `DeleteRequestsBySessionID` 흐름은 건드리지 않는다.

### Step 5: Requests 세션 카드에 프로젝트 이름 + 타이틀 표시
- **Goal:** `/requests/:sessionId` 좌측 `SessionPicker` 의 드롭다운 항목과 상단 현재 세션 라벨 영역에 세션ID 아래 두 줄(프로젝트 디렉토리 이름, 세션 title) 을 표시한다. 인덱스 매칭이 없으면 "Project Not Found" 로 표기한다.
- **Preconditions:** Step 4 완료.
- **Changes:**
  - `web/app/routes/api.sessions.tsx`: 백엔드 응답을 그대로 pass-through 하므로 코드 변경은 없고, 타입 선언을 `SessionPicker` 의 타입과 일치시킨다.
  - `web/app/components/SessionPicker.tsx`: `SessionSummary` 타입에 네 필드(`projectPath`, `projectDisplayName`, `title`, `hasConversation`) 추가. 현재 세션 라벨 영역 및 드롭다운 각 항목에 두 줄을 추가 렌더:
    1. `hasConversation && projectDisplayName ? projectDisplayName : "Project Not Found"` (라벨은 작은 글씨, muted).
    2. `title` (존재할 때만; 없으면 해당 줄 생략 — title 누락은 정상 케이스라 Project Not Found 대체문구 불필요).
  - `web/app/routes/requests.tsx` 및 `requests.$sessionId.tsx`: `useRouteLoaderData` 의 타입 업데이트 / prop drilling 유지. 기능 변경 없음.
- **Files:** `web/app/components/SessionPicker.tsx`, `web/app/routes/requests.tsx`, `web/app/routes/requests.$sessionId.tsx`, `web/app/routes/api.sessions.tsx`.
- **Done condition:** `npm --prefix web run typecheck` PASS + 개발 서버 기동 후 `/requests` 에서 매칭된 세션은 두 줄(디렉토리 / 타이틀) 이 보이고, 매칭되지 않는 세션은 "Project Not Found" 표기.
- **Rollback:** 컴포넌트/타입 수정 revert.
- **Notes:** 카드 높이 증가로 인한 스크롤/overflow 회귀에 주의. title 이 매우 길 때는 `truncate` 처리.

### Step 6: Requests → Conversations 바로가기 버튼
- **Goal:** `SessionPicker` 의 현재 세션 라벨 영역에서 휴지통 버튼 옆에 Conversations 바로가기 버튼을 추가. `hasConversation=false` 인 경우 비활성화한다.
- **Preconditions:** Step 5 완료.
- **Changes:**
  - `SessionPicker.tsx` 에 lucide 아이콘 버튼 추가 (예: `MessageSquareText`). 클릭 시 `navigate('/conversations/' + encodeURIComponent(projectPath) + '?sid=' + sessionId)`.
  - `hasConversation=false` 일 때는 `disabled` + `title` 툴팁 "No matching conversation".
  - 드롭다운 각 항목 옆에는 추가하지 않는다(요구사항: "세션 목록의 휴지통 옆에 추가" — 상단 현재 세션 라벨 한 곳으로 해석. 집행 단계에서 요구사항 재확인 후 조정 가능).
- **Files:** `web/app/components/SessionPicker.tsx`.
- **Done condition:** `npm --prefix web run typecheck` PASS. 개발 서버에서 매칭된 세션의 버튼 클릭 → 해당 프로젝트의 Conversations 페이지로 이동 (해당 sessionId 가 선택된 상태). 매칭 없는 세션은 버튼 비활성.
- **Rollback:** 버튼 추가분 revert.
- **Notes:** `conversations.$projectId.tsx` 는 `?sid=` 쿼리를 이미 처리하므로 추가 작업 불필요.

### Step 7: Conversations → Requests 바로가기 버튼
- **Goal:** Conversations 페이지의 **좌측 세션 목록 카드 title 우측**과 **우측 상세 상단 제목 옆** 두 곳에 Requests 바로가기 버튼을 추가한다. Request DB 에 해당 세션이 없으면 비활성화.
- **Preconditions:** Step 4 완료 (`/api/sessions` 가 존재 목록 제공).
- **Changes:**
  - `web/app/routes/conversations.$projectId.tsx` loader 에서 기존 프로젝트 대화 목록 fetch 와 `/api/sessions` fetch 를 `Promise.all` 로 병렬 수행 → `Set<sessionId>` (`existingRequestSessions`) 구성.
  - 좌측 대화 카드 렌더 영역에서 카드 title 우측에 버튼 추가. `existingRequestSessions.has(sessionId)` 일 때만 활성화. 클릭 시 `navigate('/requests/' + encodeURIComponent(sessionId))`. `e.stopPropagation()` 으로 카드 선택과 분리.
  - 우측 상세 상단 제목 옆에도 동일 버튼. 동일 조건으로 disabled 처리.
  - Requests DB fetch 실패 시 `existingRequestSessions = new Set()` 으로 폴백 → 모든 버튼 비활성. 페이지는 정상 렌더.
- **Files:** `web/app/routes/conversations.$projectId.tsx`.
- **Done condition:** `npm --prefix web run typecheck` PASS. 개발 서버에서 Conversations 화면의 두 위치에 버튼이 있고, Request DB 에 있는 세션만 활성화되어 클릭 시 `/requests/:sid` 로 이동.
- **Rollback:** loader / UI 수정 revert.
- **Notes:** `/api/sessions` 응답이 크더라도 필요한 건 sessionId 뿐이므로 Set 로 축약해 직렬화 비용 최소화.

### Step 8: `.refs/project-map.md` 업데이트
- **Goal:** 새 서비스 파일, 의존성, API 응답 필드 확장, UI 변경 사항을 project-map 에 반영.
- **Preconditions:** Step 1–7 완료.
- **Changes:**
  - 파일 트리: `proxy/internal/service/session_index.go` (+ test) 추가.
  - Go 외부 패키지 섹션에 `fsnotify` 추가.
  - Backend API 엔드포인트 섹션의 `/api/sessions` 응답 필드에 `projectPath`, `projectDisplayName`, `title`, `hasConversation` 추가 기술.
  - Remix 섹션: `SessionPicker` 의 디렉토리/타이틀 두 줄 표기 및 Conversations 바로가기, `conversations.$projectId.tsx` 의 Requests 바로가기 및 existingRequestSessions loader 변경 서술.
  - "수정 금지 / 주의 영역": SessionIndex 초기 Rebuild 가 HTTP listen 이전에 블로킹으로 수행된다는 점과 fsnotify watcher 가 서브디렉토리마다 Add 된다는 점 추가.
  - 상단 메타 라인(생성일자 / 커밋 해시) 갱신.
- **Files:** `.refs/project-map.md`.
- **Done condition:** `git diff .refs/project-map.md` 에서 위 다섯 항목이 한 번에 반영되어 있고 markdown 렌더가 깨지지 않음(`mdl` 등을 쓰지 않는다면 수동 확인).
- **Rollback:** 파일 revert.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-22)
- `extractSessionTitle` skips non-title lines with a lightweight `type`-only unmarshal before the full `extractTitleFromLine` call, for performance. This is additive and does not change observable behaviour.
- The `fmt` import was not needed in `conversation_test.go`; only `os` and `path/filepath` were added alongside `testing`. IDE warnings about duplicate string literals and cognitive complexity in the test function are linter style warnings only — they do not affect compilation or correctness and were left as-is per the minimal-change principle.

### Step 2 (2026-04-22)
- `NewSessionIndex` accepts a `*log.Logger` parameter (nullable — falls back to a stdout logger) rather than creating one internally, so the server's own logger can be passed in for consistent output formatting.
- `sessionIdx` is stored in a local variable in `main.go` ready for injection into the handler in Step 4; the handler constructor signature is NOT changed in this step (change deferred to Step 4 per plan).
- The `path/filepath` import was added to `main.go` alongside the `os.UserHomeDir()` + `filepath.Join` call; both are used together so no unused-import issue results.

### Step 3 (2026-04-22)
- `Watch(ctx context.Context) error` added to the `SessionIndex` interface and implemented in `sessionIndexImpl`. Primary path uses `fsnotify.NewWatcher`; if creation or rootDir `Add` fails it falls back to polling at `pollInterval` (default 10 s).
- `newSessionIndexWithPollInterval` package-private constructor added so tests can force the polling fallback with a 50 ms tick, keeping tests fast without depending on fsnotify CI behavior.
- In practice on macOS, fsnotify is available so the watch tests ran via the fsnotify path; the polling path is covered by the fallback constructor but exercised through the same test functions.
- `main.go` launches `go idx.Watch(watchCtx)` immediately after the HTTP server goroutine starts. A dedicated `watchCtx`/`watchCancel` pair is used; `watchCancel()` is called before the `srv.Shutdown` grace-period begins.
- `go.mod`/`go.sum` gained `github.com/fsnotify/fsnotify v1.9.0` and its transitive dep `golang.org/x/sys v0.13.0`.

### Step 4 (2026-04-22)
- `SessionSummary` in `storage.go` gained four new fields (`ProjectPath`, `ProjectDisplayName`, `Title`, `HasConversation`). The storage layer itself does not populate them — population is handled in the handler layer as planned.
- `handler.New()` signature extended with a `sessionIndex service.SessionIndex` parameter (last positional arg). `main.go` updated to pass `sessionIdx`.
- `GetSessions` enriches each `sessionResponse` by calling `h.sessionIndex.Lookup(sessionID)`. Unknown bucket (empty `sessionID`) is skipped immediately. A `nil` guard on `h.sessionIndex` ensures zero-value safety if called in a test context without an index.
- No storage-layer or test changes were required beyond the `storage.go` type extension.

### Step 5 (2026-04-22)
- `SessionSummary` interface in `SessionPicker.tsx` extended with four optional fields (`projectPath?`, `projectDisplayName?`, `title?`, `hasConversation?`) — all optional so existing call sites with partial data remain type-safe without changes.
- Current session label area (active session button) renders project name in blue when `hasConversation && projectDisplayName`, otherwise "Project Not Found" in muted italic. Title shown on a separate line if non-empty.
- Dropdown items each gain the same two-line addition: project display name (or "Project Not Found"), then title if present.
- `requests.tsx` and `requests.$sessionId.tsx` required no code changes — they import `SessionSummary` from `SessionPicker.tsx` so the type extension propagated automatically.
- `api.sessions.tsx` required no changes (pass-through proxy).
- Pre-existing typecheck error in `MessageContent.tsx` (unrelated to this step) remains; no new errors introduced.

### Step 6 (2026-04-22)
- `MessageSquareText` icon from lucide-react added to the import alongside `ChevronDown` and `Trash2`.
- Button inserted immediately before the existing delete button (trash). On click it navigates to `/conversations/{encodeURIComponent(projectPath)}?sid={encodeURIComponent(sessionId)}`. When `hasConversation` is falsy the button is `disabled` with `title="No matching conversation"`.
- The pre-existing cognitive-complexity lint warning (S3776, threshold 15) on the `SessionPicker` component function increased by 1 but was already present before this step; it is a style warning only and does not affect compilation or behaviour.

### Step 7 (2026-04-22)
- `loader` refactored to use two IIFEs resolved with `Promise.all`: one for project conversations, one for `/api/sessions`. The sessions fetch extracts only `sessionId` strings (non-empty ones) into `existingRequestSessionIds: string[]`, which is added to `LoaderData`. On fetch failure each branch falls back to an empty array — page renders normally with all buttons disabled.
- In the component, `existingRequestSessionIds` is converted to `Set<string>` (`existingRequestSessions`) once at render time for O(1) lookups.
- Left list: each conversation card's headline row is wrapped in a flex container with the title div and a `SquareTerminal` (lucide-react) icon button on the right. `e.preventDefault()` + `e.stopPropagation()` ensures the button click does not trigger the parent `<Link>`'s `handleSelect`. Disabled + tooltip when no matching request.
- Right detail header: `SquareTerminal` button added to the right side of the header bar, before the session ID span. Same disabled/tooltip logic. Both navigate to `/requests/{encodeURIComponent(sessionId)}`.
- `useNavigate` and `SquareTerminal` added to imports; `MessageCircle` (already present) retained for the empty-state icon.
- Pre-existing typecheck error in `MessageContent.tsx` (unrelated) remains; no new errors introduced — `npm --prefix web run typecheck` exits 2 only due to that pre-existing error.

### Step 8 (2026-04-22)
- Meta header updated to include `갱신: 2026-04-22 | 대상 커밋: c8a7389`.
- File-tree section: added `session_index.go`, `session_index_test.go`, `conversation_test.go`; extended descriptions for `conversation.go`, `storage.go`, `handlers.go`, `cmd/proxy/main.go`, `SessionPicker.tsx`, `requests.$sessionId.tsx`, `conversations.$projectId.tsx`.
- Dependency graph updated to include `service.SessionIndex` and `fsnotify`.
- Backend API `/api/sessions` entry extended with the four new response fields.
- External packages: `github.com/fsnotify/fsnotify v1.9.0` added.
- Claude Code 대화 파일 section: `extractSessionTitle` function documented.
- 수정 금지 / 주의 영역: two new rows added for `SessionIndex` initial `Rebuild` ordering and fsnotify subdirectory `watcher.Add` requirement.
