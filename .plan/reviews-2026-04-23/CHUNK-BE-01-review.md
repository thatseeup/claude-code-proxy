# CHUNK-BE-01 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23T00:00:00Z
- Files reviewed: 10 (1,751 LOC — `wc -l` 합계 기준; 지침 상 청크 LOC 합계는 1,923)
- Sampling: none (청크 전체 완독)
- Reviewer: o-web-reviewer subagent (integrated 4-dim)

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 | 최대 파라미터 | import | export/top-decl | 플래그 |
|---|---|---|---|---|---|---|---|
| cmd/proxy/main.go | 141 | ~118 (`main`) | 3 | 0 | 12 | 1 | main 함수 길이 ⚠️ |
| go.mod | 17 | — | — | — | — | — | — |
| internal/config/config.go | 260 | ~130 (`Load`) | 3 | 2 | 5 | 6 func + 9 type | `Load` ⚠️ |
| internal/middleware/logging.go | 96 | ~37 (`Logging`) | 3 | 2 | 7 | 4 | OK |
| internal/model/models.go | 211 | ~21 (`GetContentBlocks`) | 4 | 1 | 2 | 19 type + 1 func | 다수 DTO ⚠️(LOC) |
| internal/provider/anthropic.go | 131 | ~60 (`ForwardRequest`) | 4 | 2 | 10 | 3 func + 2 type | `ForwardRequest` ⚠️ |
| internal/provider/openai.go | **722** | **~292 (`convertAnthropicToOpenAI`)** | **7** | 2 | 11 | 8 func + 2 type | **다수 임계치 초과** |
| internal/provider/provider.go | 15 | — | — | — | 2 | 1 iface | OK |
| internal/service/anthropic.go | 122 | ~44 (`decompressGzipResponse`) | 3 | 2 | 9 | 3 func + 2 type | OK |
| internal/service/storage.go | 36 | — | — | — | 3 | 1 iface + 1 type | OK |

임계값 플래그:
- 파일 LOC > 300: **openai.go (722)**
- 함수 LOC > 50: **main.go:main (~118)**, **config.go:Load (~130)**, **openai.go:convertAnthropicToOpenAI (~292)**, **openai.go:transformOpenAIResponseToAnthropic (~105)**, **openai.go:transformOpenAIStreamToAnthropic (~140)**, **openai.go:ForwardRequest (~128)**, **anthropic.go:ForwardRequest (~60)**
- 중첩 깊이 > 4: **openai.go:convertAnthropicToOpenAI (최대 7 level)** — `msg → contentArray → item → block → blockType → content → contentList → contentMap → text`
- 파라미터 수 > 5: 해당 없음
- Import 수 > 25: 해당 없음 (최대 12)

### D3 의존성

- 청크 내 import 관계: 대체로 하향 의존(config → {}, model → {}, provider → {config, model}, service → {config, model}, middleware → {model}, main → {config, handler, middleware, provider, service}).
- **외부 패키지**: `gorilla/mux`, `gorilla/handlers`, `joho/godotenv`, `yaml.v3`, `mattn/go-sqlite3` (청크 외), `fsnotify` (청크 외)
- **Fan-out 과다 파일(>25)**: 없음
- **Fan-in 추정 (청크 외 `internal/handler/*`, `internal/service/*`)**: model 패키지 → 청크 외부에서 광범위하게 참조됨(DTO 허브), provider 패키지 → main에서만 참조.
- **순환 의존 후보**: 없음.
- **레이어 위반**: 없음(라우트/핸들러가 DB 드라이버 직접 import하지 않음 — storage 인터페이스 사용). 단, `anthropicService`(service)와 `AnthropicProvider`(provider)가 **거의 동일한 코드를 중복** — 응집성/DRY 관점에서 레이어 혼란.
- **중복 코드**: `service/anthropic.go:ForwardRequest` vs `provider/anthropic.go:ForwardRequest` — 체감 80% 동일 (base URL 파싱, hop-by-hop, gzip 해제). Provider 추상화 도입 후에도 "legacy anthropic service"(`main.go:40`)가 병존.

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 |
|---|---|---|
| 하드코딩 비밀 (`api_key=`, `token=` 등) | 1 (빈문자열 초기화, 실제 비밀 아님) | D4 |
| 민감 헤더 로깅 경고 | 1 (의도된 경고문) | D4 |
| CORS 와일드카드 (`AllowedOrigins:["*"]`) | 1 | **D4** |
| 디버그 `fmt.Println`/`log.Println` (운영 잔존) | 0 (로거는 구조화) | D1 |
| `interface{}` 사용 (Go 버전 `any` 상당) | **102 히트(청크 포함 5파일)** | D1 |
| SQL 문자열 연결 의심 | 0 (storage_sqlite는 placeholder 사용 — 청크 외) | D4 |
| `eval`/`exec.Command` | 0 | D4 |
| TODO/FIXME | 0 | D1 |
| 미사용 함수 (dead code) | **4**: `config.getEnv`, `openai.min`, `openai.getMapKeys`, `openai.go` 에러 로그 주석들 | D1 |
| 반환 에러 무시 | **1**: `config.go:135 cfg.loadFromFile(configPath)` | **D1,D4** |

