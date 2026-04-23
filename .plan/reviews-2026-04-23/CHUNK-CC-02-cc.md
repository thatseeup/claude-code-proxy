# CHUNK-CC-02 — Cross-cutting: 에러 처리 및 로깅 일관성

- Executed: 2026-04-23
- Topic: 에러 래핑(%w), 이모지 prefix 규칙, 로그 레벨 태그, 타임스탬프 포맷, 민감정보 로그, BE/FE 에러 응답 정합성, 스트리밍/goroutine 에러 처리, FE 에러 바운더리
- Files:
  - proxy/internal/handler/handlers.go (1,123 LOC)
  - proxy/internal/handler/utils.go (279 LOC)
  - proxy/internal/middleware/logging.go (96 LOC)
  - proxy/internal/provider/anthropic.go (131 LOC)
  - proxy/internal/provider/openai.go (722 LOC)
  - proxy/internal/service/conversation.go (574 LOC)
  - proxy/internal/service/session_index.go (346 LOC)
  - proxy/internal/service/storage_sqlite.go (582 LOC)
  - web/app/entry.server.tsx (140 LOC)
  - web/app/root.tsx (56 LOC)
  - web/app/routes/requests.$sessionId.tsx (760 LOC)
  - web/app/routes/conversations.$projectId.tsx (358 LOC)
- Reviewer: o-web-reviewer (CC-02)

## 1. 정량 지표 대조표

### 1.1 Go 에러 래핑 일관성 (`fmt.Errorf ... %w`)

| 파일 | %w 래핑 | %s(비래핑) | 태그 없는 생성 | 평 |
|---|---|---|---|---|
| provider/anthropic.go | 3 | 1 (L46 "invalid base URL...") | 0 | 일관 |
| provider/openai.go | 7 | 0 | 0 | 일관 |
| service/conversation.go | 9 | 0 | 0 | 일관 |
| service/session_index.go | 0 | 0 | 0 | 에러 반환 지점 없음 (로깅으로 전부 처리) |
| service/storage_sqlite.go | 14 | 1 (L541 "empty timestamp") | 1 (L555 "unrecognized timestamp format") | 일관 (내부 에러는 래핑 불필요) |
| handler/handlers.go | 7 (mergePreservingOrder 내부) | 0 | 0 | 일관 |
| handler/utils.go | 0 | 0 | 0 | 에러 반환 없음 |

전체 `fmt.Errorf` 41건 중 **%w 사용 ≥ 90%**, %s는 근본 원인이 string인 케이스(L46) 또는 leaf 내부 에러(L541). 규약 준수 상태 양호.

### 1.2 이모지 prefix 일관성 (Go 로그)

프로젝트 문서(project-map.md:260)에 규약 명시: 이모지 prefix (🚀 ✅ ❌ 🗿 📡 🎨 🤖).

| 이모지 | 의도된 용도 | 실제 사용 지점 | 준수 |
|---|---|---|---|
| 🚀 | 서버 기동 | main.go:102 | OK |
| ✅ | 성공 완료 | handlers.go:731 "Streaming completed", session_index.go:150 "rebuilt", main.go:140 "Server exited", main.go:47 🗿 SQLite | OK |
| ❌ | 에러 | handlers.go 17 곳, middleware/logging.go:25 | OK |
| 📡 | API 소개 | main.go:103 | OK |
| 🎨 | Web UI | main.go:107 | OK |
| 🤖 | Subagent | model_router.go:142 | OK |
| 🗿 | DB/저장 | main.go:47 | OK |
| ⚠️ / ℹ️ / 👀 / 🛑 | 문서에 미정의 (사실상 관용 확장) | handlers.go:536,759, session_index.go 10곳+, model_router.go:67,132 | **규약 외 확장** |

