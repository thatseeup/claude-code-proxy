# CHUNK-BE-02 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23
- Files reviewed: 2 (1,402 LOC)
- Sampling: none (전량 리뷰)
- Reviewer: o-web-reviewer subagent
- Scope: `proxy/internal/handler/handlers.go`, `proxy/internal/handler/utils.go`

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 깊이 | 최대 파라미터 수 | export 수 (대문자 함수/타입) | import 수 |
|---|---|---|---|---|---|---|
| handlers.go | 1,123 ⚠️ | `handleStreamingResponse` ≈ 271 ⚠️ | ~5 ⚠️ (L588-596 usage 파싱) | `New(6)` ⚠️ | 26 (Handler 메서드 22, 헬퍼 4) | 17 |
| utils.go | 279 | `AnalyzeConversationFlow` ≈ 115 ⚠️ | 4 | 2 | 4 + 3 타입 | 7 |

임계값 ⚠️ 요약:
- **파일 LOC > 300**: handlers.go (1,123, 약 3.7배 초과)
- **함수 LOC > 50**: 6개 함수 초과
  - `handleStreamingResponse` ≈ 271 ⚠️⚠️⚠️
  - `AnalyzeConversationFlow` ≈ 115 ⚠️⚠️
  - `Messages` ≈ 82 ⚠️
  - `mergePreservingOrder` ≈ 82 ⚠️
  - `GetRequests` ≈ 92 ⚠️
  - `GetConversations` ≈ 76 ⚠️
  - `extractTextFromMessage` ≈ 64 ⚠️
  - `handleNonStreamingResponse` ≈ 51 ⚠️
  - `summarizeRequestBody` ≈ 57 ⚠️
- **함수 파라미터 수 > 5**: `handler.New(6 params)` — L35
- **중첩 깊이 > 4**: `handleStreamingResponse` 내부 `message_start`/`message_delta` usage 파싱 블록 (L541-599) 5단계

### D3 의존성

- handlers.go 외부 import: `bufio`, `bytes`, `crypto/rand`, `encoding/hex`, `encoding/json`, `fmt`, `io`, `log`, `net/http`, `os`, `sort`, `strconv`, `strings`, `time`, `gorilla/mux`, `internal/model`, `internal/service` (17) — 임계값 이내
- utils.go 외부 import: `crypto/sha256`, `encoding/json`, `fmt`, `net/http`, `strings`, `time`, `internal/model` (7)
- Fan-out 과다 파일 (>25): 없음
- Fan-in 추정: `internal/handler` 패키지는 `cmd/proxy/main.go` 1곳에서만 사용 (정상, DI 루트 단일성)
- 순환 의존 후보: 없음. `handler → service/model` 단방향
- 레이어 준수 위반: **있음** (§이슈 [D3] 참조)
  - `UI()` (L158-168)에서 `os.ReadFile("index.html")`를 핸들러 레벨에서 직접 수행 — 정적 자산 서빙을 `net/http.FileServer` 또는 별도 assets 레이어로 분리해야 함
  - handlers.go 안에 `summarizeResponseBody`/`summarizeRequestBody`/`extractTextFromMessage`/`mergePreservingOrder`/`min` 같은 "헬퍼/변환" 로직이 `Handler` 라우팅 책임과 혼재

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 | 비고 |
|---|---|---|---|
| 비밀/credential 하드코딩 | 0 | D1,D4 | OK |
| 디버그 로그 잔존 (log.Printf 이모지) | 19+ | D1 | 이모지 포함 `❌/⚠️/📄/✅` — 일관성 있지만 표준 로깅 미사용 |
| SQL injection 의심 | 0 | D4 | DB 직접 접근 없음 |
| XSS/HTML injection | 1 | D4 | `UI()`에서 `os.ReadFile("index.html")` 후 `w.Write` — 경로는 정적이지만 작업 디렉터리 의존 |
| eval/exec/unsafe | 0 | D4 | OK |
| CORS 와일드카드 | 0 (이 청크) | D4 | CORS는 main.go, BE-01에 기록됨 |
| 민감정보 로깅 | 0 | D4 | `SanitizeHeaders`로 통제 (옵션 의존, BE-01 #4 참조) |
| 에러 리턴값 무시 | 8+ | D1 | `w.Write`, `json.NewEncoder.Encode`, `rand.Read` 반환값 미검사 |
| magic number | 5+ | D1 | `4*1024*1024` (L513), `64*1024` (L513), `500` (L760), `200` (L999), `100` (L267/utils), `96` (L329), `0.3` (L153), `prefixLen=96` (named const) |

### AI 분석 친화성
- 타입 시그니처 완비도: 높음 — Go이고 모든 export 함수는 타입 명시
- 명명 일관성: camelCase/PascalCase Go 관례 준수. 그러나 헬퍼 `min`, `max`가 양쪽 파일에 각각 정의 (Go 1.21+ builtin 사용 권장)
- 파일명 vs 주 export 일치: `handlers.go`는 다수 핸들러를 포함 (포괄적), `utils.go`는 `SanitizeHeaders` + `ConversationDiffAnalyzer` 두 책임 혼재 (불일치)
- 주석 밀도: 핵심 함수(mergePreservingOrder, summarizeRequestBody 등)에는 `why` 수준의 주석 존재, 준수 수준

---

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D1] `rand.Read` 반환 에러 무시 → 예측 가능한 RequestID 위험
- 파일: `proxy/internal/handler/handlers.go:886-890`
- 증거:
  ```go
  func generateRequestID() string {
      bytes := make([]byte, 8)
      rand.Read(bytes)
      return hex.EncodeToString(bytes)
  }
  ```
