# Code Review Plan

- Created: 2026-04-23
- Project root: /Users/syoh/Development/thatseeup/claude-code-proxy
- Total files (git-tracked, excl. lockfiles): 94
- Total source LOC (리뷰 대상): ~12,262

## 기술 스택

- 언어: Go 1.20, TypeScript 5.1, CSS
- 프레임워크: Go net/http + gorilla/mux (백엔드), Remix v2 + React 18 (프론트엔드)
- 주요 라이브러리:
  - Go: gorilla/mux, gorilla/handlers, joho/godotenv, mattn/go-sqlite3, yaml.v3, fsnotify
  - Node: @remix-run/{node,react,serve,dev}, react, react-dom, lucide-react, isbot
- 패키지 매니저: Go modules, npm
- 빌드/배포: Dockerfile (3-stage: go-builder + node-builder + runtime), docker-entrypoint.sh, Makefile, run.sh
- 데이터 저장: SQLite (requests.db, CGO 필요), 로컬 파일시스템 (`~/.claude/projects/*.jsonl` 읽기 전용)
- CI/CD: 없음

## 임계값

| 지표 | 플래그 기준 |
|---|---|
| 파일 LOC | > 300 |
| 함수 LOC | > 50 |
| 함수 파라미터 수 | > 5 |
| 중첩 깊이 | > 4 |
| Import 수 (파일당) | > 25 |
| Fan-out | > 25 |
| 청크당 총 LOC | ~ 12,000 (300k context 기준 세션 안전선) |

## 리뷰 방식

영역 청크는 **4차원 통합 리뷰** 방식으로 한 번에 분석한다:

- **D1 초중급 실수** — 하드코딩 credential, magic number, 잔존 로그, 예외 미처리, any 남용, 중복 코드
- **D2 유지보수성** — 파일/함수 크기, 중첩 깊이, 파라미터 수, AI 분석 친화성(타입 완비도, 명명 일관성)
- **D3 결합도/응집도** — import 그래프, 순환 의존, 레이어 위반, fan-in/out, 응집도
- **D4 보안** — SQL injection, XSS, 비밀 노출, 인증/권한 우회, CORS, 입력 검증 누락

Cross-cutting (CC) 청크는 여러 영역을 관통하는 주제(인증 플로우, API 계약, 에러 처리, 설정/비밀)를 별도로 리뷰.

FINAL 청크는 모든 결과 통합 요약 + 리팩토링 우선순위 작성.

## 심각도 정의

- **Critical**: 즉시 조치 (운영 보안/데이터 손실/인증 우회)
- **High**: 단기 조치 (명백한 버그, 심각한 품질 저하)
- **Medium**: 계획된 리팩토링 대상
- **Low**: 개선 권장

---

## 청크 목록

### CHUNK-BE-01 — proxy 엔트리/설정/미들웨어/모델/프로바이더

