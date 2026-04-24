# Project Map
_생성: 2026-04-19 | 갱신: 2026-04-25 | 대상 커밋: 0edf7c8 + api_cost feature_

## 개요
Claude Code 용 LLM 프록시 + 모니터링 대시보드.
- Go 백엔드 (proxy) + Remix 프론트엔드 (web) 2-서비스 구조
- Anthropic `/v1/messages` 호출을 가로채 저장/변환/라우팅
- 모델 prefix 기반 provider 라우팅 (anthropic / openai)
- Subagent 기능: Claude Code 의 커스텀 agent system prompt 해시 매칭으로 다른 모델/프로바이더로 라우팅

---

## 파일 트리

```
claude-code-proxy/
  Dockerfile                  — 3-stage build: go-builder + node-builder + runtime
  docker-entrypoint.sh        — 컨테이너 내부에서 proxy + remix-serve 병행 기동
  run.sh                      — 로컬 dev: proxy 빌드 후 바이너리 실행 + web npm run dev
  Makefile                    — install/build/dev/clean/db-reset 타겟
  config.yaml                 — 주 설정 파일 (server/providers/storage/subagents)
  config.yaml.example         — 설정 템플릿
  .env / .env.example         — 환경변수 오버라이드 (godotenv 로드)
  requests.db                 — SQLite 런타임 DB (프록시가 생성)
  bin/proxy                   — 빌드된 Go 바이너리 산출물
  README.md / LICENSE / demo.gif

  proxy/                      — Go 백엔드 (module: github.com/seifghazi/claude-code-monitor)
    go.mod                    — Go 1.20, deps: gorilla/mux,handlers, joho/godotenv, mattn/go-sqlite3, yaml.v3
    go.sum
    proxy                     — Go 빌드 바이너리 (커밋됨 — 빌드 산출물)
    cmd/proxy/main.go         — 엔트리포인트, 라우터 구성, 서버 lifecycle. HTTP listen 이전에 `SessionIndex.Rebuild()` 블로킹 호출; HTTP 서버 goroutine 기동 직후 `go idx.Watch(watchCtx)` 시작; shutdown 시 `watchCancel()` → `srv.Shutdown()` 순서
    internal/
      config/config.go        — YAML+ENV 설정 로더, Config 구조체, 기본값
      handler/
        handlers.go           — HTTP 핸들러: Messages, Models, Health, UI, GetRequests, Conversations, GetSessions(SessionIndex 조회로 projectPath/projectDisplayName/title/hasConversation 필드 채움). `handler.New(... , sessionIndex service.SessionIndex)` — 마지막 인자로 SessionIndex 주입
        utils.go              — SanitizeHeaders (민감 헤더 SHA256), ConversationDiffAnalyzer
      middleware/logging.go   — 요청 로깅 + 요청 바디를 context.BodyBytesKey 에 저장
      model/models.go         — 모든 DTO (RequestLog, ResponseLog, AnthropicRequest/Response, Tool, StreamingEvent, ContextKey)
      provider/
        provider.go           — Provider 인터페이스 (Name, ForwardRequest)
        anthropic.go          — Anthropic 직접 포워딩 + gzip 해제
        openai.go             — Anthropic→OpenAI 요청 변환, OpenAI→Anthropic 응답/스트림 변환
      service/
        anthropic.go          — (레거시) AnthropicService, 직접 /v1/messages 포워딩
        conversation.go       — ~/.claude/projects/*.jsonl 파싱 (Claude Code 대화 기록) + `GetProjects()` 프로젝트 요약 (mtime DESC). `decodeProjectPath` 가 encoded CWD(`-Users-...-claude-code-proxy`) 를 파일 시스템 stat 으로 점층 복원 → `projectDisplayName` 이 실제 폴더 이름(`claude-code-proxy`) 또는 미확인 remainder 반환. `extractSessionTitle(filePath)` — title 전용 경량 스캐너 (ai-title/custom-title 라인만 읽어 마지막 값 반환, messages 전체 파싱 불필요)
        conversation_test.go  — `extractSessionTitle` + `projectDisplayName` 단위 테스트
        model_router.go       — 모델 prefix 매칭 + subagent 해시 매칭 라우팅 결정
        model_router_test.go  — 라우터 edge case 테스트
        pricing.go            — USD/Million 가격표 + `CalculateCostUSD(modelID, *AnthropicUsage) (float64, bool)` 순수 함수. 지원 모델: claude-opus-4-7, claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5 (정확 일치 매칭, prefix 금지). cache_creation 객체가 있으면 ephemeral_5m / ephemeral_1h 각각 단가 적용; 없고 `CacheCreationInputTokens>0` 이면 전량 1h 단가. 미매칭/누락 → `ok=false`
        pricing_test.go       — 4개 모델 × usage 변형 + 미지원 모델/nil/tier 무시 + `sumSessionCosts` 폴드 테스트
        session_index.go      — `SessionIndex` 인터페이스 (`Lookup`, `Rebuild`, `Watch`) + `sessionIndexImpl` 구현체. `NewSessionIndex(rootDir, logger)` 생성자. Rebuild: rootDir 하위 jsonl 전체 스캔 → `map[sessionID]SessionIndexEntry` 원자 교체. Watch: fsnotify 1차 시도 + 실패 시 10s 폴링 폴백. 서브디렉토리마다 watcher.Add 호출(fsnotify 재귀 미지원). `newSessionIndexWithPollInterval` 은 테스트용 패키지-프라이빗 생성자
        session_index_test.go — `TestSessionIndex*` + `TestSessionIndexWatch*` 단위/동시성/감시 테스트
        storage.go            — StorageService 인터페이스 정의 (`GetRequestsBySessionID`, `GetSessionSummaries`, `DeleteRequestsBySessionID` 포함), SessionSummary 타입 (`projectPath`, `projectDisplayName`, `title`, `hasConversation`, `TotalCost *float64` 필드 포함 — 스토리지 레이어는 SessionIndex 외 필드를 채우지 않고 핸들러가 SessionIndex 로 채움; `TotalCost` 는 `GetSessionSummaries` 가 `pricing.CalculateCostUSD` 로 계산해 채움)
        storage_sqlite.go     — SQLite 구현체, requests 테이블 스키마 정의 (`session_id` 컬럼 + `idx_session_id` 포함). `GetSessionSummaries` 는 기본 GROUP BY 쿼리 + `response IS NOT NULL` 인 행을 2차 스캔해 `costFromResponseBytes` → `sumSessionCosts` 폴드로 세션별 비용 계산 후 병합. 유효 비용 0건 세션은 `TotalCost=nil`

  web/                        — Remix 프론트엔드 (Node >= 20, Vite 6)
    package.json              — scripts: build/dev/lint/start/typecheck
    vite.config.ts            — Remix v3 future flags 활성, /api → localhost:3001 프록시
    tailwind.config.ts / postcss.config.js / tsconfig.json / .eslintrc.cjs
    public/                   — favicon, 로고
    app/
      root.tsx                — HTML shell, Inter 폰트, Tailwind
      entry.client.tsx / entry.server.tsx — Remix SSR entry
      tailwind.css
      routes/
        _index.tsx                     — `/` → `/requests` redirect only
        requests.tsx                   — `/requests` parent layout: TopNav + 전체 폭(`<Outlet/>`) 본문. 사이드바 컬럼 없음. loader 가 `/api/sessions` 조회 후 pathname === "/requests" 이면 최근 세션으로 redirect. `SessionSummary` 타입은 `SessionPicker` 에서 re-export
        requests.$sessionId.tsx        — `/requests/:sessionId` 좌측 목록 + 우측 상세의 2컬럼 화면 (HorizontalSplit 기반). 좌측 패널 상단에 SessionPicker(세션 전환 + 삭제 + Conversations 바로가기) + 모델 필터 토글. `sessionId === "unknown"` → Unknown 버킷. 선택된 요청은 `?rid=`, 모델 필터는 `?model=` 쿼리. parent sessions 는 `useRouteLoaderData("routes/requests")` 로 접근
        conversations.tsx              — `/conversations` parent layout: TopNav + 전체 폭(`<Outlet/>`) 본문. 사이드바 컬럼 없음. loader 가 `/api/projects` 조회 후 pathname === "/conversations" 이면 최근 프로젝트로 redirect. `ProjectSummary` 타입은 `ProjectPicker` 에서 re-export
        conversations.$projectId.tsx   — `/conversations/:projectId` 좌측 목록 + 우측 상세의 2컬럼 화면 (HorizontalSplit 기반). 좌측 패널 상단에 ProjectPicker(프로젝트 전환, 삭제 없음). 선택된 대화는 `?sid=` 쿼리. 프로젝트 전환 시 `?sid=` 제거. parent projects 는 `useRouteLoaderData("routes/conversations")` 로 접근. loader 가 `/api/conversations/project` + `/api/sessions` 를 `Promise.all` 로 병렬 조회해 `existingRequestSessionIds: string[]` 를 LoaderData 에 포함. 좌측 대화 카드 title 우측 + 우측 상세 헤더에 `SquareTerminal` 아이콘 버튼 (Requests 바로가기). `existingRequestSessions Set<string>` 으로 O(1) 조회 — 미존재 세션은 disabled
        api.requests.tsx               — /api/requests GET/DELETE — backend 3001 프록시 (신규 UI 는 loader 에서 직접 백엔드 호출, 이 프록시는 현재 미사용)
        api.conversations.tsx          — /api/conversations GET — backend 3001 프록시 (신규 UI 는 loader 에서 직접 백엔드 호출)
        api.sessions.tsx               — /api/sessions GET — 세션 요약 프록시
        api.sessions.$sessionId.tsx    — /api/sessions/:id DELETE — 세션 단위 삭제 프록시
        api.projects.tsx               — /api/projects GET — 프로젝트 요약 프록시
        api.grade-prompt.tsx           — /api/grade-prompt POST — backend 3001 프록시 (현재 backend 엔드포인트 없음)
      components/
        TopNav.tsx               — 상단 Requests / Conversations NavLink
        SessionPicker.tsx        — `/requests/:sid` 좌측 패널 상단에 탑재되는 현재 세션 라벨 + 드롭다운 전환 + Conversations 바로가기(`MessageSquareText`) + 휴지통(fetcher DELETE → `/api/sessions/:id`). 삭제 성공 시 `/requests` 로 navigate. `SessionSummary` 타입 export (옵션 필드: `projectPath?`, `projectDisplayName?`, `title?`, `hasConversation?`). 현재 세션 라벨과 드롭다운 각 항목에 프로젝트 이름 + 타이틀 두 줄 표시; `hasConversation=false` 이면 "Project Not Found" 로 표기. Conversations 바로가기 버튼은 `hasConversation=false` 시 disabled + tooltip
        ProjectPicker.tsx        — `/conversations/:pid` 좌측 패널 상단에 탑재되는 현재 프로젝트 라벨 + 드롭다운 전환(삭제 없음 — jsonl 보호). 전환 시 `?sid=` 쿼리 제거. `ProjectSummary` 타입 export
        HorizontalSplit.tsx      — 좌/우 드래그 splitter 2단 레이아웃. 좌측 폭 `defaultLeftWidth`(기본 420px, min 240, max 800) 내부 state, 영속화 없음 — 매 마운트 디폴트로 리셋. mousemove/mouseup 리스너는 mouseup 에서 제거 + unmount cleanup 으로 body `userSelect/cursor` 복원
        RequestDetailContent.tsx — 요청/응답 상세 뷰 컨테이너
        ConversationThread.tsx   — 대화 스레드 표시
        MessageContent.tsx       — 메시지 본문 렌더링
        MessageFlow.tsx          — 대화 흐름 시각화
        CodeViewer.tsx / CodeDiff.tsx — 코드 블록 뷰어
        ToolUse.tsx / ToolResult.tsx  — tool_use/tool_result 블록
        TodoList.tsx             — TodoWrite 도구 결과 렌더링
        ImageContent.tsx         — 이미지 블록
      utils/
        formatters.ts         — 포맷 헬퍼
        models.ts             — isOpenAIModel, getProviderName, getChatCompletionsEndpoint
        pricing.ts            — `calculateCostUSD(model, usage)` + `formatCostUSD(cost)` 포맷터. 가격표는 `proxy/internal/service/pricing.go` 와 동기 유지 필수(정확 일치 매칭). 포맷은 locale 독립 — `toFixed(2)` + 정규식 천단위 콤마 (Number.prototype.toLocaleString 사용 금지)
        pricing.test.ts       — 계산/포맷 vitest 케이스 (미지원 모델, nil, 음수, NaN/Infinity, 천단위 콤마, 반올림)
```

