# CHUNK-FINAL — 전체 리뷰 통합 요약

- Executed: 2026-04-23
- Scope: 전체 리포 (proxy/ Go 서비스 + web/ Remix UI + 빌드/배포 설정)
- Review dir: `.plan/reviews-2026-04-23/`
- Mode: FINAL (REVIEW 9 + CC 4 통합)
- Reviewer: o-web-reviewer subagent (FINAL mode)

---

## 1. 총괄 통계

### 1.1 청크 규모

| 구분 | 청크 수 | 검토 파일 수(대략) | 검토 LOC(대략) |
|---|---|---|---|
| REVIEW (영역) | 9 | 72 | 약 12,800 |
| CC (횡단) | 4 | 14 (고유) | 약 8,100 (중복 read 포함) |
| **합계** | **13** | **72 고유** | **—** |

- REVIEW 청크: BE-01, BE-02, BE-03, FE-01, FE-02, FE-03, SH-01, CF-01, TS-01
- CC 청크: CC-01 (API 계약), CC-02 (에러/로깅), CC-03 (설정/비밀), CC-04 (세션/프로젝트 데이터 흐름)
- 모든 청크 `status=completed`, 샘플링 없음(전량 판독)

### 1.2 이슈 심각도별 통계 (STATUS.md 기준)

| 출처 | Critical | High | Medium | Low | 합계 |
|---|---|---|---|---|---|
| REVIEW 청크 9개 | 11 | 64 | 81 | 30 | 186 |
| CC 청크 4개 | 2 | 14 | 20 | 3 | 39 |
| **전체** | **13** | **78** | **101** | **33** | **225** |

### 1.3 차원별 분포 (REVIEW 청크 기준 — 복수 차원 태그는 각각 카운트)

| 차원 | 히트 | 비중 |
|---|---|---|
| D1 초중급 실수 | 92 | 40% |
| D2 유지보수성 | 65 | 28% |
| D3 결합도/응집도 | 16 | 7% |
| D4 보안 | 34 | 15% |

### 1.4 FIXES.md 누적 행 수

- **총 189행** (Critical/High/Medium만 append, Low는 제외)
- REVIEW 156행 + CC 33행 (CC에서 중복 이슈는 "재등록 생략" 규칙 적용 — 실제 교차 확인된 건수 약 27건은 기존 REVIEW 항목에 귀속)

---

## 2. Top Critical 이슈 (즉시 조치 — 13건)

> 파일:라인 · 출처 리포트 · FIXES 행번호(있는 경우)

### 보안/운영 크리티컬

1. **[D4] CORS `*` 와일드카드** — `proxy/cmd/proxy/main.go:66-70` — `CHUNK-BE-01` — FIXES #1
   - 모든 Origin 허용 + 민감 데이터 API(`/api/requests`, `/api/sessions`) 노출로 브라우저 탭 세션 하이재킹 가능. DELETE 엔드포인트들과 결합 시 심각도 증폭.

2. **[D1,D4] `loadFromFile` 에러 완전 무시** — `proxy/internal/config/config.go:135` — `CHUNK-BE-01` — FIXES #2
   - `config.yaml` 파싱/권한 오류가 로그 없이 버려져, 운영자가 설정 반영됐다고 오해한 채 기본값으로 기동.

3. **[D4] 전체 요청 로그 삭제(DELETE `/api/requests`)에 CSRF/인증 부재** — `web/app/routes/api.requests.tsx:39-60` + `proxy/internal/handler/handlers.go:366-381` — `CHUNK-FE-03` / `CHUNK-CC-01` — FIXES #98
   - CORS `*`와 결합 시 외부 사이트의 무인증 fetch 한 번으로 전체 로그 소실. `/api/sessions/unknown` 대량 삭제도 동일 표면.

4. **[D4] `rand.Read` 에러 무시 → 예측 가능한 RequestID** — `proxy/internal/handler/handlers.go:886-890` — `CHUNK-BE-02` — FIXES #18
   - `crypto/rand` 실패 시 모든 요청 ID가 `0000000000000000`으로 충돌, 로그 추적·보안 엔트로피 모두 붕괴.