**불일치 사례:**
- `handlers.go:208` `log.Printf("Error getting requests: %v", err)` — 이모지 prefix 부재
- `handlers.go:354` `log.Printf("Error getting request %s: %v", id, err)` — 이모지 prefix 부재
- `handlers.go:370` `log.Printf("Error clearing requests: %v", err)` — 이모지 prefix 부재
- `handlers.go:472` `log.Printf("Error details: %s", string(errorBytes))` — 이모지 prefix 부재 (L470은 ❌)
- `storage_sqlite.go` — 전부 로깅 없이 에러 반환만 수행 (규약 대상 아님)
- `middleware/logging.go:43` 요청 로그는 ANSI 색상만 사용, 이모지 없음 (별도 포맷 — 의도적)

### 1.3 로그 레벨 태그 혼재

프로젝트 규약: 이모지 기반 (❌=error, ⚠️=warn, ℹ️=info, ✅=ok).
**그러나 코드상 WARN/ERROR 같은 텍스트 태그는 사용되지 않음** — 이모지-only 정책은 대체로 준수되고 있으나 위 §1.2의 "no-prefix" 4건은 레벨 판독이 어려움.

### 1.4 타임스탬프 포맷 일관성

| 위치 | 포맷 | 용도 |
|---|---|---|
| handlers.go:85 (RequestLog.Timestamp) | `time.RFC3339` | wire 포맷 |
| handlers.go:480,666,748 (ResponseLog.CompletedAt) | `time.RFC3339` | wire |
| handlers.go:412,413 (Sessions 응답) | `time.RFC3339` | wire |
| handlers.go:1010,1011,1100 (Conversations 응답) | `time.RFC3339` | wire |
| storage_sqlite.go:539-556 (parseStoredTimestamp) | RFC3339Nano → RFC3339 → "2006-01-02 15:04:05…" | DB 읽기 |
| conversation.go:415-419 | `time.RFC3339` → `time.RFC3339Nano` | jsonl 파싱 — **RFC3339 먼저 시도** |
| handler/utils.go:135,145,169,179 (ConversationChange.Timestamp) | `fmt.Sprintf("%d", time.Now().Unix())` | **Unix 초** |
| handler/utils.go:203 (analyzeTime) | `time.RFC3339` | 메타 |
| middleware/logging.go | `log.LstdFlags` (`2006/01/02 15:04:05`) | 콘솔 |
| session_index.go 기본 로거 | `log.LstdFlags|log.Lshortfile` | 콘솔 |

**불일치**
- `ConversationChange.Timestamp`는 Unix 초 문자열, 동일 구조에서 `analyzeTime`은 RFC3339 — FIXES #32로 이미 식별됨(재지적 생략).
- `conversation.go`의 RFC3339 → RFC3339Nano 순서는 `storage_sqlite.parseStoredTimestamp`의 역순 — FIXES #45로 이미 식별됨.
- 콘솔 로거는 `LstdFlags` 로컬 타임존, wire는 RFC3339 (타임존 포함). 용도 분리는 적절하지만 **모든 콘솔 로그가 로컬 타임존이라 로그 상관관계 분석 시 wire timestamp와 직접 비교 불가**.

### 1.5 민감 정보 로그 누출 교차 확인

| 패턴 | 스캔 결과 | 판정 |
|---|---|---|
| API key / Authorization 원문 Printf | `main.go:60` 안내 로그(값 노출 없음), `grep` 결과 0건의 실제 값 노출 | 안전 |
| 요청 본문 전문 로깅 | `handlers.go:472` 상위 500 chars 덤프 (에러 분기), `handlers.go:760` 500 chars 덤프 (파싱 실패) | **부분 위험 — 본문에 prompt/민감 데이터 포함 가능, 본문은 평문 로그 유출** |
| encoded path (HOME 포함) 로깅 | `session_index.go:119,133,171,180,223,259,291` 전부 full path Printf | **경로 기반 정보 노출 — `/Users/<name>/...` 포함** |
| `decodeProjectPath` encoded path | 로그에는 encoded 상태이나 `~/.claude/projects/<encoded>` 포함 | 동일 |
| 헤더 원본 로깅 | `SanitizeHeaders(sanitize=false)` 경로에서만 — FIXES #4 이미 제기 | 추가 없음 |

**신규 이슈 후보:**
- `handlers.go:760` prompt 평문 500자 덤프 (D4)
- `handlers.go:472` 업스트림 에러 본문 덤프 (D4) — 업스트림이 민감 context 에코하면 유출