- 설명: `crypto/rand.Read`가 실패하면 `bytes`는 모두 0이 되어 모든 요청이 같은 ID `"0000000000000000"`를 갖는다. 로그 추적 신뢰성 상실, 동일 ID의 요청이 한 버킷에 축적되면 `GetRequestByShortID` 동작 이상. 보안상도 엔트로피 0.
- 수정 제안: `if _, err := rand.Read(bytes); err != nil { /* log + fallback to time-based */ }`. 또는 `uuid.New().String()` 사용.

### [High] [D2] `handleStreamingResponse` 271 LOC — 임계값 5.4배 초과, 다중 책임
- 파일: `proxy/internal/handler/handlers.go:463-733`
- 증거: SSE 헤더 설정, 에러 분기, scanner 설정, 이벤트 라우팅(message_start/message_delta/content_block_*), usage 누적, partial JSON 처리, block 정렬, merge, 저장이 단일 함수에 모두 혼재
- 설명: 가장 복잡한 함수. 1개 함수 안에 7개 이상의 별개 책임이 섞여 있어 버그 추적·테스트가 어렵다. 중첩 깊이도 최대 5단계(L588-596).
- 수정 제안:
  - `streamForwarder` / `streamAggregator` / `responseBuilder` 로 분리
  - 이벤트 타입별 핸들러를 map[string]func(...) 로 디스패치
  - SSE 에러 분기는 별도 `writeStreamingError` 추출

### [High] [D2] `handlers.go` 1,123 LOC — 파일 임계값 3.7배 초과, 7개 도메인 혼재
- 파일: `proxy/internal/handler/handlers.go` 전체
- 증거: Messages/Models/Health/UI/Requests/Sessions/Conversations/Projects + 헬퍼(summarize*, merge*, extractText*, writeJSON*) 가 단일 파일에
- 수정 제안: 다음 분해 권장
  - `handlers_messages.go` (Messages, handleStreaming/NonStreaming, merge helpers)
  - `handlers_requests.go` (GetRequests, GetRequestByID, summarize*, DeleteRequests)
  - `handlers_sessions.go` (GetSessions, DeleteSession, sessionResponse, sessionPathUnknown)
  - `handlers_conversations.go` (GetConversations, GetConversationByID, GetProjects, GetConversationsByProject, extractTextFromMessage)
  - `handlers_misc.go` (ChatCompletions, Models, Health, UI, NotFound)
  - `responses.go` (writeJSONResponse, writeErrorResponse)