5. **[D4] `GetRequestByShortID` LIKE suffix 매칭 + 메타문자 미이스케이프** — `proxy/internal/service/storage_sqlite.go:239-270` — `CHUNK-BE-03` — FIXES #35
   - `%`/`_` 미이스케이프 + "끝 일치" 쿼리로 짧은 shortID 입력 시 타 세션 데이터 열람 가능.

6. **[D1,D4] ENV 이름 불일치 `DATABASE_PATH` vs `DB_PATH`** — `.env.example:16` vs `Dockerfile:76` vs `config.go:171` — `CHUNK-CF-01` / `CHUNK-CC-03` — FIXES #172
   - 사용자가 `.env`에 지정한 DB 경로가 조용히 무시되고 기본값으로 fallback → 데이터 위치 배신.

7. **[D4] `docker-entrypoint.sh` 환경변수 기본값 가드 부재** — `docker-entrypoint.sh:6,31-39` — `CHUNK-CF-01` — FIXES #119
   - `READ_TIMEOUT`이 비어 있으면 `READ_TIMEOUT=s` 같은 malformed 값 전달, `ANTHROPIC_FORWARD_URL` 비어 있으면 모든 업스트림 실패.

### FE XSS/코드 품질 크리티컬

8. **[D4] `formatLargeText` regex 기반 HTML 재주입 경로** — `web/app/utils/formatters.ts:61-96` (소비처: `MessageContent.tsx` 6곳 + `MessageFlow.tsx:222` + `CodeViewer.tsx:208`) — `CHUNK-FE-01` / `CHUNK-SH-01` — FIXES #54, #132
   - 현재는 `escapeHtml` 선행 적용으로 동작하지만, 14단계 regex pipeline에 테스트가 없어 회귀 시 즉시 저장형 XSS. DOMPurify 도입 또는 `react-markdown`+`rehype-sanitize` 전환 필요.

9. **[D2] `RequestDetailContent.tsx` 1,301 LOC + 13 컴포넌트 동거** — `web/app/components/RequestDetailContent.tsx` — `CHUNK-FE-02` — FIXES #74
   - 파일/함수/중첩 3개 임계값 모두 극단적 초과. 유지보수·리뷰 거의 불가.

10. **[D1] `any` 타입 전반 소실 (Anthropic content block union)** — `RequestDetailContent.tsx:37/60/442/484/930/953` + `MessageContent.tsx:11/20` + `MessageFlow.tsx:8` 등 — `CHUNK-FE-02` / `CHUNK-FE-01` — FIXES #75
   - `content/body/response/tool/schema` 등 핵심 도메인이 `any`로 소실되어 IDE·AI 추론 불가. 공용 `web/app/types/anthropic.ts` 도입이 최선결.

### FE 보안 크리티컬

11. **[D4] 서버사이드 `fetch("http://localhost:3001/...")` 13곳 하드코딩** — `web/app/routes/api.*.tsx` + page loaders — `CHUNK-FE-03` / `CHUNK-CC-01` — FIXES #93
    - ENV 기반 주입 없어 Docker/프로덕션 환경 변경 시 전역 치환 필요. `backendFetch` 헬퍼 미도입.

### BE 크리티컬 (CC 발견)

12. **[D4,D1] `/api/grade-prompt` FE-only orphan** — `web/app/routes/api.grade-prompt.tsx:13` (BE 미등록) — `CHUNK-FE-03` / `CHUNK-CC-01` — FIXES #99
    - FE 프록시는 존재하나 BE 라우트 없음 + 호출부도 dead(`onGrade={() => {}}`). 같은 PR에서 세 경로 모두 삭제 필요.

13. **[D4] `storage_sqlite.go::createTables` idempotent ALTER ADD COLUMN 부재** — `proxy/internal/service/storage_sqlite.go:39-67` — `CHUNK-BE-03` — FIXES #37
    - 기존 DB에 `session_id` 컬럼이 없는 설치본에서 `CREATE TABLE IF NOT EXISTS`가 no-op → 이후 INSERT/SELECT가 `no such column` 실패.

---

## 3. Top High 이슈 (단기 조치 — 78건 중 대표 20건)

> 파일별로 집계. 자세한 내용은 각 청크 리포트 참조.

### BE (proxy)