---

## 모듈 의존관계 / 호출 흐름

### 요청 처리 (핵심 경로)
```
Claude Code client
  → POST /v1/messages
  → middleware.Logging (바디 읽어 context 저장)
  → handler.Messages
      → modelRouter.DetermineRoute(req)       // subagent 해시 or prefix → Provider
      → storageService.SaveRequest(log)       // SQLite INSERT
      → (model 재작성 시) req.Model = target, body re-marshal
      → decision.Provider.ForwardRequest(ctx, r)
          ├── AnthropicProvider: URL 재작성 → api.anthropic.com → gzip 해제
          └── OpenAIProvider: convertAnthropicToOpenAI → /v1/chat/completions
                              → transformOpenAIResponseToAnthropic / Stream 변환
      → handleStreamingResponse or handleNonStreamingResponse
          → 스트림 파싱 (message_start/delta/stop, content_block_*)
          → storageService.UpdateRequestWithResponse
```

### 웹 UI 경로
```
브라우저 → Remix (:5173)
  → routes/_index.tsx
  → /api/requests, /api/conversations (Remix loader)
  → fetch http://localhost:3001/api/... (Go 백엔드)
  → handler.GetRequests / GetConversations
  → storageService.GetAllRequests (SQLite)
  또는 conversationService.GetConversations (~/.claude/projects/*.jsonl 파싱)
```