### AI 분석 친화성
- 타입 시그니처 완비도: 함수 반환값 기준 100% (Go). 단 `interface{}` 남용(provider/openai.go)으로 호출부/소비자 관점 정보량 낮음 — **저**.
- 명명 일관성: snake/camel 혼용 없음 (Go 컨벤션 준수). 단 **`AnthropicConfig`(legacy) vs `AnthropicProviderConfig`(신규)** 이중 구조는 혼란 유발.
- 파일명 ↔ 주 export 명 일치: OK (`provider/openai.go` → `OpenAIProvider` 등).
- 주석 밀도: 적정. 중요한 설계 의도(`// Use legacy anthropic service for backward compatibility`)가 명시되어 있음.

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D4] CORS가 모든 Origin에 대해 와일드카드(`*`)로 열려 있음
- 파일: `proxy/cmd/proxy/main.go:66-70`
- 증거:
  ```go
  corsHandler := handlers.CORS(
      handlers.AllowedOrigins([]string{"*"}),
      handlers.AllowedMethods([]string{"GET", "POST", "PUT", "DELETE", "OPTIONS"}),
      handlers.AllowedHeaders([]string{"*"}),
  )
  ```
- 설명: 프록시는 `/v1/messages` 로 Anthropic 트래픽을 가로채며 요청 본문 · 헤더를 SQLite에 저장한다. 동일 서버가 `/api/requests`로 저장 데이터(원본 프롬프트, 헤더 — `sanitize_headers=false`일 때는 Authorization 포함)를 노출한다. 모든 Origin에 대해 CORS를 허용하면 로컬 워크스테이션의 임의 브라우저 탭에서 내부 대화/비밀을 읽을 수 있다(브라우저 기반 "DNS rebinding / malicious page" 시나리오).
- 수정 제안: `AllowedOrigins`를 `config.yaml`에 선언된 화이트리스트(`http://localhost:3000` 등)로 제한. `AllowedHeaders`도 명시 목록으로.

### [Critical] [D1,D4] `loadFromFile` 에러를 완전히 무시 → 잘못된 설정으로 조용히 기동
- 파일: `proxy/internal/config/config.go:135`
- 증거:
  ```go
  cfg.loadFromFile(configPath)

  // Apply environment variable overrides AFTER loading from file
  if envPort := os.Getenv("PORT"); envPort != "" {
  ```
  선언부(`config.go:218`):
  ```go
  func (c *Config) loadFromFile(path string) error {
      data, err := os.ReadFile(path)
      if err != nil { return err }
      return yaml.Unmarshal(data, c)
  }
  ```
- 설명: `config.yaml`의 YAML 파싱 오류 또는 파일 미발견 오류가 **로그 없이 버려진다**. 운영자는 자신이 설정한 `security.sanitize_headers=true` / 화이트리스트 등이 적용되었다고 오해한 채로 프록시가 보안상 약한 기본값(예: sanitize nil → true이긴 하지만, CORS/포트 설정은 기본값)으로 뜬다. 특히 **파싱 오류는 실제 프로덕션 오설정**의 대표 원인이다.
- 수정 제안: `if err := cfg.loadFromFile(configPath); err != nil { if !os.IsNotExist(err) { return nil, fmt.Errorf("invalid config.yaml: %w", err) } }` 형태로 파일은 optional로 두되 **파싱/권한 오류는 반드시 전파**.