- **`provider/openai.go` 722 LOC · 단일 함수 292 LOC · 중첩 7단계** (BE-01, FIXES #3) — `convertAnthropicToOpenAI` 다중 임계값 초과.
- **`service/anthropic.go` vs `provider/anthropic.go` 중복 포워딩 로직** (BE-01, FIXES #5) — 보안 패치가 한쪽에 누락될 위험.
- **포워딩 URL TLS 검증 부재** (BE-01, FIXES #7) — `ANTHROPIC_FORWARD_URL=http://`를 허용해 Authorization 평문 전송 가능.
- **`sanitize_headers=false`에 대한 강경 가드 부재** (BE-01, FIXES #4) — 경고 로그만 출력, 옵션 토글이 영구적.
- **`transformOpenAIResponseToAnthropic` 에러 삼킴** (BE-01, FIXES #10) — Unmarshal 실패 시 OpenAI JSON이 Anthropic 스키마로 위장되어 클라이언트에 전달.
- **`openai.go` 스트리밍 변환 goroutine panic/scanner 에러 미처리** (CC-02) — FIXES 신규 항목 필요 (리포트에 기재, FIXES append 누락 검토).
- **`handlers.go` 1,123 LOC · 7개 도메인 혼재** (BE-02, FIXES #19) — 파일 임계값 3.7배 초과.
- **`handleStreamingResponse` 271 LOC · 중첩 5단** (BE-02, FIXES #20) — SSE 이벤트 라우팅·usage 누적·merge가 단일 함수.
- **`storage_sqlite.go` 4개 리스트 함수 ≈280 LOC 중복** (BE-03, FIXES #33) — SELECT/Scan/Unmarshal 4회 복붙.
- **Scan/Unmarshal 에러 조용한 `continue` — 데이터 손실 은폐** (BE-03, FIXES #34).
- **`NewSQLiteStorageService` 경로 traversal 가드 + 파일 권한 미설정** (BE-03, FIXES #41).

### FE (web)

- **`requests.$sessionId.tsx` 760 LOC · JSX 8단 중첩** (FE-03, FIXES #94).
- **`SessionPicker.tsx` 411 LOC + DELETE 직접 fetch(CSRF/confirm 없음)** (FE-02, FIXES #80, #81).
- **`SessionPicker.groupSessionsByProject.latestTimestamp` 초기값 `""` 버그** (FE-02, FIXES #82) — `new Date("")`로 정렬 불안정.
- **`ThemeToggle` FOUC: SSR에서 light 강제 → useEffect 교체** (FE-02, FIXES #83).
- **`root.tsx` 전역 ErrorBoundary 부재** (CC-02, FIXES #170).
- **`CodeViewer.highlightCode` regex 기반 구문강조 — 토큰 경계 오인 시 태그 깨짐** (FE-01, FIXES #55).
- **`key={index}` 안티패턴 다수** (FE-01 4곳, FE-02 3곳, FE-03) — `ToolCard`/`MessageContent`가 local state 보유하므로 삽입·필터 시 state 이월.
- **`isOpenAIModel`의 `startsWith('o')` 과잉 매칭** (SH-01, FIXES #136) — `ollama/*`, `opus-*` 전부 OpenAI로 오분류.

### BE/FE 계약 (CC)

- **리스트/삭제 응답 envelope 일관성 없음** (CC-01) — `{items, total}` 2개 vs bare array 3개 vs DELETE 포맷 제각각. FIXES 신규 항목.
- **동일 엔드포인트를 api.* 프록시 / 직접 호출 혼용** (CC-01) — 아키텍처 원칙 미정.
- **"unknown" 토큰 4곳 리터럴 중복** (CC-01, FIXES #160).
- **BE 에러 응답 3종 혼재(`http.Error` plain vs `writeErrorResponse` JSON)** (CC-02) — FE가 에러 구조 파싱 불가.
- **`X-Claude-Code-Session-Id` 헤더 미검증 저장** (CC-04, FIXES #182) — 제어문자·거대 페이로드가 DB 경유 UI로 전파 가능.

### CF (빌드/배포)

- **Dockerfile node_modules 대량 복사 + `web/.env*` 미제외** (CF-01, FIXES #120).
- **HEALTHCHECK가 proxy만 확인 (web 감시 없음)** (CF-01, FIXES #122).
- **`run.sh` cleanup exit code 소실** (CF-01, FIXES #123) — CI 체인에서 실패 감지 실패.
- **`vite.config.ts` proxy target 하드코딩** (CF-01, FIXES #124).
- **`.env.example` vs Dockerfile vs config.yaml.example 타임아웃 값·단위 3종 불일치** (CF-01, FIXES #126 / CC-03 FIXES #175).
- **`SUBAGENT_MAPPINGS` ENV는 문서에만 존재 — 구현 없음** (CC-03, FIXES #174).
- **`.env` 탐색 경로가 바이너리 기준 `..` 상대경로로 설계** (CC-03, FIXES #176).

### TS (단위 테스트)

- **`TestModelRouter_EdgeCases`가 `expectedRoute`/`expectedModel` 비교 누락 — 무효 테스트** (TS-01, FIXES #140).
- **`strings.Contains` 재귀 재구현(dead-code like)** (TS-01, FIXES #141).
- **Watch 테스트 4곳 goroutine leak + 에러 은폐** (TS-01, FIXES #142).
- **fsnotify happy-path 커버리지 0 (polling fallback만 테스트)** (TS-01, FIXES #143).

---

## 4. 파일별 Hotspot (정량 근거)

> 파일 LOC, 최대 함수 LOC, 관련 이슈 수(C/H/M 기준)

| 순위 | 파일 | LOC | 최대 함수 LOC | 중첩 | 이슈 수 (C/H/M) | 주 이슈 유형 |
|---|---|---|---|---|---|---|
| 1 | `web/app/components/RequestDetailContent.tsx` | **1,301** | 397 | 10+ | 2/2/3 | 파일 과대, any 남용, 중복 dead prop |
| 2 | `proxy/internal/handler/handlers.go` | **1,123** | 271 | 5 | 1/6/7 | 도메인 혼재, 이모지 누락, 에러 포맷 혼재 |
| 3 | `web/app/routes/requests.$sessionId.tsx` | **760** | ~320 | 8 | 0/4/3 | 파일 과대, any, pagination 누락 |
| 4 | `proxy/internal/provider/openai.go` | **722** | 292 | 7 | 0/5/3 | 거대 변환 함수, goroutine panic 미처리 |
| 5 | `proxy/internal/service/storage_sqlite.go` | **582** | 91 | 3 | 1/4/3 | 리스트 4중 복붙, ALTER 누락, 경로 traversal |
| 6 | `proxy/internal/service/conversation.go` | **574** | 148 | 5 | 0/1/4 | parseConversationFile 다중 책임 |
| 7 | `web/app/components/SessionPicker.tsx` | **411** | ~205 | 8 | 0/4/3 | DELETE 직접 fetch, FOUC, timestamp 버그 |
| 8 | `web/app/components/MessageContent.tsx` | **399** | 100 | 7 | 0/2/1 | dangerouslySetInnerHTML 6회 |
| 9 | `web/app/routes/conversations.$projectId.tsx` | **358** | ~160 | 7 | 0/2/3 | 키보드 핸들러 중복, loader 중복 |
| 10 | `proxy/internal/service/session_index.go` | **346** | 60 | 4 | 0/0/4 | Watch 복구 고착, ReadDir 에러 무시 |
| 11 | `proxy/internal/handler/utils.go` | **279** | 115 | 4 | 0/2/4 | 두 도메인 혼재, Unix epoch 포맷 |
| 12 | `proxy/internal/config/config.go` | **260** | 130 | 3 | 2/0/2 | loadFromFile 에러 무시, ENV 이중조회 |
| 13 | `web/app/utils/formatters.ts` | 232 | 36 | 3 | 1/3/4 | formatLargeText regex + any + 테스트 0 |
| 14 | `proxy/internal/service/model_router.go` | 232 | 63 | 4 | 0/1/3 | HOME 경로 오염, 테스트 없음 |

**즉시 분해 필요**: 상위 6개 파일이 전체 Critical/High 이슈의 약 **55%** 를 생성.

---

## 5. 리팩토링 우선순위 (1~N)

심각도, 이슈 밀도, 상호 의존성을 종합한 권장 순서.

| 순위 | 대상 | 근거 (정량) | 조치 제안 | 선행 이슈 |
|---|---|---|---|---|
| 1 | **설정/ENV 일관화** (`.env.example`, `Dockerfile`, `docker-entrypoint.sh`, `config.go`) | Critical 3건(#2, #119, #172), High 5건(#173-176, #180) + CC-03 분석. 모든 배포 경로의 뿌리. | `DB_PATH` 단일화, ENV 기본값 가드(`: "${VAR:=...}"`), `time.ParseDuration` 단위 명시, `godotenv.Load` 에러 로깅 | — |
| 2 | **보안 기본값 강화** (CORS, CSRF, TLS 검증, rand.Read) | Critical 4건(#1, #18, #35, #98). 최소 변경으로 공격 표면 대폭 축소. | CORS allow-list, CSRF/Origin 검증, upstream URL `https:` 강제, `rand.Read` 에러 처리 | 1 |
| 3 | **공용 `backendFetch` 헬퍼 + API 계약 스펙** (FE) | FIXES #93(13곳 하드코딩), #94-102, CC-01 envelope 혼재 | `web/app/config/backend.ts` + `backendFetch(path, init)`, OpenAPI 또는 `shared/types/session.ts` 최소 공유 | 1 |
| 4 | **공용 `types/anthropic.ts` + `any` 제거** (FE) | FIXES #75, #62, #77, #96, #131 등 13건. AI/IDE 친화성 근본. | `ContentBlock` discriminated union + `RequestLog`/`AnthropicRequestBody` 공유 타입 | 3 |
| 5 | **`RequestDetailContent.tsx` 분해** (FE) | 1,301 LOC, 13 컴포넌트, Critical 2건 | `components/RequestDetail/` 디렉토리, 8개 파일로 분할 (ResponseDetails, OverviewTable, ToolCard, SchemaBlock, CollapsibleJSON, sse/headers utils) | 4 |
| 6 | **`handlers.go` 분해 + 에러 포맷 통일** (BE) | 1,123 LOC + `http.Error`/`writeErrorResponse` 혼재 | `handlers_messages/requests/sessions/conversations/misc.go` + 모든 `/api/*` JSON 통일 | 2 |
| 7 | **`provider/openai.go` 분해 + legacy anthropic service 제거** (BE) | 722 LOC, 중첩 7, 중복 포워딩 | `openai_convert/stream/response.go` 분할, `service/anthropic.go` 삭제 또는 thin wrapper | 2 |
| 8 | **`storage_sqlite.go` `scanRequestRow` 헬퍼 + 쿼리 빌더** (BE) | 4개 리스트 함수 280 LOC 중복, Scan 에러 `continue` | 헬퍼 추출 + 로거 주입 + idempotent ALTER 마이그레이션 도입 | 2 |
| 9 | **`SessionPicker`/`ProjectPicker` 통합 dropdown 컴포넌트** (FE) | 두 파일 JSX 구조 80% 중복, DELETE 직접 fetch | `DropdownButton`/`DropdownList`, `useFetcher` 전환, 삭제 confirm UI | 3, 4 |
| 10 | **`formatLargeText` → DOMPurify 또는 `react-markdown`** (FE) | Critical #54, High #132, `dangerouslySetInnerHTML` 10곳 | `sanitize()` 최종 적용 또는 regex pipeline 전면 교체 + 단위 테스트 고정 | — |
| 11 | **공용 훅/유틸 추출** (FE) | 키보드 nav 중복(2 파일 69 LOC), 미리보기 함수 중복 | `hooks/useListKeyboardNav.ts`, `utils/message-preview.ts`, `utils/sse.ts` | 3 |
| 12 | **SessionIndex fsnotify 커버리지 + Watch 테스트 위생** (BE) | TS-01 High 4건, CC-04 stale session 이슈 | fsnotify happy-path 테스트, Watch done 채널 패턴 공용화, ReadDir 에러 로깅 | 2 |
| 13 | **로그 규약 + 구조화 로깅 도입** (BE + FE) | CC-02 이모지 prefix 누락 4건, `console.error` 서버/브라우저 미구분 | `slog` 도입(go 1.21+) + FE `lib/logger.ts` (서버 가드) | 6 |
| 14 | **Unit test 인프라 도입** (FE) | SH-01 테스트 0, CF-01 `package.json` `test` 스크립트 없음 | `vitest` + `formatters.spec.ts`·`models.spec.ts`·`systemReminder.spec.ts` | 10 |
| 15 | **CI/Dockerfile 보안 강화** (CF) | 이미지 태그 floating, HEALTHCHECK proxy-only, `apk add` 버전 미고정 | SHA 디제스트 고정, 다중 healthcheck, `wait -n` / `tini` 도입 | 1 |

---

## 6. AI 분석 친화성 개선 제안

1. **타입 시그니처 복구**: FE `any` 약 30건, BE `interface{}` 반환 1건(`summarizeRequestBody`). 공용 타입 모듈(`shared/types/`) 도입이 핵심. → 우선순위 4.
2. **과대 파일 분해**: 300 LOC 초과 13개 파일 중 상위 6개 파일 분해 시 이슈 밀도 50% 이상 감소. → 우선순위 5, 6, 7.
3. **명명·디렉토리 구조**: `sessionId`/`sid`/`sessionIdToken`/`rid` 4-way 혼용, `UNKNOWN_TOKEN`/`UNKNOWN_PROJECT` case 불일치. project-map.md 갱신 권장.
4. **파일명 ↔ export 일치**: 대체로 OK(`SessionPicker.tsx` → `SessionPicker`). 단 `handlers.go`/`utils.go`/`formatters.ts`가 포괄형 → 주제별 분할 필요.
5. **OpenAPI/타입 계약**: BE/FE 응답 shape가 파일별로 정의 중복. 단일 소스 스펙 도입 시 회귀 감지 자동화.
6. **로깅 규약 문서화**: 이모지 prefix 7종이 실제로는 11종 쓰이고 있음. project-map.md 보강 + 누락된 `log.Printf("❌ ...")` 4곳 패치.

---

## 7. 긍정적 관찰 (프로젝트가 이미 잘 하고 있는 것)

- **에러 래핑 `%w` 규율**: Go 전체 `fmt.Errorf` 41건 중 90% 이상이 cause 보존.
- **Storage/SessionIndex/Provider 인터페이스 분리**: 테스트 대체 용이, 플랫폼 이식성 고려(fsnotify + polling 이원화).
- **`t.Helper()`/`t.TempDir()` 일관 사용**: 테스트 파일 청결도 높음.
- **SSR-safe 날짜 포맷 `formatStableDateTime`**: hydration mismatch 회피 의도 명시.
- **Remix future flags 전부 활성**: v3 단일 fetch/lazy route discovery 선제 채택.
- **Non-root Docker 사용자 (uid 1001)**: 최소권한 원칙 준수.
- **`SanitizeHeaders`가 안전 기본값(true) + 비활성 시 startup 경고**.
- **Remix loader 최적화**: `shouldRevalidate`, `summary=true` + `useFetcher` lazy detail 로드 — 규모 대응 설계.
- **`mergePreservingOrder` 및 SSE 프레이밍 결정**: 장문 주석으로 의사결정 남겨져 있어 AI/신규 기여자 온보딩에 유용.
- **`.gitignore`/`.dockerignore`**: `.env*`, `.claude/`, `config.yaml`, 대용량 `*.db` 차단 — 비밀 유출 1차 방어 우수.

---

## 8. 남은 위험 및 후속 권고

### 8.1 본 리뷰에서 커버하지 못한 영역

- **통합(integration)/E2E 테스트 전무**: 본 리뷰는 정적 분석 기반. 스트리밍 실제 동작, multi-provider 전환, fsnotify race 등은 실행 검증 필요.
- **성능·부하 프로파일링**: SQLite WAL 미설정, logging middleware가 전 body를 메모리 적재(FIXES #14) — 실측 부하 테스트 권장.
- **접근성(a11y)**: `RequestDetailContent`의 복잡 JSX, `HorizontalSplit`만 키보드 지원 확인. 다른 인터랙션 미검증.
- **i18n**: 한/영 혼용 응답 메시지, 이모지 기반 레이블 — 국제화 범위 미정의.
- **브라우저 호환**: `replaceAll`(`formatters.ts`), `?.`/`??` 등 모던 문법. `tsconfig`의 target 미확인.

### 8.2 권장 다음 단계

1. **FIXES.md 우선순위화**: 총 189행을 위 §5의 15개 리팩토링 그룹으로 재분류 후 Milestone 할당.
2. **Critical 13건 즉시 처리**: 1~2 스프린트 내 마감 목표. CORS/CSRF/DATABASE_PATH 통일 등 단독 PR 가능 항목부터.
3. **공용 타입/헬퍼 기반 작업**: §5 우선순위 3~5를 순서대로 진행하면 이후 리팩토링이 컴파일 타임에 강제됨.
4. **CI 게이트**: `go vet`, `staticcheck`, `eslint --max-warnings 0`, `vitest run`, `go test -race ./...` 를 PR 필수 체크로 도입.
5. **모니터링 계측**: `requestID` 주입 + 로그 상관관계, `/health` web 포함, sanitize=false일 때의 메트릭 노출(운영 감사).
6. **문서화**: `project-map.md`에 ① URL 쿼리 규약(`?sid`/`?project`/`?model`), ② Unknown 토큰 계약, ③ sanitize_headers 위험 모델, ④ 로그 이모지 규약 11종 정리.
7. **재리뷰 시점**: §5 우선순위 1~8 완료 후 동일 청크 구조로 재실행. 특히 `RequestDetailContent`/`handlers.go` 분해 후 이슈 밀도 측정.

---

## 부록 A — 청크별 리포트 링크

| 청크 | 파일 |
|---|---|
| CHUNK-BE-01 | `.plan/reviews-2026-04-23/CHUNK-BE-01-review.md` |
| CHUNK-BE-02 | `.plan/reviews-2026-04-23/CHUNK-BE-02-review.md` |
| CHUNK-BE-03 | `.plan/reviews-2026-04-23/CHUNK-BE-03-review.md` |
| CHUNK-FE-01 | `.plan/reviews-2026-04-23/CHUNK-FE-01-review.md` |
| CHUNK-FE-02 | `.plan/reviews-2026-04-23/CHUNK-FE-02-review.md` |
| CHUNK-FE-03 | `.plan/reviews-2026-04-23/CHUNK-FE-03-review.md` |
| CHUNK-SH-01 | `.plan/reviews-2026-04-23/CHUNK-SH-01-review.md` |
| CHUNK-CF-01 | `.plan/reviews-2026-04-23/CHUNK-CF-01-review.md` |
| CHUNK-TS-01 | `.plan/reviews-2026-04-23/CHUNK-TS-01-review.md` |
| CHUNK-CC-01 | `.plan/reviews-2026-04-23/CHUNK-CC-01-cc.md` |
| CHUNK-CC-02 | `.plan/reviews-2026-04-23/CHUNK-CC-02-cc.md` |
| CHUNK-CC-03 | `.plan/reviews-2026-04-23/CHUNK-CC-03-cc.md` |
| CHUNK-CC-04 | `.plan/reviews-2026-04-23/CHUNK-CC-04-cc.md` |
| FIXES | `.plan/reviews-2026-04-23/FIXES.md` (189행) |
| STATUS | `.plan/reviews-2026-04-23/STATUS.md` |

---

## 부록 B — 이슈 차원별 교차 표

| 차원 | REVIEW 합 | 대표 유형 |
|---|---|---|
| D1 | 92 | any 남용, 매직 넘버, 에러 무시, key={index}, 이모지/스타일 혼재 |
| D2 | 65 | 파일·함수 과대, 중첩, 중복 로직, 응집도 훼손 |
| D3 | 16 | 레이어 위반(FE fetch 직접), 순환 없음, 중복 정의, 도메인 혼재 |
| D4 | 34 | CORS `*`, CSRF 부재, XSS 표면, sanitize 옵션, 경로 traversal, LIKE 매칭, 민감정보 로그 |

---

**요약**: 13개 청크 225개 이슈(C=13, H=78, M=101, L=33) 중 **보안(D4)과 설정 일관성**이 Critical 대부분을 차지하며, 단일 **공용 타입/`backendFetch` 헬퍼/`DB_PATH` 정리** 3개 선행 작업이 나머지 리팩토링의 디펜던시 루트다. 우선순위 1~4를 1~2 스프린트로 소화하면 이후 작업이 컴파일·타입 시스템에 의해 자연스럽게 강제되는 구조가 된다.