### [High] [D1,D4] 이벤트 페이로드 파싱 시 타입 단언 실패를 조용히 통과 (중간 타입만 필드 업데이트)
- 파일: `proxy/internal/handler/handlers.go:541-599`
- 증거:
  ```go
  if eventType, ok := genericEvent["type"].(string); ok && eventType == "message_start" {
      if message, ok := genericEvent["message"].(map[string]interface{}); ok {
          if id, ok := message["id"].(string); ok { messageID = id }
          ...
          if reason, ok := message["stop_reason"].(string); ok { stopReason = reason }
  ```
- 설명: 상위 데이터가 깨진 경우 `finalUsage` 필드 일부만 채워지고 일부는 기본값 그대로. 클라이언트는 정합성 없는 usage 통계를 받게 되며, 이는 과금/토큰 한도 산정 신뢰성에 직결. D4 측면으로는 이상 이벤트 형식에 대한 가드 부재.
- 수정 제안: 구조체 언마샬링으로 일괄 디코딩(이미 `model.StreamingEvent`가 있음). 실패 시 해당 청크를 스킵하고 카운터 증가. usage 필드 파싱 결과를 누적이 아니라 "마지막 유효 메시지 교체"로 확정.

### [High] [D2] `AnalyzeConversationFlow` 115 LOC — 두 경로(diff vs heuristic)를 하나의 함수에 구현
- 파일: `proxy/internal/handler/utils.go:93-206`
- 증거: previousConversation 존재 시 diff, 없을 때 `newThreshold := max(1, int(float64(totalMessages)*0.3))` 휴리스틱 — 완전히 다른 로직이 같은 함수에 있음
- 설명: 두 분기가 `newMessages`, `duplicateMessages`, `changes` 슬라이스를 **다시 빈 슬라이스로 재할당**(L156-158)하여 앞 루프(L119-148) 결과를 통째로 버린다. 데드워크 + 가독성 저하.
- 수정 제안: 두 경로를 `diffAgainstPrevious` / `firstTimeHeuristic` 함수로 분리. `AnalyzeConversationFlow`는 디스패처로 축소.

### [High] [D1] `max`, `min` 중복 정의 + Go 1.21 builtin 미사용
- 파일: `handlers.go:786-791`, `utils.go:274-279`
- 증거: 동일 시그니처의 `min(a,b int)`, `max(a,b int)` 두 곳에 존재
- 설명: Go 1.21 이후 내장 `min`/`max` 제공. 재정의는 중복 + 추후 호환성 이슈. 양쪽 파일에 흩어져 있어 응집도 훼손.
- 수정 제안: 두 정의 모두 삭제 후 builtin 사용 (`go.mod` Go 버전 확인 필요). Go 1.21 미만이면 공용 `pkg/util/numeric.go`로 단일화.

### [High] [D2] `GetRequests` 92 LOC + 다중 책임 (페이징 + 필터 + 요약 변환)
- 파일: `proxy/internal/handler/handlers.go:170-258`
- 설명: 쿼리 파싱, 세션/모델 필터 분기, 포인터→값 복제, 페이지네이션, summary 변환, 인코딩이 단일 함수에. summary 변환은 request/response 둘 다 처리.
- 수정 제안: `parseListQuery(r) -> listQuery`, `paginate([]T, page, limit) ([]T, total)` 제네릭 유틸, `applyListSummary(*RequestLog)` 분리.

### [High] [D3] `UI()` 핸들러의 경로 의존성 (working directory 기반 파일 읽기)
- 파일: `proxy/internal/handler/handlers.go:158-168`
- 증거:
  ```go
  htmlContent, err := os.ReadFile("index.html")
  ```