### [High] [D2,D3] `provider/openai.go`가 722 LOC · 단일 함수 292 LOC · 중첩 7단계 — 임계값 다중 초과
- 파일: `proxy/internal/provider/openai.go:167-459`
- 증거:
  ```go
  func convertAnthropicToOpenAI(req *model.AnthropicRequest) map[string]interface{} {
      ...
      for _, msg := range req.Messages {
          if contentArray, ok := msg.Content.([]interface{}); ok {
              ...
              if hasToolResults {
                  for _, item := range contentArray {
                      if block, ok := item.(map[string]interface{}); ok {
                          if blockType, hasType := block["type"].(string); hasType {
                              if blockType == "tool_result" {
                                  if content, hasContent := block["content"]; hasContent {
                                      if contentList, ok := content.([]interface{}); ok {
                                          for _, c := range contentList {
                                              if contentMap, ok := c.(map[string]interface{}); ok {
                                                  if contentMap["type"] == "text" {
  ```
- 설명: 파일 LOC 722, 함수 `convertAnthropicToOpenAI` ~292 LOC, `transformOpenAIStreamToAnthropic` ~140 LOC, `transformOpenAIResponseToAnthropic` ~105 LOC, `ForwardRequest` ~128 LOC, 중첩 최대 7단계. 버그 수정·확장 난이도가 매우 높고 단위 테스트 작성이 어렵다. `interface{}` 다중 assertion이 누적되어 AI 코드리뷰/IDE refactor도 어려움.
- 수정 제안: ① `openai_convert.go`, `openai_stream.go`, `openai_response.go`로 파일 분할. ② content-block 파싱을 중간 DTO(`openAIMessage`, `openAIToolResult`)로 정규화하여 중첩을 2–3단계로 축소. ③ 각 변환 단위별 table-driven 테스트 추가.

### [High] [D4] `sanitize_headers=false` 기본이 아닐 뿐 여전히 가능 — 민감 헤더 평문 저장 옵션 제공
- 파일: `proxy/cmd/proxy/main.go:58-62`, `proxy/internal/config/config.go:22-28, 211-216`
- 증거:
  ```go
  sanitizeHeaders := cfg.ShouldSanitizeHeaders()
  if !sanitizeHeaders {
      logger.Println("⚠️  security.sanitize_headers=false — request logs will store original Authorization/API-key headers in plaintext")
  }
  ```
- 설명: `sanitize_headers=false`로 설정되면 Authorization / x-api-key 원문이 SQLite에 영구 보관된다. 경고 로그는 운영자가 무시하기 쉽고, DB 백업/공유 시 비밀이 유출된다. 이 프록시는 개발자 도구이지만 `~/.claude` 하위 세션 JSON 등 민감 경로를 다루므로 "local-only" 가정은 너무 낙관적이다.
- 수정 제안: ① `false`일 때 시작 프롬프트(CLI flag `--i-understand-the-risk`)를 요구하거나 최소 `time.Sleep(3s)` 대기 후 기동. ② sanitize=false로 저장된 row에 `secrets_in_plaintext=1` 플래그 컬럼 추가하여 UI에서 redact 렌더링. ③ 기본 `*bool` 을 `true`로 명시적 포인터로 초기화(현재 nil → true 의존).

### [High] [D1,D3] 중복된 Anthropic 포워딩 로직 — `service/anthropic.go` vs `provider/anthropic.go`
- 파일: `proxy/internal/service/anthropic.go:35-78`, `proxy/internal/provider/anthropic.go:35-94`
- 증거 (동일 패턴 80%):
  ```go
  // service/anthropic.go
  proxyReq := originalReq.Clone(ctx)
  baseURL, err := url.Parse(s.config.BaseURL)
  ...
  proxyReq.URL.Scheme = baseURL.Scheme
  proxyReq.URL.Host = baseURL.Host
  proxyReq.URL.Path = path.Join(baseURL.Path, "/v1/messages")
  ```
  ```go
  // provider/anthropic.go
  proxyReq := originalReq.Clone(ctx)
  baseURL, err := url.Parse(p.config.BaseURL)
  ...
  proxyReq.URL.Scheme = baseURL.Scheme
  proxyReq.URL.Host = baseURL.Host
  proxyReq.URL.Path = path.Join(baseURL.Path, originalReq.URL.Path)
  ```
  `main.go:40` 주석: "Use legacy anthropic service for backward compatibility".