### 의존 그래프
```
main.go → config, provider, service (ModelRouter, AnthropicService, SQLiteStorage, SessionIndex), handler, middleware
handler → service, model
service.ModelRouter → config, model, provider
provider.OpenAIProvider → model (AnthropicRequest 파싱)
service.SQLiteStorage → model, config
service.SessionIndex → service.conversation (extractSessionTitle, projectDisplayName), fsnotify
```

### 서비스 포트
- `:3001` — Go proxy (API + 저장 + 기본 UI)
- `:5173` — Remix dev server (프로덕션: remix-serve)
- Vite dev proxy: `/api/*` → `http://localhost:3001`

---

## 핵심 데이터 구조

### SQLite: `requests` 테이블 (storage_sqlite.go)
```sql
CREATE TABLE requests (
  id TEXT PRIMARY KEY,              -- 16-hex request ID
  timestamp DATETIME,               -- RFC3339
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,           -- /v1/messages 등
  headers TEXT NOT NULL,            -- JSON, 민감 헤더는 sha256:<hex>
  body_raw TEXT NOT NULL,           -- 원본 요청 바디 문자열 (단일 저장. 읽기 시 Unmarshal → RequestLog.Body 채움)
  user_agent TEXT,
  content_type TEXT,
  prompt_grade TEXT,                -- PromptGrade JSON (nullable)
  response TEXT,                    -- ResponseLog JSON (nullable)
  model TEXT,                       -- 최종 라우팅된 모델
  original_model TEXT,              -- 클라이언트가 보낸 모델
  routed_model TEXT,                -- 라우터가 선택한 타겟 모델
  session_id TEXT,                  -- X-Claude-Code-Session-Id (빈 값 = Unknown)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- indexes: timestamp DESC, endpoint, model, session_id
```