Files (10개, ~1,923 LOC):
- `proxy/cmd/proxy/main.go` (141 LOC)
- `proxy/go.mod` (17 LOC)
- `proxy/internal/config/config.go` (260 LOC)
- `proxy/internal/middleware/logging.go` (96 LOC)
- `proxy/internal/model/models.go` (211 LOC)
- `proxy/internal/provider/anthropic.go` (131 LOC)
- `proxy/internal/provider/openai.go` (722 LOC)
- `proxy/internal/provider/provider.go` (15 LOC)
- `proxy/internal/service/anthropic.go` (122 LOC)
- `proxy/internal/service/storage.go` (36 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-BE-02 — proxy HTTP 핸들러

Files (2개, ~1,402 LOC):
- `proxy/internal/handler/handlers.go` (1,123 LOC)
- `proxy/internal/handler/utils.go` (279 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-BE-03 — proxy 서비스 레이어 (대화/라우팅/세션/스토리지)

Files (5개, ~1,770 LOC):
- `proxy/internal/service/conversation.go` (574 LOC)
- `proxy/internal/service/model_router.go` (232 LOC)
- `proxy/internal/service/session_index.go` (346 LOC)
- `proxy/internal/service/storage_sqlite.go` (582 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-FE-01 — web 컴포넌트 A: 메시지/대화/도구 렌더링

Files (9개, ~2,222 LOC):
- `web/app/components/CodeDiff.tsx` (102 LOC)
- `web/app/components/CodeViewer.tsx` (244 LOC)
- `web/app/components/ConversationThread.tsx` (202 LOC)
- `web/app/components/ImageContent.tsx` (143 LOC)
- `web/app/components/MessageContent.tsx` (399 LOC)
- `web/app/components/MessageFlow.tsx` (280 LOC)
- `web/app/components/TodoList.tsx` (189 LOC)
- `web/app/components/ToolResult.tsx` (256 LOC)
- `web/app/components/ToolUse.tsx` (208 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-FE-02 — web 컴포넌트 B: 상세/레이아웃/피커/공용

Files (6개, ~2,092 LOC):
- `web/app/components/HorizontalSplit.tsx` (128 LOC)
- `web/app/components/ProjectPicker.tsx` (139 LOC)
- `web/app/components/RequestDetailContent.tsx` (1,301 LOC) ⚠️ 초대형 파일 — 리팩토링 후보
- `web/app/components/SessionPicker.tsx` (411 LOC)
- `web/app/components/ThemeToggle.tsx` (58 LOC)
- `web/app/components/TopNav.tsx` (55 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-FE-03 — web 라우트 (loader/action + 페이지)

Files (14개, ~1,737 LOC):
- `web/app/entry.client.tsx` (18 LOC)
- `web/app/entry.server.tsx` (140 LOC)
- `web/app/root.tsx` (56 LOC)
- `web/app/routes/_index.tsx` (10 LOC)
- `web/app/routes/api.conversations.tsx` (25 LOC)
- `web/app/routes/api.grade-prompt.tsx` (32 LOC)
- `web/app/routes/api.projects.tsx` (18 LOC)
- `web/app/routes/api.requests.$id.tsx` (25 LOC)
- `web/app/routes/api.requests.tsx` (60 LOC)
- `web/app/routes/api.sessions.$sessionId.tsx` (33 LOC)
- `web/app/routes/api.sessions.tsx` (18 LOC)
- `web/app/routes/conversations.$projectId.tsx` (358 LOC)
- `web/app/routes/conversations.tsx` (48 LOC)
- `web/app/routes/requests.$sessionId.tsx` (760 LOC)
- `web/app/routes/requests.tsx` (57 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-SH-01 — web 유틸 + 스타일

Files (3개, ~460 LOC):
- `web/app/tailwind.css` (197 LOC)
- `web/app/utils/formatters.ts` (232 LOC)
- `web/app/utils/models.ts` (31 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-CF-01 — 빌드/배포/설정/환경

Files (14개, ~635 LOC):
- `.dockerignore` (82 LOC)
- `.env.example`
- `.gitignore` (44 LOC)
- `Dockerfile` (88 LOC)
- `Makefile` (74 LOC)
- `config.yaml.example` (99 LOC)
- `docker-entrypoint.sh` (62 LOC)
- `run.sh` (90 LOC)
- `web/.eslintrc.cjs` (84 LOC)
- `web/package.json` (44 LOC)
- `web/postcss.config.js` (6 LOC)
- `web/tailwind.config.ts` (32 LOC)
- `web/tsconfig.json` (32 LOC)
- `web/vite.config.ts` (40 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

### CHUNK-TS-01 — proxy 단위 테스트

Files (3개, ~904 LOC):
- `proxy/internal/service/conversation_test.go` (318 LOC)
- `proxy/internal/service/model_router_test.go` (137 LOC)
- `proxy/internal/service/session_index_test.go` (449 LOC)

Review items:
- [ ] REVIEW. 4차원 통합 리뷰 (D1+D2+D3+D4)

---

## Cross-cutting 청크

### CHUNK-CC-01 — API 계약 정합성 (BE 라우트 ↔ FE loader/프록시)

Files:
- `proxy/cmd/proxy/main.go` (라우터 등록)
- `proxy/internal/handler/handlers.go` (엔드포인트 구현)
- `web/app/routes/api.conversations.tsx`
- `web/app/routes/api.grade-prompt.tsx`
- `web/app/routes/api.projects.tsx`
- `web/app/routes/api.requests.$id.tsx`
- `web/app/routes/api.requests.tsx`
- `web/app/routes/api.sessions.$sessionId.tsx`
- `web/app/routes/api.sessions.tsx`
- `web/app/routes/conversations.$projectId.tsx` (직접 백엔드 호출)
- `web/app/routes/requests.$sessionId.tsx` (직접 백엔드 호출)
- `web/app/routes/requests.tsx`
- `web/app/routes/conversations.tsx`

Review items:
- [ ] CC. API 계약 정합성 (경로, 메서드, 쿼리, 응답 shape 일치 여부 / 404 라우트 / 고아 프록시)

### CHUNK-CC-02 — 에러 처리 및 로깅 일관성

Files:
- `proxy/internal/handler/handlers.go`
- `proxy/internal/handler/utils.go`
- `proxy/internal/middleware/logging.go`
- `proxy/internal/provider/anthropic.go`
- `proxy/internal/provider/openai.go`
- `proxy/internal/service/conversation.go`
- `proxy/internal/service/session_index.go`
- `proxy/internal/service/storage_sqlite.go`
- `web/app/entry.server.tsx`
- `web/app/root.tsx`
- `web/app/routes/requests.$sessionId.tsx`
- `web/app/routes/conversations.$projectId.tsx`

Review items:
- [ ] CC. 에러 처리 및 로깅 일관성 (에러 전파, wrap 패턴, 사용자 메시지 노출, 이모지 prefix 규칙, 민감 정보 로깅)

### CHUNK-CC-03 — 설정/비밀 관리

Files:
- `.env.example`
- `config.yaml.example`
- `proxy/internal/config/config.go`
- `proxy/internal/handler/utils.go` (SanitizeHeaders)
- `proxy/internal/provider/anthropic.go` (API key 사용)
- `proxy/internal/provider/openai.go` (API key 사용)
- `proxy/cmd/proxy/main.go` (config 주입)
- `Dockerfile`
- `docker-entrypoint.sh`
- `run.sh`

Review items:
- [ ] CC. 설정/비밀 관리 (API 키 저장/마스킹/로그 누출, 기본값 안전성, ENV/YAML 우선순위 일관성, Docker 컨텍스트)

### CHUNK-CC-04 — 세션/프로젝트 데이터 흐름

Files:
- `proxy/internal/service/conversation.go` (jsonl 파싱, decodeProjectPath)
- `proxy/internal/service/session_index.go` (인덱스 + fsnotify)
- `proxy/internal/service/storage_sqlite.go` (session_id 컬럼)
- `proxy/internal/handler/handlers.go` (GetSessions/GetRequests/Conversations)
- `web/app/components/SessionPicker.tsx`
- `web/app/components/ProjectPicker.tsx`
- `web/app/routes/requests.$sessionId.tsx`
- `web/app/routes/conversations.$projectId.tsx`

Review items:
- [ ] CC. 세션/프로젝트 데이터 흐름 (ID/경로 일관성, Unknown 버킷 처리, hasConversation 계산, 삭제 전파, 동시성)

---

## 최종 요약

### CHUNK-FINAL — 통합 리포트

Review items:
- [ ] FINAL. 이슈 통합 및 리팩토링 우선순위 작성