- 설명: 두 구현이 병존하며 **hop-by-hop 헤더 제거는 provider에만 있고 service에는 없음**, **anthropic-version 헤더 주입도 provider에만 있음**, **gzip 해제 구현 방식이 서로 다름**(service는 전체를 메모리에 읽어 새 Response 생성, provider는 스트리밍). 라우팅 분기에 따라 행동이 다르고, 보안·성능 패치 적용 시 한쪽이 누락될 가능성이 높다.
- 수정 제안: legacy service 제거 경로를 확정(main.go의 `anthropicService` 파라미터를 handler에서 제거). 또는 service가 provider["anthropic"]를 위임하도록 thin wrapper로 축소.

### [High] [D2] `main.go:main` 함수 ~118 LOC — 초기화 로직이 응집되지 않음
- 파일: `proxy/cmd/proxy/main.go:23-141`
- 설명: DI 구성, 라우트 등록, 서버 부트, 시그널 처리, 세션 인덱스 watcher 기동이 모두 단일 함수에 섞여 있다. 테스트하기 어려우며 AI 리팩토링도 어렵다.
- 수정 제안: `setupRouter(cfg, deps)`, `setupHTTPServer(cfg, h)`, `runServer(srv, watchCtx)` 로 분리.

### [High] [D4] 포워딩 대상 URL의 TLS 검증 설정을 **클라이언트에서 제어하지 않음**(명시적이지 않음)
- 파일: `proxy/internal/provider/anthropic.go:23-28`, `proxy/internal/provider/openai.go:26-31`, `proxy/internal/service/anthropic.go:27-32`
- 증거:
  ```go
  client: &http.Client{
      Timeout: 300 * time.Second,
  },
  ```
- 설명: `Transport`가 미지정 → `http.DefaultTransport` 사용. 기본값은 안전하지만, `ANTHROPIC_FORWARD_URL` 을 임의 호스트(`http://`)로 덮어쓸 수 있으므로(config.go:152) 평문 HTTP로 Authorization 헤더가 전송될 위험이 있다. 포워드 URL이 `https`임을 **검증하지 않는다**.
- 수정 제안: `config.Load()` 에서 `baseURL.Scheme != "https"`면 startup 시 경고 또는 거부(`INSECURE_FORWARD_URL=1` 환경변수로만 허용).

### [High] [D1] 미사용 헬퍼/dead code 다수
- 파일: `proxy/internal/config/config.go:227-232` (`getEnv`), `proxy/internal/provider/openai.go:461-467` (`getMapKeys`), `proxy/internal/provider/openai.go:469-474` (`min`)
- 증거:
  ```go
  func getEnv(key, defaultValue string) string {
      if value := os.Getenv(key); value != "" {
          return value
      }
      return defaultValue
  }
  ```
- 설명: 세 함수는 어느 곳에서도 호출되지 않음(`go vet` / `staticcheck U1000` 대상). 유지보수 시 잘못 호출될 위험과 AI 코드리뷰 노이즈.
- 수정 제안: 삭제하거나 실제 사용처로 교체. 특히 `getEnv`는 `os.Getenv` 직접 사용보다 좋은 API이므로 실제로 적용하는 것이 좋음.

### [High] [D2] `openai.go:transformOpenAIResponseToAnthropic` 가 에러를 모두 삼킴
- 파일: `proxy/internal/provider/openai.go:476-580`
- 증거:
  ```go
  if err := json.Unmarshal(respBody, &openAIResp); err != nil {
      return respBody // Return as-is if we can't parse
  }
  ...
  result, _ := json.Marshal(anthropicResp)
  return result
  ```
- 설명: Parse 실패 시 **원본 OpenAI JSON이 Anthropic 스키마로 위장되어 클라이언트로 반환**된다. Claude Code 클라이언트는 Anthropic 포맷을 기대하므로 디코딩 실패가 조용히 발생한다. `json.Marshal` 에러도 무시.
- 수정 제안: 함수 시그니처를 `(..., error)` 로 바꾸고 호출부(`ForwardRequest:158`)에서 에러 시 Anthropic 오류 응답으로 래핑.

### [Medium] [D1] "하드코딩 상수"가 비즈니스 규칙으로 박혀 있음 — `maxTokensLimit = 16384`
- 파일: `proxy/internal/provider/openai.go:336-340`
- 증거:
  ```go
  maxTokensLimit := 16384 // Assuming this is the limit for the model
  if req.MaxTokens > maxTokensLimit {
      req.MaxTokens = maxTokensLimit
  }
  ```