### 1.6 BE 에러 응답 vs FE loader 핸들링 정합성

| 엔드포인트 | BE 에러 경로 | FE 소비 (loader) | 정합 |
|---|---|---|---|
| `/api/requests?sessionId=` | 500 + `{error}` (handlers.go:209) | `requests.$sessionId.tsx:66-78` `res.ok=false` 시 `requests=[]`, 에러 상태 미전달 | **불일치 — 500을 빈 배열로 변환, 사용자 알림 없음** (FIXES #97 이미 제기) |
| `/api/conversations/project` | 500 + `{error}` (handlers.go:1117) | `conversations.$projectId.tsx:58-66` 동일 패턴 — `[]` 폴백 | **불일치** (FIXES #97 범위) |
| `/api/sessions` (in conversations loader) | 500 + `{error}` | `conversations.$projectId.tsx:71-79` `[]` 폴백 | **불일치** (FIXES #97 범위) |
| `/api/requests/{id}` (on-demand fetch) | 404/500 | `requests.$sessionId.tsx:467 detailFetcher.load` 결과 미처리 | **추가 — fetcher 에러 시 UI가 이전 detail만 보유, 알림 없음** |

**이미 FIXES #97에 포함되어 교차 확인만 수행. 단, `/api/requests/{id}` 개별 detail 실패 분기는 #97이 명시적으로 다루지 않음 → 신규 이슈로 별도 제기.**

### 1.7 스트리밍 / 동시성 에러 처리

| 지점 | 현재 처리 | 문제 |
|---|---|---|
| `handlers.go:509-658` SSE scanner 루프 | `scanner.Err()` 마지막에 로깅 | 루프 중 Write 실패(클라 끊김) 미탐지 — 지속 처리 |
| `handlers.go:522 fmt.Fprintf(w, ...)` | 반환 에러 무시 | 클라 끊김 시 forward 지속 |
| `openai.go:141-145` goroutine `transformOpenAIStreamToAnthropic` | **반환 에러 없음, panic recover 없음** | goroutine panic 시 서버 프로세스 크래시 가능, `scanner.Err()` 무시 |
| `openai.go:582-722 transformOpenAIStreamToAnthropic` | `scanner.Err()` 호출 없이 루프 종료 | 부분 스트림 중 에러 조용히 소실 |
| `session_index.go:156-206` Watch loop | watcher 에러 `Printf`만, 재시도 없음 | fsnotify 에러 누적 시 이벤트 드롭 (FIXES #51 인접) |
| `session_index.go:175 subdirs, _ := os.ReadDir` | 에러 무시 (`_`) | FIXES #50 이미 제기 |

**신규 이슈:**
- `openai.go` 스트리밍 변환 goroutine의 panic/scanner 에러 미처리 (D1,D4) — 새 이슈
- `handlers.go` SSE forward 루프의 Write 에러 미처리 (D1) — 이미 FIXES #27이 "w.Write 에러 무시"로 폭넓게 포함하나 스트리밍 루프는 반복 호출이라 분리 가치 있음

### 1.8 FE 에러 바운더리 / loader throw 일관성

- `root.tsx` — **`ErrorBoundary` export 없음** → Remix 기본 화면만 표시, 앱 일관 스타일 깨짐
- `entry.server.tsx:82, 132` — `onError`에서 `console.error(error)`만, 스택 트레이스/상관ID/Sentry 없음 (FIXES #108/#97 맥락과 인접)
- `requests.$sessionId.tsx`, `conversations.$projectId.tsx` — loader 모두 try/catch로 200+빈 배열 반환, **`throw new Response(..., { status: 500 })` 미사용** → ErrorBoundary 트리거 불가
- `conversations.$projectId.tsx:82 Promise.all` 에서 한쪽 실패도 다른 한쪽 빈 배열로 이어짐 — 내부 try/catch가 catch-all 역할

**신규 이슈:**
- `root.tsx`에 전역 `ErrorBoundary`/`CatchBoundary` 부재 (D1)

## 2. 기존 FIXES 교차 확인 (재append 지양)

| 기존 # | 재확인 결과 | 비고 |
|---|---|---|
| #27 w.Write/Encode 에러 무시 | 재현 — handlers.go:167,251,363,489,522,777,782,910 + 스트리밍 루프 L522 추가 지점 | 기존 범위에 스트리밍 루프 포함시켜 확장(별도 이슈로 분리 ↓) |
| #32 ConversationChange.Timestamp Unix | 재현 | 재append 하지 않음 |
| #36 Scan/Unmarshal `continue` 에러 카운팅 없음 | 재현 (storage_sqlite 3곳) | 재append 하지 않음 |
| #45 RFC3339 vs RFC3339Nano 순서 | 재현 (conversation.go:415) | 재append 하지 않음 |
| #50 ReadDir 에러 `_` 무시 (session_index.go:175) | 재현 | 재append 하지 않음 |
| #51 fsnotify 실패 후 polling 고착 | 재현 | 재append 하지 않음 |
| #52 timestamp 포맷 이중 관리 | 재현 (storage_sqlite:539-556 vs conversation:415-419) | 재append 하지 않음 |
| #97 FE loader 200+빈 배열 | 재현 | 재append 하지 않음 |
| #108 theme catch(e){} 침묵 | 재현 (root.tsx:30-32) | 재append 하지 않음 |
| #4 sanitize_headers 평문 | 관련 확인만 | 재append 하지 않음 |

## 3. 신규 발견 이슈

### [High] [D1,D4] openai.go 스트리밍 변환 goroutine — panic recover / scanner 에러 처리 부재
- 파일: `proxy/internal/provider/openai.go:141-145, 582-722`
- 증거:
  ```go
  // openai.go:141
  go func() {
      defer pw.Close()
      defer bodyReader.Close()
      transformOpenAIStreamToAnthropic(bodyReader, pw)   // panic 시 서버 프로세스 다운
  }()
  ```
  ```go
  // openai.go:589-721 scanner 루프 — scanner.Err() 호출 없음
  for scanner.Scan() { ... }   // Scan 실패 사유 소실
  ```
- 설명: upstream 스트림 파싱 중 발생한 오류/패닉이 pipe writer만 닫고 소실. 클라이언트는 중도 절단된 Anthropic 스트림을 받아 UI에서 잘린 응답 표시. 로그에도 흔적 없음.
- 수정 제안: `defer func(){ if r:=recover(); r!=nil { log.Printf("❌ openai stream transform panic: %v", r); pw.CloseWithError(fmt.Errorf("panic: %v", r)); } }()` + 루프 후 `if err:=scanner.Err(); err!=nil { log.Printf("❌ openai stream scan: %v", err) }`.

### [High] [D4] handlers.go 본문 덤프로 prompt 평문 유출 위험
- 파일: `proxy/internal/handler/handlers.go:472, 760`
- 증거:
  ```go
  // L470-472 (스트리밍 비정상 경로)
  log.Printf("❌ Anthropic API error: %d", resp.StatusCode)
  errorBytes, _ := io.ReadAll(resp.Body)
  log.Printf("Error details: %s", string(errorBytes))
  ```
  ```go
  // L759-760 (비스트리밍 파싱 실패 경로)
  log.Printf("⚠️ Failed to parse Anthropic response: %v", err)
  log.Printf("📄 Response body (first 500 chars): %s", string(responseBytes[:min(500, len(responseBytes))]))
  ```
- 설명: 업스트림 에러 본문/응답 본문에는 프롬프트 에코, 사용자 텍스트, 툴 argument가 포함될 수 있어 평문 로그 저장 위험. Authorization 헤더는 sanitize하면서 본문은 무방비.
- 수정 제안: 에러 응답은 `status + len(body)` + `redactedPreview(body, 120)` (JSON 구조만 남기고 text 필드는 `<REDACTED N chars>`) 형태 유틸 도입, 또는 debug 빌드에서만 전체 덤프.

### [High] [D1,D2] BE 에러 응답 포맷 3종 혼재 — 엔드포인트마다 JSON / plain text / 이모지 혼재
- 파일: `proxy/internal/handler/handlers.go:59, 162, 209, 349, 355, 359, 384, 442, 1058, 1064, 1071, 1111` + `writeErrorResponse` 사용처
- 증거:
  ```go
  // L59 plain text
  http.Error(w, "Error reading request body", http.StatusBadRequest)
  // L209 plain text
  http.Error(w, "Failed to get requests", http.StatusInternalServerError)
  // L67,210,124,… JSON
  writeErrorResponse(w, "...", http.StatusInternalServerError)
  // L162 plain
  http.Error(w, "UI not available", http.StatusNotFound)
  ```
- 설명: 동일 Handler 파일이 `http.Error`(text/plain)와 `writeErrorResponse`(JSON `{error}`)을 혼용. FE는 `res.json()`을 시도하므로 plain 400/404/500 시 파싱 실패하여 loader 에러 구분 불가(§1.6의 근본 원인 중 하나). `/api/requests/{id}` 같은 JSON API에도 `http.Error` 적용되어 FE가 에러 구조 파싱 못함.
- 수정 제안: 모든 `/api/*` 경로는 `writeErrorResponse({code, message, requestId?})`로 통일, UI HTML 엔드포인트만 `http.Error` 허용. 미들웨어 레벨에서 `Accept: application/json` 체크 후 자동 변환.

### [Medium] [D1] handlers.go 4곳 이모지 prefix 누락 — 규약 불일치
- 파일: `proxy/internal/handler/handlers.go:208, 354, 370, 472`
- 증거:
  ```go
  log.Printf("Error getting requests: %v", err)              // L208
  log.Printf("Error getting request %s: %v", id, err)        // L354
  log.Printf("Error clearing requests: %v", err)             // L370
  log.Printf("Error details: %s", string(errorBytes))        // L472
  ```
- 설명: project-map.md:260 규약은 "상위에서 `log.Printf("❌ ...")`" 명시. 위 4건은 ❌ 누락으로 `grep -r '❌'`로 에러 감지하는 운영 모니터링이 이 라인을 놓침.
- 수정 제안: 위 라인 전부 `❌ ` prefix 추가. 추가로 `⚠️` `ℹ️` `👀` `🛑`도 실제 사용되므로 project-map.md의 이모지 규약 섹션에 보강 서술.

### [Medium] [D1] FE loader 에러 로깅이 console.error에 갇혀 있음 — 서버/브라우저 구분 무
- 파일:
  - `web/app/routes/requests.$sessionId.tsx:77`
  - `web/app/routes/conversations.$projectId.tsx:64, 77`
  - `web/app/routes/requests.tsx:32`
  - `web/app/routes/conversations.tsx:26`
  - `web/app/routes/api.*.tsx` 7곳
- 증거:
  ```ts
  try { const res = await fetch(backendUrl.toString()); ... }
  catch (err) { console.error("Failed to load session requests:", err); }
  ```
- 설명: SSR 시 `console.error`는 Remix 서버 프로세스 stdout에만 나가고 구조화 로그(레벨/코리레이션) 없음. BE는 이모지 prefix 규약이 있으나 FE에는 규약 자체가 없음. 실패 주체(backend down / JSON parse fail / timeout) 구분 불가.
- 수정 제안: `web/app/lib/logger.ts`(서버 전용 guarded)에 `log.error({event, err, context})` JSON 라인 로거 도입. loader/api.* 전부 교체. 클라이언트는 `if (typeof window === 'undefined')` 가드로 서버에서만 로깅.

### [Medium] [D1] `root.tsx` 전역 ErrorBoundary 미구현 — 렌더링 에러 시 Remix 기본 화면
- 파일: `web/app/root.tsx` (56 LOC, ErrorBoundary export 없음)
- 증거: 파일 전체에 `ErrorBoundary`/`CatchBoundary` export 없음. `Layout`/`App`만 존재.
- 설명: loader/action이 `throw new Response(...)` 할 경우 Remix는 ErrorBoundary로 위임, 없으면 라이브러리 기본 HTML 출력. 다크 테마 초기화 스크립트와 Tailwind 폰트가 적용되지 않은 상태로 노출 (UX 비일관 + 브랜드 불일치). §1.8과 연결.
- 수정 제안: `export function ErrorBoundary() { const err = useRouteError(); ... }` 추가, `isRouteErrorResponse` 분기로 4xx/5xx 화면 분리. 아울러 개별 라우트 loader에서 `throw json({error, detail}, { status: 502 })` 패턴 도입 (§1.6).

### [Medium] [D1] SSE forward 루프 Write 에러 / Flusher 단언 실패 미처리
- 파일: `proxy/internal/handler/handlers.go:522-525`
- 증거:
  ```go
  fmt.Fprintf(w, "%s\n", line)
  if f, ok := w.(http.Flusher); ok {
      f.Flush()                        // 클라 끊김 시 오류 로깅 없음
  }
  // Fprintf 반환 에러 무시 — 클라 disconnect 판별 경로 전무
  ```
- 설명: 클라이언트가 스트리밍 도중 끊어도 서버는 계속 업스트림을 pull + write. `r.Context().Done()` 감시 부재로 goroutine 자원 낭비. FIXES #27이 "w.Write 에러 무시"를 일반 포괄하나 이 지점은 반복 호출이라 패치 전략이 다름(루프 중단 + 업스트림 cancel 필요).
- 수정 제안: `select { case <-r.Context().Done(): return ... default: }` 루프 내 가드 + `if _, err := fmt.Fprintf(w, ...); err != nil { log.Printf("❌ SSE write: %v", err); return }`.

### [Medium] [D1] `detailFetcher.load` 실패 처리 부재 — 개별 request detail 에러 UI 무표시
- 파일: `web/app/routes/requests.$sessionId.tsx:462-479`
- 증거:
  ```ts
  const detailFetcher = useFetcher<RequestLog>();
  ...
  useEffect(() => {
    if (!targetRid) return;
    detailFetcher.load(`/api/requests/${encodeURIComponent(targetRid)}`);
  }, [targetRid]);
  ...
  const detail = detailFetcher.data;
  const selected = detail ?? summarySelected;
  ```
- 설명: 404/500 시 `detailFetcher.data`는 undefined 유지 → UI가 summary 캐시만 표시(사용자가 잘못된 요약을 "최신"으로 오인). `detailFetcher.state === 'idle' && !detailFetcher.data` 분기가 없어 에러/로딩 구분 불가. FIXES #97의 범위가 loader 실패에 집중돼 있어 이 fetcher 분기는 별도 추적 필요.
- 수정 제안: `if (detailFetcher.state === 'idle' && targetRid && !detailFetcher.data) { show banner }` 또는 `/api/requests/{id}`가 404/500 시 `{error}` JSON 반환하도록 BE 교정 후 클라이언트 toast.

## 4. 긍정적 관찰

- **에러 래핑 `%w` 규율 우수**: 전체 41개 `fmt.Errorf` 중 90% 이상이 `%w`로 cause 보존. Go 표준을 잘 따름.
- **이모지 prefix 사용 일관성**: 중요 이벤트(start/stop/rebuilt/error)는 규약 준수. `⚠️`/`ℹ️`는 미문서화지만 의미론이 명확.
- **BE 타임스탬프 wire 포맷 단일화**: 모든 응답이 RFC3339 문자열 — FE가 `new Date(iso)`로 통일 소비.
- **handlers.go `writeErrorResponse`는 JSON `{error}` 포맷 고정** — 단, `http.Error`와 혼재하는 점이 문제.
- **session_index 로깅이 incident별 구조화** (rebuilt/watcher.Add 실패/polling 전환) — 운영 가시성 좋음.

## 5. 다음 CC 단계 힌트

- CC-03(만약 실행 예정): "요청 수명 주기 correlation" — `requestID`(handlers.go:886)가 로그에 거의 등장하지 않음. `middleware/logging.go`에 requestID 주입 + 모든 `log.Printf`에 포함시키는 관측성 리팩토링을 별도 주제로 검토.
- 본 CC와 CC-01(#157-164) 결합: "API 계약 일관성" + "에러 응답 포맷 일관성" 을 합친 contract 레이어 도입(OpenAPI + zod)이 long-term 타당.