### Backend API 엔드포인트 (cmd/proxy/main.go)
- `POST /v1/messages` — Claude Code 프록시 본체
- `GET /api/requests` — 요청 목록 (쿼리: `model`, `sessionId`, `page`, `limit`). `sessionId=unknown` → Unknown 버킷
- `GET /api/sessions` — 세션 요약 `[{sessionId, firstTimestamp, lastTimestamp, requestCount, projectPath, projectDisplayName, title, hasConversation, totalCost}]` (lastTimestamp DESC). 핸들러가 `SessionIndex.Lookup` 으로 프로젝트 정보를 채움; 매칭 없으면 빈 값 + `hasConversation=false`. Unknown 버킷(빈 sessionId)은 항상 `hasConversation=false`. `totalCost` 는 `number | null` — 스토리지 레이어가 매 응답의 `body.usage`+`body.model`(없으면 row.model) 기반으로 `CalculateCostUSD` 호출·세션별 누적. 유효 비용 0건이면 `null`. DB 에 저장하지 않고 요청 시 재계산
- `DELETE /api/sessions/{id}` — 세션 단위 삭제. `id=unknown` 이면 Unknown 버킷 삭제
- `GET /api/projects` — Claude Code 프로젝트 요약 `[{projectPath, displayName, lastMTime, conversationCount}]` (lastMTime DESC)
- `GET /api/conversations/project?project=<path>` — 특정 프로젝트의 대화 목록 (mux 등록 순서 중요: `/project` 를 `{id}` 보다 먼저)
- `GET /api/conversations/{id}` — 특정 세션의 대화