- 설명: 주석 "Assuming this is the limit for the model"이 말해주듯 근거가 약하다. 모델별로 다르며 OpenAI가 16k/128k 등 다양하다. 사용자 요청을 silently 잘라낸다.
- 수정 제안: 모델별 한도 맵(`map[string]int`)을 config.yaml에 두고, 잘림 시 응답 헤더로 알림.

### [Medium] [D3] `AnthropicConfig`(legacy)와 `AnthropicProviderConfig`(신규) 이중 구조
- 파일: `proxy/internal/config/config.go:19, 50-54, 61-65, 176-180, 200-204`
- 설명: 두 번(`Load` 내 176, 200) 동일하게 `cfg.Anthropic = AnthropicConfig{...}` 싱크. 한쪽 필드 추가 시 놓치기 쉬움.
- 수정 제안: `AnthropicConfig`를 삭제하고 `AnthropicService`/`AnthropicProvider`가 `AnthropicProviderConfig`를 공용으로 사용.

### [Medium] [D2] `model/models.go` LOC 211 — DTO 파일로는 OK지만 도메인 혼재
- 파일: `proxy/internal/model/models.go`
- 설명: 로깅 DTO(`RequestLog`, `ResponseLog`), 채팅 요청(`ChatMessage`, `ChatCompletionRequest`), Anthropic 변환(`AnthropicMessage`, `AnthropicContentBlock` 등), 스트리밍(`StreamingEvent`, `Delta`), 건강체크/에러 등 5개 이상의 도메인이 섞여 있음. AI가 관련 타입을 찾을 때 혼란.
- 수정 제안: `model/log.go`, `model/anthropic.go`, `model/openai.go`, `model/common.go` 로 분할.

### [Medium] [D4] `middleware.Logging` 가 전체 요청 본문을 메모리에 적재
- 파일: `proxy/internal/middleware/logging.go:21-35`
- 증거:
  ```go
  if r.Body != nil && (r.Method == "POST" || r.Method == "PUT" || r.Method == "PATCH") {
      bodyBytes, err = io.ReadAll(r.Body)
      ...
      ctx := context.WithValue(r.Context(), model.BodyBytesKey, bodyBytes)
  ```
- 설명: 크기 제한이 없다. 악성/버그 요청이 수 GB 스트리밍 업로드를 보낼 경우 proxy OOM. 또한 `/v1/messages` 외의 모든 POST에도 적용되므로 불필요한 메모리 소모.
- 수정 제안: `http.MaxBytesReader(w, r.Body, N)` 로 상한. 특정 엔드포인트에만 바디 캡쳐 적용 (라우트 group middleware).

### [Medium] [D2] `config.go:Load` 환경변수 오버라이드 코드가 반복적
- 파일: `proxy/internal/config/config.go:138-173`
- 증거:
  ```go
  if envTimeout := os.Getenv("READ_TIMEOUT"); envTimeout != "" {
      cfg.Server.ReadTimeout = getDuration("READ_TIMEOUT", cfg.Server.ReadTimeout)
  }
  ```
  `getDuration`는 내부에서 다시 `os.Getenv`를 호출 → 이중 조회. `if envTimeout :=` 변수는 사용되지 않음.
- 수정 제안: 매핑 테이블(`[]envBinding`) 도입 or `envconfig`/`kelseyhightower/envconfig` 라이브러리 사용.

### [Medium] [D1] `MaxTokens` 캡이 0일 때 요청 body 일관성 깨짐
- 파일: `proxy/internal/provider/openai.go:336-348`
- 설명: `req.MaxTokens`가 0(사용자 미지정)이면 `max_completion_tokens: 0`이 OpenAI로 전송된다. OpenAI는 이를 "0 토큰만 생성"으로 해석하여 빈 응답.
- 수정 제안: `req.MaxTokens == 0` 이면 필드 자체를 제외.

### [Medium] [D2] gzip 해제 후 `Content-Length` 재계산 누락 (anthropic.go)
- 파일: `proxy/internal/provider/anthropic.go:78-91`
- 증거:
  ```go
  if resp.Header.Get("Content-Encoding") == "gzip" {
      resp.Header.Del("Content-Encoding")
      resp.Header.Del("Content-Length")
      gzipReader, err := gzip.NewReader(resp.Body)
      ...
      resp.Body = &gzipResponseBody{...}
  }
  ```