- 설명: 현재 작업 디렉터리에 `index.html`이 있어야 동작 → 다른 cwd에서 바이너리 실행 시 `404`. 레이어링 위반(핸들러가 FS 직접 접근). Content-Type만 설정하고 추가 보안 헤더(X-Content-Type-Options, CSP) 부재.
- 수정 제안: `http.FileServer(http.Dir("web"))` 또는 `embed.FS`로 정적 자산 임베드. CSP 헤더 추가.

### [Medium] [D4] `UI()` 응답 시 `w.Write` 에러 미처리 + 보안 헤더 누락
- 파일: `proxy/internal/handler/handlers.go:166-167`
- 증거:
  ```go
  w.Header().Set("Content-Type", "text/html")
  w.Write(htmlContent)
  ```
- 설명: D4 관점 — X-Frame-Options, X-Content-Type-Options, CSP 등 정적 HTML 서빙에 기대되는 보안 헤더 없음. 또 `w.Write` 반환값 무시.
- 수정 제안: 보안 헤더 미들웨어 도입(이미 main.go에 CORS 있음), Write 에러 로깅.

### [Medium] [D1] Magic number / 리터럴 다수 (버퍼 크기, 미리보기 길이, 휴리스틱 비율)
- 파일:
  - `handlers.go:513` — `scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)` (64KB 초기, 4MB 최대)
  - `handlers.go:760` — `responseBytes[:min(500, len(responseBytes))]`
  - `handlers.go:999` — `if len(firstMessage) > 200 { firstMessage = firstMessage[:200] + "..." }`
  - `handlers.go:329` — `const prefixLen = 96` (네이밍 있음, OK)
  - `utils.go:153` — `int(float64(totalMessages)*0.3)` (30% 휴리스틱)
  - `utils.go:215, 227` — `hash[:8]`, `hash[:16]` (해시 truncation 길이)
  - `utils.go:267` — 100 preview cap
- 설명: 휴리스틱 비율 0.3과 buffer 한도는 동작 튜닝 포인트이지만 상수화되지 않음.
- 수정 제안: 파일 상단 `const` 블록으로 끌어올려 의미를 부여 (`const sseMaxLineSize = 4 * 1024 * 1024 // input_json_delta 단일 청크 한도`).

### [Medium] [D1] `w.Write` / `json.NewEncoder.Encode` 반환 에러 다수 무시
- 파일: `handlers.go:167, 251, 363, 489, 777, 782, 910` 등
- 설명: 클라이언트 커넥션 조기 종료 시 로그 부재 → 장애 원인 추적 불가. 특히 스트리밍 경로(L489, L777)에서 누적 쓰기 실패가 조용히 무시됨.
- 수정 제안: 최소한 `if _, err := w.Write(b); err != nil { log.Printf("write failed: %v", err) }` 패턴 일원화.

### [Medium] [D2] `Messages` 함수 내부에 라우팅/저장/본문 rewrite/전송이 혼재 (82 LOC)
- 파일: `proxy/internal/handler/handlers.go:55-135`
- 증거: JSON 파싱 → 라우팅 → 로그 구성 → 저장 → body 재마샬 → forward → 스트리밍/비스트리밍 분기
- 설명: 에러 분기가 5개 있고 각 분기가 response writer를 통해 종료. 단위 테스트 작성 난이도 높음.
- 수정 제안: `buildRequestLog(r, decision, bodyBytes) *RequestLog`, `rewriteBodyWithTargetModel(r, req) error` 추출. 저장은 고루틴으로 비동기 처리 고려.

### [Medium] [D2] `summarizeRequestBody` return type `interface{}` — 타입 안전성 상실
- 파일: `proxy/internal/handler/handlers.go:289-341`
- 증거:
  ```go
  func summarizeRequestBody(raw string) interface{} {
      ...
      out := map[string]interface{}{ "stream": parsed.Stream }
  ```