### Go 주요 타입 (model/models.go)
- `RequestLog` — 요청 저장 단위 (위 컬럼과 매핑). `BodyRaw string` 필드 = DB 에 저장되는 원본 요청 바이트. `Body interface{}` 필드는 쓰기 시 무시되고, 읽기 시 스토리지가 body_raw 를 Unmarshal 해 채움(API 응답 전용)
- `ResponseLog { StatusCode, Headers, Body(json.RawMessage), BodyText, StreamingChunks[], IsStreaming, ResponseTime, CompletedAt }`
- `AnthropicRequest { Model, Messages, MaxTokens, Temperature*, System[], Stream, Tools[], ToolChoice }`
- `AnthropicMessage { Role, Content interface{} }` — Content 는 string / []block 둘다 수용, `GetContentBlocks()` 헬퍼
- `AnthropicSystemMessage { Text, Type, CacheControl* }`
- `AnthropicUsage { InputTokens, OutputTokens, CacheCreationInputTokens, CacheReadInputTokens, ServiceTier }`
- `StreamingEvent { Type, Index*, Delta*, ContentBlock* }`, `Delta { Type, Text, Name, Input(json.RawMessage) }`
- `ContextKey` + `const BodyBytesKey ContextKey = "bodyBytes"` — middleware ↔ handler 바디 전달
- `PromptGrade { Score, MaxScore, Feedback, ImprovedPrompt, Criteria map, GradingTimestamp, IsProcessing }`

### Claude Code 대화 파일 (conversation.go)
- 경로: `~/.claude/projects/<encoded-cwd>/<sessionID>.jsonl`
- 각 라인: `ConversationMessage { parentUuid, isSidechain, userType, cwd, sessionId, version, type, message(raw), uuid, timestamp }`
- 버퍼 크기: 10MB per line
- `type == "ai-title" | "custom-title"` 라인은 세션 타이틀 이벤트 — `parseConversationFile` 가 `extractTitleFromLine` 으로 추출해 `Conversation.Title` 에 마지막 등장값을 저장(파일 라인 순서 기준)하고 `messages` 에서 제외. 필드 우선순위: `customTitle` → `aiTitle`. UI(`conversations.$projectId.tsx`)는 `title` 우선, 없으면 `firstUserText` 폴백
- `extractSessionTitle(filePath string) (string, error)` — title 전용 경량 스캐너. 파일 전체를 순회하되 `type` 필드가 `ai-title` / `custom-title` 인 라인에서만 `extractTitleFromLine` 호출 → 마지막 등장값 반환. `SessionIndex.Rebuild` / 파일 upsert 시 사용