- 설명: `resp.ContentLength`(필드) 는 갱신되지 않음 — 압축된 길이가 그대로 남아 downstream `io.Copy`가 일찍 멈출 위험.
- 수정 제안: `resp.ContentLength = -1` (unknown) 로 명시.

### [Low] [D1] `main.go:24` 기본 logger 가 `log.Lshortfile` 플래그 사용 → 성능/PII 노출 영향은 낮지만 구조화 로깅 권장
- 파일: `proxy/cmd/proxy/main.go:24`
- 수정 제안: `slog`(go 1.21+) 도입. 단 go.mod는 go 1.20이므로 upgrade 필요.

### [Low] [D1] 이모지 포함 로그 메시지 (`❌`, `🚀`, `🎨`)
- 파일: `proxy/cmd/proxy/main.go` 전반
- 수정 제안: CI/로그 aggregator(JSON 라인 등) 환경에서 깨질 수 있음. 구조화 로깅 이행 시 제거.

### [Low] [D2] `responseWriter.WriteHeader` 가 `Hijack`/`Flush`/`Push`를 지원하지 않음
- 파일: `proxy/internal/middleware/logging.go:54-62`
- 설명: 스트리밍(SSE) 응답에서 `http.Flusher` 인터페이스 타입 단언이 실패한다. 현재 핸들러가 어떻게 처리하는지 청크 외 파일이므로 확인 필요.
- 수정 제안: `http.Flusher` 포워딩 래퍼 추가.

### [Low] [D1] go.mod 의 go 버전이 `1.20` — 최신 보안 패치 누락
- 파일: `proxy/go.mod:3`
- 설명: 2026-04-23 기준 1.20은 2024년 2월 EOL.
- 수정 제안: go 1.22+ 권장 (generic `min`/`max` 내장 → openai.go:469 `min` 삭제 가능).

## 긍정적 관찰

- `provider.Provider` 인터페이스(`provider.go:9-15`)가 심플하고 단일 책임. Anthropic/OpenAI 추가 확장에 명확한 확장 포인트.
- `Storage` 추상화(`storage.go:23-36`) 가 청크 외 `storage_sqlite.go`와 분리되어 테스트 대체 쉬움.
- gzip/hop-by-hop 헤더 처리, graceful shutdown(SIGINT/SIGTERM + context timeout), session-index watcher 취소 등 운영 기본기가 잘 반영됨.
- `security.sanitize_headers` 라는 **보안 의식이 있는 옵션**이 config 수준으로 존재. (개선 여지는 위에 서술)

## Cross-cutting 리뷰 시 참고 단서

- **CC-01 인증 플로우**: 프록시는 Authorization/x-api-key를 그대로 upstream으로 forward(`service/anthropic.go:61`), OpenAI는 `Authorization: Bearer p.config.APIKey`로 재작성(`provider/openai.go:83-85`). `sanitize_headers`는 **저장 시 해시만** 적용 — 메모리/포워딩 단계에서는 평문. CC에서 `handler/*` 의 헤더 소비 지점과 대조 필요.
- **CC-02 API 계약**: `/v1/messages`, `/v1/chat/completions`, `/v1/models`, `/health`, `/api/requests`, `/api/sessions`, `/api/projects`, `/api/conversations` 엔드포인트(`main.go:74-89`)를 frontend/remix가 얼마나 일관된 타입으로 소비하는지 교차 확인.
- **CC-03 에러 처리**: `transformOpenAIResponseToAnthropic`의 에러 삼키기(이슈 H-8)는 CC에서 frontend의 에러 렌더링과 맞물림.
- **CC-04 설정/비밀 관리**: `ANTHROPIC_FORWARD_URL`, `ANTHROPIC_VERSION`, `ANTHROPIC_MAX_RETRIES`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `DB_PATH`, `PORT`, `READ_TIMEOUT`, `WRITE_TIMEOUT`, `IDLE_TIMEOUT` — `.env.example`와 대조 필요.
- **Redis/SQLite 위치**: `cfg.Storage.DBPath` 기본 `requests.db` (상대경로) — 실행 디렉토리에 생성됨. CC에서 배포 매니페스트와 대조 필요.