- 설명: 호출부(`requests[i].Body = summarizeRequestBody(...)`)가 `Body interface{}`에 그대로 바인딩. 스키마 변경 시 컴파일러 도움 없음. 또한 반환되는 `map[string]interface{}` 내부에 `[]json.RawMessage`와 `[]map[string]string`이 섞여 있어 UI측 타입 추론 어려움.
- 수정 제안: `RequestBodySummary` 구조체 정의 후 명시적 반환.

### [Medium] [D3] `utils.go`에 `SanitizeHeaders`(http 유틸)와 `ConversationDiffAnalyzer`(도메인 분석) 가 함께 존재 — 응집도 낮음
- 파일: `proxy/internal/handler/utils.go` 전체
- 설명: 두 타입/함수는 서로 다른 도메인이며 공유하는 의존성도 다르다. `utils.go`는 "모르는 것들의 쓰레기통" 안티패턴에 가깝다.
- 수정 제안:
  - `SanitizeHeaders` → `proxy/internal/handler/headers.go` (또는 middleware 패키지)
  - `ConversationDiffAnalyzer` → `proxy/internal/service/conversation_diff.go` (도메인 서비스)
  - 그러면 `handler` 패키지는 HTTP 경계에만 집중

### [Medium] [D3] `ConversationDiffAnalyzer`가 `handler` 패키지에 존재 — 레이어 위반
- 파일: `proxy/internal/handler/utils.go:62-271`
- 설명: diff 분석은 도메인 로직인데 현재 HTTP 핸들러 패키지에 있음. 어떤 핸들러에서도 `c.AnalyzeConversationFlow`를 호출하지 않는 것으로 보이며, export되지만 프로젝트에서 활용처가 없을 가능성(dead code 우려).
- 수정 제안: 실제 사용처 확인. 사용 중이면 service 레이어로 이동, 미사용이면 삭제. grep 결과 handler 내부에서 호출 없음.

### [Medium] [D1] Timestamp를 Unix epoch 문자열로 기록 (`fmt.Sprintf("%d", time.Now().Unix())`)
- 파일: `proxy/internal/handler/utils.go:135, 145, 169, 179`
- 증거:
  ```go
  Timestamp: fmt.Sprintf("%d", time.Now().Unix()),
  ```
- 설명: 프로젝트 전반(handlers.go L85, L412 등)은 RFC3339 사용 중. 포맷 혼재 → UI/분석 어려움. 또한 초 단위 정밀도는 rapid change에서 충돌.
- 수정 제안: `time.Now().UTC().Format(time.RFC3339Nano)` 통일. 또는 `int64` 필드로 Unix millis.

### [Medium] [D2] `handler.New`의 파라미터 6개 — positional 인자 실수 위험
- 파일: `proxy/internal/handler/handlers.go:35`
- 증거:
  ```go
  func New(anthropicService service.AnthropicService, storageService service.StorageService,
           logger *log.Logger, modelRouter *service.ModelRouter,
           sanitizeHeaders bool, sessionIndex service.SessionIndex) *Handler {
  ```
- 설명: bool 플래그가 포지션 4에 끼어 있어 호출부에서 실수하기 쉬움. main.go 한 곳만 쓰고 있으나 향후 확장 시 혼동.
- 수정 제안: `type Deps struct { ... }; func New(deps Deps) *Handler`.

### [Low] [D1] 이모지 기반 로그 프리픽스가 일관성은 있으나 표준 로깅 레벨 없음
- 파일: 전체
- 설명: `log.Printf("❌ ...")`, `log.Printf("⚠️ ...")`, `log.Println("✅ ...")` 등 — 파서블한 level tag가 없어 운영 환경 로그 필터링 어려움.
- 수정 제안: `logger.Error/Warn/Info` 메서드를 갖는 wrapper, 또는 slog (Go 1.21+) 도입.