### Subagent 라우팅 구조 (model_router.go)
- `SubagentDefinition { Name, TargetModel, TargetProvider, FullPrompt }`
- 로드: `.claude/agents/<name>.md` 프로젝트 먼저, 없으면 `$HOME/.claude/agents/<name>.md`
- 파싱: `<metadata>\n---\n<system prompt>` 구조 → 프롬프트에서 `Notes:` 이전 "static prompt" 추출 → SHA256 16-hex
- 매칭 조건: 요청의 `system` 배열이 정확히 2개, `system[0].Text`에 "You are Claude Code" 포함, `system[1]`의 static prompt 해시가 로드된 subagent와 일치

---

## 환경변수 및 설정 파일

### 설정 로드 순서 (config.go)
1. 기본값 설정 (Server:3001, Anthropic:api.anthropic.com, Storage:requests.db)
2. `config.yaml` 로드 (실행 바이너리 인근 → `../config.yaml` → `../../config.yaml` 순)
3. ENV 변수로 오버라이드
4. `server.timeouts.*` YAML 값이 있으면 기존 duration 덮어씀
5. 레거시 `cfg.Anthropic` 을 `cfg.Providers.Anthropic` 로부터 동기화

### 환경변수 (.env 자동 로드: `../.env` 우선, 없으면 `.env`)
| 변수 | 용도 | 기본값 |
|---|---|---|
| `PORT` | 프록시 포트 | 3001 |
| `READ_TIMEOUT` / `WRITE_TIMEOUT` / `IDLE_TIMEOUT` | Go duration 문자열 | 600s |
| `ANTHROPIC_FORWARD_URL` | 업스트림 Anthropic URL | https://api.anthropic.com |
| `ANTHROPIC_VERSION` | `anthropic-version` 헤더 | 2023-06-01 |
| `ANTHROPIC_MAX_RETRIES` | 최대 재시도 | 3 |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` | OpenAI 라우팅 시 | "" |
| `DB_PATH` | SQLite 경로 | requests.db |
| `WEB_PORT` | Docker 에서 remix-serve 포트 | 5173 |

### config.yaml 섹션
- `server.port`, `server.timeouts.{read,write,idle}`
- `providers.anthropic.{base_url, version, max_retries}`
- `providers.openai.{base_url, api_key}`
- `storage.{db_path, requests_dir}`
- `subagents.enable` (bool), `subagents.mappings` (map[agentName]targetModel)
- `security.sanitize_headers` (bool, default true) — false 면 `SanitizeHeaders` 가 원본 값 그대로 복사 (API 키 평문 저장됨, 로컬 디버깅 전용). `cfg.ShouldSanitizeHeaders()` 로 조회, `handler.New(... , sanitizeHeaders bool)` 로 주입

---

## 외부 패키지

### Go (proxy/go.mod, Go 1.20)
- `github.com/gorilla/mux ^1.8` — HTTP 라우터
- `github.com/gorilla/handlers ^1.5` — CORS 미들웨어
- `github.com/joho/godotenv ^1.5` — .env 로더
- `github.com/mattn/go-sqlite3 ^1.14` — SQLite 드라이버 (CGO 필요)
- `gopkg.in/yaml.v3 ^3.0` — config.yaml 파싱
- `github.com/fsnotify/fsnotify v1.9.0` — OS 파일시스템 이벤트 감시 (`SessionIndex.Watch`). fsnotify 는 재귀 감시 미지원으로 프로젝트 서브디렉토리마다 `watcher.Add` 필요
- `github.com/felixge/httpsnoop ^1.0.3` (indirect)

### Node (web/package.json, Node >= 20)
- `@remix-run/{node,react,serve,dev} ^2.16` — Remix v2
- `react / react-dom ^18.2`
- `lucide-react ^0.522` — 아이콘
- `isbot ^4.1` — SSR 봇 감지
- `vite ^6`, `vite-tsconfig-paths`, `tailwindcss ^3.4`, `typescript ^5.1`
- ESLint 툴체인 (eslint, @typescript-eslint/*, eslint-plugin-{import,react,react-hooks,jsx-a11y})

---

## 코딩 컨벤션 / 반복 패턴

### Go
- 패키지 경로 prefix: `github.com/seifghazi/claude-code-monitor/internal/<pkg>`
- 로깅: `logger := log.New(os.Stdout, "proxy: ", log.LstdFlags|log.Lshortfile)` + 이모지 prefix (🚀 ✅ ❌ 🗿 📡 🎨 🤖)
- 에러 처리: `fmt.Errorf("...: %w", err)` wrap, 상위에서 `log.Printf("❌ ...")` + `writeErrorResponse`
- 민감 헤더: `handler.SanitizeHeaders(headers, sanitize bool)` 로 저장/로깅 전 SHA256 해시 (`x-api-key`, `authorization`, `anthropic-api-key`, `openai-api-key`, `bearer`, `api-key` 부분일치). `sanitize=false` 이면 원본 복사. `Handler.sanitizeHeaders` 에 설정값 주입됨 (`config.security.sanitize_headers`, 기본 true)
- HTTP 바디: `middleware.Logging` 이 `context.BodyBytesKey` 에 저장 → `handler.getBodyBytes(r)` 로 읽음 (이중 읽기 방지)
- Provider 인터페이스 구현으로 프로바이더 추가 (`provider.Provider`)
- 모델 라우팅: `providerPatterns` 순서 중요 (`gpt-`, `o1`, `o3` → openai, `claude-` → anthropic, 기본 anthropic)
- 스트리밍: SSE `data: ` prefix 파싱 → Anthropic 표준 이벤트(`message_start`, `content_block_delta`, `message_delta`, `message_stop`)로 변환
- 타임아웃: provider HTTP client 300s, 서버 default 600s

### Remix/React
- 라우트 규칙: `_index.tsx` = `/`, `api.<name>.tsx` = `/api/<name>`
- Remix v3 future flags 전부 켜짐 (`v3_fetcherPersist`, `v3_singleFetch`, `v3_lazyRouteDiscovery` 등)
- API 라우트는 Go 백엔드 프록시 전용 — 직접 로직 넣지 않음
- Tailwind + Inter 폰트, 컴포넌트별 파일 분리, Lucide 아이콘 사용
- 모델 판별은 반드시 `utils/models.ts` 헬퍼 경유 (`isOpenAIModel`, `getProviderName`)

### 공통
- 설정 로더는 기본값 → YAML → ENV 순 (ENV 승)
- 빌드 산출물 체크인됨 (`bin/proxy`, `proxy/proxy`) — 수정 금지

---

## 수정 금지 / 주의 영역

| 대상 | 이유 |
|---|---|
| `model.ContextKey` / `BodyBytesKey` | middleware → handler 바디 전달 약속, 타입 바꾸면 런타임 패닉 |
| `providerPatterns` 배열 순서 (model_router.go) | 첫 매치 우선 — `o1` 이 `claude-` 앞에 있어야 함. 변경 시 라우팅 깨짐 |
| `extractStaticPrompt` (model_router.go) | Claude Code subagent prompt 의 `Notes:` 분리 로직, 해시 매칭 근간 |
| `SanitizeHeaders` 민감 헤더 리스트 | API 키 평문 저장 방지 — 필드 추가/제거 주의 |
| SQLite 스키마 `createTables` | `IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` idempotent (duplicate column name 에러 무시). 신규 컬럼 추가 시 같은 패턴 유지 |
| `OpenAIProvider.ForwardRequest` — 요청 바디 재마샬 경로 | Anthropic↔OpenAI 필드 매핑 (max_tokens→max_completion_tokens, o-series 는 temperature 제거, tool_choice 변환) 제거하면 OpenAI 응답 파싱 깨짐 |
| `transformOpenAIStreamToAnthropic` | 빈 `choices` + `usage` 케이스 먼저 처리. 순서 바꾸면 usage 토큰 누락 |
| `handler.handleStreamingResponse` — `message_delta.usage` 파싱 | 스트리밍 토큰 집계 핵심. 변경 시 UI 사용량 표시 깨짐 |
| `run.sh` 의 포트 2개 + cleanup trap | 로컬 dev 프로세스 관리. `kill $PROXY_PID $WEB_PID` trap 없으면 좀비 프로세스 |
| Dockerfile CGO_ENABLED=1 | go-sqlite3 는 CGO 필수. 0 으로 바꾸면 빌드 실패 |
| `api.grade-prompt.tsx` | Remix 쪽은 존재하나 Go 백엔드에 `/api/grade-prompt` 라우트 미등록 (main.go). 사용 시 404 — 백엔드 추가 필요 |
| `~/.claude/projects/*.jsonl` 파싱 위치 | `NewConversationService()` 가 `os.UserHomeDir()` 사용 — Docker 내부에서는 경로 다름, 컨테이너에서는 conversation 기능 무효 |
| `SessionIndex` 초기 `Rebuild` 순서 | `main.go` 에서 `idx.Rebuild()` 를 HTTP `ListenAndServe` 이전에 블로킹으로 호출 — 재배치 시 인덱스 없이 요청이 들어와 `hasConversation` 이 항상 false 가 됨 |
| `SessionIndex.Watch` 서브디렉토리 watcher.Add | fsnotify 는 재귀 감시 미지원. `Rebuild` 후 각 프로젝트 서브디렉토리를 `watcher.Add` 해야 jsonl 변경 이벤트 수신 가능. 신규 프로젝트 디렉토리는 `Create` 이벤트에서 `watcher.Add` 로 동적 추가 |
| `decodeProjectPath` / `projectDisplayName` (conversation.go) | encoded CWD 를 파일 시스템 stat 으로 복원 — 세그먼트 단위 lookahead 로 하이픈 포함 폴더명(`claude-code-proxy`) 을 정확히 복원. 디스크에 프로젝트가 없으면 remainder 그대로 반환. `GetProjects` 호출마다 stat 발생(캐시 없음), stub `existsFn` 주입 가능(`projectDisplayNameWith`) |
| `HorizontalSplit.tsx` mousemove/mouseup 리스너 정리 | `onMouseDown` 이 `window` 레벨 리스너 등록 → `onUp` 에서 반드시 제거 + 언마운트 cleanup 으로 body `userSelect/cursor` 복원. 누락 시 드래그 종료 후에도 커서가 `col-resize` 에 고정 / 메모리 누수 |
| Split 상태 영속화 금지 | 요구사항상 localStorage/쿠키/서버 저장 없이 매 세션 디폴트로 복귀. `HorizontalSplit` 는 `defaultLeftWidth=420` 로 마운트 시 리셋 — 변경 시 UX 회귀 주의 |
| 가격표 동기화 (`pricing.go` ↔ `pricing.ts`) | USD/Million 단가 테이블은 Go 백엔드(`proxy/internal/service/pricing.go`)와 TS 프론트(`web/app/utils/pricing.ts`) 두 곳에 중복 선언됨 — 한쪽만 갱신하면 `/api/sessions.totalCost` 와 Request 카드 개별 비용이 서로 다른 값을 표시. 모델 매칭은 **정확 일치**만 허용(prefix 금지), 가격 추가/수정 시 양쪽 동시 수정 + 양쪽 단위 테스트 갱신 |