### [Low] [D1] `min` 사용 시 L760에 `responseBytes[:min(500, len(responseBytes))]` — 첫 500자만 로깅
- 파일: `handlers.go:760`
- 설명: 동작은 정상이나 L786의 자체 정의 `min`에 의존. Go 1.21 builtin 사용 권장.

### [Low] [D4] `SanitizeHeaders` truthiness — sanitize=false일 때 **모든** 헤더가 그대로 복사됨
- 파일: `proxy/internal/handler/utils.go:20-25`
- 설명: BE-01 FIXES #4와 연결된 동일 이슈(신규 항목 아님). 여기서는 구현이 올바르다는 확인. sanitize=false 기본값이면 민감 헤더 평문 저장.
- 수정 제안: BE-01 FIXES #4 참조. 이 청크에서는 추가 FIXES 항목 필요 없음.

### [Low] [D1] `GetConversations` 응답이 `map[string]interface{}` slice — 타입 없는 응답
- 파일: `handlers.go:1007-1016`
- 설명: 응답 구조체 정의(`conversationResponse`)가 있으면 OpenAPI/클라이언트 타입 생성 용이. 현재는 FE/BE 계약이 dict-of-strings 수준.
- 수정 제안: `type conversationListItem struct { ... }` 정의.

### [Low] [D1] `DeleteRequests`: 응답 메시지에 한국어 없이 영문만 — 전체 프로젝트 응답 포맷 확인 필요
- 파일: `handlers.go:375-380`
- 설명: 이슈라기보다 팀 컨벤션 확인 포인트.

---

## 긍정적 관찰

1. **스트리밍 응답 복원 로직 (`mergePreservingOrder`)**: 주석이 상세하며 top-level key 순서를 보존하는 의도가 명확. 테스트 추가 가치 큼.
2. **SanitizeHeaders 설계**: 옵션 토글 + SHA256 해싱 + sensitive 리스트 화이트 기반 매칭. 구조가 읽기 쉽고 로컬 트러스트 모델에 주석이 담겨 있음 (L14-16).
3. **세션 미지정 버킷 처리 (`sessionPathUnknown`)**: 상수화(L434-436)로 매직 문자열 방지. 빈 sessionID ↔ "unknown" 매핑 의도가 명료.
4. **summarize\* 함수군**: 리스트 조회 최적화 의도(Node max string length 회피 주석 L345-346)가 기록되어 있어 AI/신규 기여자 이해에 도움.
5. **SSE 라인 재전송**: L517-525 — upstream SSE 프레이밍을 "데이터만 필터하지 말고 통째로 포워드"한 의사결정이 주석으로 남아 있음 (Claude Code SSE 파서 호환 이슈 언급).

## Cross-cutting 리뷰 시 참고 단서

- **로깅 포맷 정책** (CC 주제 후보): `handlers.go`의 이모지 Printf + `utils.go`의 Unix epoch timestamp + main.go/다른 패키지의 로거가 모두 다름. 전체 로깅 정책 수립 필요.
- **타입 안전성 경계**: `summarizeRequestBody` 반환이 `interface{}`인 것은 FE의 list view 렌더 로직(`message preview`, `system[2]` 에이전트 분류)과 직접 연결. FE 쪽 `classifySession`과의 계약 검증 필요 (CC-02 API 계약).
- **UI 정적 자산 서빙**: `UI()`가 cwd 의존적이고 CSP 없음. main.go 라우팅 및 FE 빌드/배포 구조와 함께 검토.
- **`SanitizeHeaders` 동작**: BE-01 FIXES #4와 직접 연결. sanitize=false 기본값은 로컬 전제이므로 main.go의 기본값·가드와 crosscheck 필요.
- **ConversationDiffAnalyzer 사용 여부**: 본 청크에서 사용처 확인 불가. CC-03(기능 dead code) 또는 service 레이어 조사 필요.
- **`Messages` 파이프라인**: storageService.SaveRequest가 실패해도 계속 진행(L98-100). 로깅 정책과 맞물려 저장 실패 탐지 필요.
