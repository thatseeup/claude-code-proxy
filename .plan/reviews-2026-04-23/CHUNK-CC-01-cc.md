# CHUNK-CC-01 — API 계약 정합성 (BE 라우트 ↔ FE loader/프록시)

- Executed: 2026-04-23
- Files reviewed: 13 (2,698 LOC)
- Sampling: none
- Reviewer: o-web-reviewer subagent (CC mode)
- 연관 청크: BE-02, FE-03

## 1. 정량 요약

### 1.1 BE 라우트 등록 (proxy/cmd/proxy/main.go:74-89)

| # | Method | Path | Handler | 비고 |
|---|---|---|---|---|
| 1 | POST | /v1/chat/completions | ChatCompletions | 400 stub |
| 2 | POST | /v1/messages | Messages | — |
| 3 | GET  | /v1/models | Models | empty list |
| 4 | GET  | /health | Health | — |
| 5 | GET  | / · /ui | UI | — |
| 6 | GET  | /api/requests | GetRequests | model,page,limit,sessionId,summary |
| 7 | DELETE | /api/requests | DeleteRequests | 전체 삭제 |
| 8 | GET  | /api/requests/{id} | GetRequestByID | — |
| 9 | GET  | /api/sessions | GetSessions | — |
| 10 | DELETE | /api/sessions/{id} | DeleteSession | id="unknown" 매핑 |
| 11 | GET  | /api/projects | GetProjects | — |
| 12 | GET  | /api/conversations | GetConversations | page,limit (model은 읽지 않음) |
| 13 | GET  | /api/conversations/project | GetConversationsByProject | project=path |
| 14 | GET  | /api/conversations/{id} | GetConversationByID | project=path 필수 |

### 1.2 FE 호출부 ↔ BE 매핑 표

| FE 파일 | 경로 | 메서드 | 쿼리/바디 | BE 대응 | 정합 |
|---|---|---|---|---|---|
| api.conversations.tsx:9-14 | /api/conversations | GET | model | GetConversations | ⚠️ `model` 무시됨 |
| api.grade-prompt.tsx:13 | /api/grade-prompt | POST | body forward | **없음 (404)** | ❌ |
| api.projects.tsx:6 | /api/projects | GET | — | GetProjects | ✓ |
| api.requests.$id.tsx:11 | /api/requests/{id} | GET | — | GetRequestByID | ✓ |
| api.requests.tsx:12-23 (loader) | /api/requests | GET | model,page,limit | GetRequests | ✓ (sessionId,summary 미전달) |
| api.requests.tsx:45 (action) | /api/requests | DELETE | — | DeleteRequests | ✓ |
| api.sessions.$sessionId.tsx:15 | /api/sessions/{id} | DELETE | — | DeleteSession | ✓ |
| api.sessions.tsx:6 | /api/sessions | GET | — | GetSessions | ✓ |
| conversations.$projectId.tsx:54-58 | /api/conversations/project | GET | project | GetConversationsByProject | ✓ |
| conversations.$projectId.tsx:71 | /api/sessions | GET | — | GetSessions | ✓ (직접 호출) |
| conversations.tsx:21 | /api/projects | GET | — | GetProjects | ✓ (직접 호출) |
| requests.$sessionId.tsx:52-62 | /api/requests | GET | sessionId,model,page,limit,summary | GetRequests | ✓ |
| requests.tsx:27 | /api/sessions | GET | — | GetSessions | ✓ (직접 호출) |

- FE→BE 호출 총 13건, 중 계약 불일치/고아 2건, 경로 경유 불일치 3건(같은 엔드포인트를 어떤 페이지는 api.* 프록시, 어떤 페이지는 직접 호출).

### 1.3 응답 shape 일관성

| 엔드포인트 | 반환 형태 | 래핑 |
|---|---|---|
| GET /api/requests | `{ requests:[], total:N }` | envelope |
| GET /api/requests/{id} | `RequestLog` | 단일 객체 |
| GET /api/sessions | `SessionSummary[]` | bare array |
| GET /api/projects | `ProjectSummary[]` | bare array |
| GET /api/conversations | `{ conversations:[] }` | envelope |
| GET /api/conversations/project | `Conversation[]` | bare array |
| GET /api/conversations/{id} | `Conversation` | 단일 객체 |
| DELETE /api/requests | `{ success, deleted, message }` | envelope (keys 혼재) |
| DELETE /api/sessions/{id} | `{ deleted:N }` | envelope |

- 리스트 엔드포인트 5개 중 **2개만 envelope, 3개는 bare array** — 일관성 규약 없음.
- DELETE 응답 형태도 엔드포인트마다 다름.

### 1.4 Unknown 세션 버킷 일관성

- BE:
  - GetRequests: `?sessionId=unknown` → 빈 문자열로 치환 (handlers.go:190-196)
  - DeleteSession: path `unknown` → 빈 문자열로 치환 (handlers.go:447-449)
  - `sessionPathUnknown = "unknown"` 상수 (handlers.go:436)
- FE:
  - `UNKNOWN_TOKEN = "unknown"` — 각 파일에 리터럴/상수 개별 선언 (requests.tsx:18, requests.$sessionId.tsx:44)
  - requests.$sessionId.tsx:53 — `sessionIdToken`을 치환 없이 그대로 BE로 전달 → "unknown" 문자열 그대로 전송, BE에서 매핑되므로 정상 동작
  - api.sessions.$sessionId.tsx — `UNKNOWN_TOKEN`/빈값 분기 없음; 그대로 forward

⇒ 실동작은 일치하지만 **"unknown" 리터럴이 BE/FE 4곳에 hardcoded**. 공유 상수 없음.

### 1.5 mux 등록 순서 (잠재 충돌)

```
/api/conversations            (L87)  GetConversations
/api/conversations/project    (L88)  GetConversationsByProject
/api/conversations/{id}       (L89)  GetConversationByID
```

gorilla/mux는 선등록 우선 매칭이므로 현 순서에서는 `/api/conversations/project` 요청이 `{id}`로 잡히지 않는다. 그러나 누군가 순서를 뒤집으면 `id="project"`로 오라우팅되어 BE가 `project` 쿼리 파라미터 누락 400을 반환하게 된다.

### 1.6 URL 하드코딩 재확인

- `http://localhost:3001` 리터럴 13곳 (BACKEND 경로 전부) → FIXES #93 에서 이미 기록.
- FE `vite.config.ts` 프록시 target 하드코딩은 FIXES #128 에서 기록.
- 본 CC에서는 **동일 엔드포인트를 api.* 프록시와 직접 호출 양쪽이 혼재**한다는 구조적 이슈를 추가 진단.

---

## 2. 교차 확인된 이슈 (Critical / High / Medium)

> 각 이슈 말미에 BE-02 / FE-03 단일 청크 이슈와 중복 여부 표기.

### [Critical] [D4,D1] `/api/grade-prompt` — FE만 존재, BE 미등록 (고아 프록시)

- 파일:
  - 프록시: `web/app/routes/api.grade-prompt.tsx:13`
  - 호출부: `web/app/routes/requests.$sessionId.tsx:733-735` — `onGrade={() => {}}` (dead)
  - BE: `proxy/cmd/proxy/main.go:74-89` 라우터에 `/api/grade-prompt` 없음
- 증거:
  ```ts
  // api.grade-prompt.tsx
  const response = await fetch('http://localhost:3001/api/grade-prompt', {
    method: 'POST', ...
  });
  ```
- 설명: 프록시가 존재하나 BE 라우트는 정의돼 있지 않음 → `NotFound` 핸들러가 JSON 404 반환 → FE가 `throw`로 전환 → 500 응답. 호출부는 dead (`onGrade={() => {}}`).
- 교차 상태: 단일 리뷰 FIXES #99 에서 이미 기록 → **본 CC에서 신규 append 하지 않음**. CC 결론: **FE 프록시 + FE 호출부 + 관련 dead prop을 같은 PR에서 함께 제거**해야 함.

### [High] [D3] `/api/conversations`의 `model` 쿼리 무시 (계약 침묵 실패)

- 파일:
  - FE: `web/app/routes/api.conversations.tsx:7-12`
  - BE: `proxy/internal/handler/handlers.go:978-1052` (GetConversations — `r.URL.Query()`에서 `model` 조회하지 않음)
- 증거:
  ```ts
  // api.conversations.tsx
  const modelFilter = url.searchParams.get("model");
  if (modelFilter) backendUrl.searchParams.append('model', modelFilter);
  ```
  ```go
  // handlers.go GetConversations — page/limit만 읽음
  page, _ := strconv.Atoi(r.URL.Query().Get("page"))
  limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
  ```
- 설명: FE 프록시는 `model` 필터를 forward 하지만 BE는 읽지 않고 침묵으로 무시한다. 향후 UI가 대화 리스트 모델 필터를 노출하면 "동작하는 것처럼" 요청이 나가지만 결과는 전체가 반환된다. 테스트/디버깅 난이도 상승.
- 수정 제안: (a) BE `GetConversations`에도 `modelFilter` 구현, 또는 (b) FE 프록시에서 `model` 포워드 제거 + 주석으로 "대화 API는 모델 필터 미지원" 명시.
- 교차 상태: 신규 — FIXES 추가.

### [High] [D2] 리스트/삭제 응답 envelope 일관성 없음

- 파일:
  - handlers.go:250-257 (`GetRequests` → `{requests,total}` envelope)
  - handlers.go:400-431 (`GetSessions` → bare array)
  - handlers.go:1087-1105 (`GetProjects` → bare array)
  - handlers.go:978-1052 (`GetConversations` → `{conversations}` envelope)
  - handlers.go:1108-1122 (`GetConversationsByProject` → bare array)
  - handlers.go:366-381 (`DeleteRequests` → `{message,deleted}`)
  - handlers.go:438-461 (`DeleteSession` → `{deleted}`)
- 설명: 같은 도메인 5개 리스트 엔드포인트가 envelope 2개 · bare array 3개로 혼재. DELETE 응답 키도 엔드포인트마다 달라 FE가 매번 가변 shape를 방어해야 한다.
- 수정 제안: 전체 리스트를 `{items:[], total?:N, nextCursor?:string}` 래핑으로 표준화 + `docs/api.md` 규약. 단기로 적어도 리스트는 모두 envelope로 통일.
- 교차 상태: 신규 — FIXES 추가.

### [High] [D3,D2] 동일 엔드포인트를 api.* 프록시/직접 호출 혼용 (BACKEND_URL 경로 2중화)

- 파일:
  - `api.sessions.tsx:6` (loader로 `/api/sessions` 프록시 제공)
  - `requests.tsx:27`, `conversations.$projectId.tsx:71` (동일 엔드포인트를 `http://localhost:3001/api/sessions` 직접 호출)
  - `api.projects.tsx:6` (loader) vs `conversations.tsx:21` (직접 호출)
- 설명: 프론트에는 이미 thin proxy loader가 있는데, 일부 page route loader가 BACKEND를 직접 호출한다. FIXES #93 도입 예정인 `backendFetch()` 도입 시 "어느 경로를 정식 경로로 삼을지" 먼저 정해야 한다. 현재처럼 양쪽 공존하면 리팩터링이 양 코드를 모두 만져야 하고 변경 누락이 생긴다.
- 수정 제안: 원칙을 하나로 결정 — (a) 모든 page loader는 BACKEND 직접 호출하고 api.* 프록시는 클라이언트 fetcher 전용, 또는 (b) 모든 호출은 api.* 프록시 경유. 선택 후 문서화 + 일괄 전환.
- 교차 상태: 부분 중복 (FIXES #93은 URL 상수화, 본 이슈는 아키텍처 원칙) — FIXES 신규 append.

### [High] [D4] DELETE `/api/requests` (전체 삭제) · DELETE `/api/sessions/unknown` (전체 Unknown 삭제) 인증/CSRF 부재

- 파일:
  - `web/app/routes/api.requests.tsx:39-60` (FE 프록시)
  - `web/app/routes/api.sessions.$sessionId.tsx:4-33` (FE 프록시)
  - `proxy/internal/handler/handlers.go:366-381`, `438-461` (BE)
- 설명: DELETE `/api/requests` 는 전체 요청 로그 삭제, DELETE `/api/sessions/unknown` 은 전체 Unknown 버킷 일괄 삭제. 두 엔드포인트 모두 인증/CSRF/Origin 검증 없음. CORS `*` (BE main.go:67) 조합으로 외부 origin의 무인증 요청으로 전체 로그 삭제 가능.
- 교차 상태: FIXES #1(CORS `*`), #98(api.requests DELETE) 에서 부분 기록. 본 CC에서 **`/api/sessions/unknown` 대량 삭제 경로**가 동일한 공격 표면임을 추가 교차 확인 — 기존 fix 적용 시 두 경로 모두 커버되어야 함. 신규 append 하지 않음 (주의사항으로 기존 fix 해설).

### [High] [D1,D3] Unknown 세션 토큰 "unknown" 4곳 리터럴 중복 (BE/FE 공유 상수 없음)

- 파일:
  - `proxy/internal/handler/handlers.go:436` — `sessionPathUnknown = "unknown"`
  - `proxy/internal/handler/handlers.go:193` — `if sessionIDQuery == sessionPathUnknown`
  - `web/app/routes/requests.tsx:18` — `UNKNOWN_TOKEN = "unknown"`
  - `web/app/routes/requests.$sessionId.tsx:44` — `UNKNOWN_TOKEN = "unknown"`
- 설명: 특수 sessionId 마커 문자열이 BE 1곳, FE 2곳에 분리 선언. 한쪽이 변경되면 조용히 계약이 깨진다.
- 수정 제안: OpenAPI/타입 공유 스펙이 없다면 최소한 `web/app/constants/session.ts`로 FE 공용화 + 주석에 "BE의 `sessionPathUnknown`과 동기" 명시. 장기: `shared/api-contract` 생성, 양측이 import.
- 교차 상태: 신규 — FIXES 추가.

### [Medium] [D2] mux `/api/conversations/{id}` 경로 — FE 미호출 (dead 경로)

- 파일: `proxy/cmd/proxy/main.go:89`, `proxy/internal/handler/handlers.go:1054-1076`
- 설명: `GET /api/conversations/{id}?project=...` 가 등록돼 있으나 FE 13개 타겟 파일 어디서도 호출하지 않음. GetConversationByID가 코드상 활성화돼 있지만 소비자가 없는 dead endpoint.
- 수정 제안: (a) 실제 UI 요구사항 확인 후 유지, 또는 (b) 라우트·핸들러·관련 service 메서드(`GetConversation`) 제거.
- 교차 상태: 신규 — FIXES 추가.

### [Medium] [D2] mux 등록 순서에 고정 의존 (리스크 기록)

- 파일: `proxy/cmd/proxy/main.go:87-89`
- 설명: `/api/conversations`, `/api/conversations/project`, `/api/conversations/{id}` 순서에 의존. 가령 알파벳 정렬 자동화 도구가 순서를 바꾸면 `project`가 `{id}` 로 잡혀 400 반환. 현재 버그는 아니나 회귀 위험.
- 수정 제안: 라우트 등록을 sub-router 패턴으로 그룹화(`r.PathPrefix("/api/conversations").Subrouter()`)하거나, `{id:[a-f0-9-]{8,36}}` 같은 정규식 제약을 달아 충돌 자체를 불가능하게.
- 교차 상태: 신규 — FIXES 추가.

### [Medium] [D1] `requests.$sessionId.tsx`가 `page=1&limit=1000` 하드코딩 (페이지네이션 누락)

- 파일: `web/app/routes/requests.$sessionId.tsx:57-58`
- 증거:
  ```ts
  backendUrl.searchParams.set("page", "1");
  backendUrl.searchParams.set("limit", "1000");
  ```
- 설명: 세션 내 요청이 1000을 초과하면 이후 요청이 UI에서 누락. `total`은 받지만 사용하지 않음(line 73-74).
- 수정 제안: 무한 스크롤 또는 페이지네이션 UI 도입, 또는 BE에 `limit=0` = "전체" 약속 추가. 최소 `total > requests.length`일 때 경고 배너.
- 교차 상태: 신규 — FIXES 추가.

### [Medium] [D3] `api.requests.tsx` (GET) 가 `sessionId`·`summary` 쿼리 미전달

- 파일: `web/app/routes/api.requests.tsx:4-37`
- 설명: BE `GetRequests`는 `sessionId`/`summary` 쿼리를 지원하지만 loader는 `model/page/limit`만 forward. 따라서 이 API 프록시를 사용하는 클라이언트는 세션 필터링/요약 모드를 쓸 수 없어 실질적으로 `requests.$sessionId.tsx`가 BE를 직접 호출하는 이유가 된다(위 [High] "api/직접 혼용" 참고).
- 수정 제안: `backendFetch` 공통화 시 전체 쿼리 passthrough로 일반화, 또는 세션 필터가 필요한 곳을 모두 `api.requests.tsx` 경유로 통일.
- 교차 상태: 부분적으로 위 [High] 이슈의 하위 원인. 신규 append 1건.

---

## 3. 이미 접수된 개별 이슈와의 교차 확인 (참고)

아래는 BE-02/FE-03 단일 리뷰에서 이미 FIXES에 등록되었고 본 CC 단계에서 **교차 확인만** 한 항목들 (재등록하지 않음):

- FIXES #93 — 백엔드 URL 13곳 하드코딩: 본 CC도 동일 13곳 확인. 수정 시 `backendFetch()` 도입이 본 CC의 여러 이슈(혼용, 프록시 누락 쿼리) 해결의 전제.
- FIXES #97 — loader가 실패 시 200+빈배열 반환: api.conversations / api.projects / api.sessions / api.requests / api.requests.$id / api.sessions.$sessionId 에서 일관 재확인.
- FIXES #98 — DELETE `/api/requests` CSRF/인증 부재: DELETE `/api/sessions/{id}` (특히 `unknown`) 도 같은 방식으로 보호 필요 (위 2.5 참고).
- FIXES #99 — `/api/grade-prompt` orphan: 본 CC에서 BE 미등록 확정.
- FIXES #100 — `projectFilter` dead: loader는 읽지만 backend/UI 어디에도 전달 안 됨.
- FIXES #105, #106 — path 파라미터 화이트리스트 검증 부재(`id`, `sessionId`).
- FIXES #1 — CORS `*`: DELETE 엔드포인트들과 결합 시 심각도 증폭.

## 4. 권장 다음 단계

1. **계약 스펙 단일 소스 화** — OpenAPI/typespec 중 하나 도입, FE는 생성된 타입·클라이언트 사용. 최소 `shared/api-contract.ts` 수동 타입 공유라도 도입.
2. **backendFetch 공용 헬퍼** — FIXES #93 작업 시 path 검증·쿼리 passthrough·에러 전파·401/403/5xx 구분까지 한번에.
3. **응답 envelope 규약 수립** — 리스트는 `{items, total, nextCursor?}`, 단일은 `{data}`, 에러는 `{error:{code,message}}`.
4. **"unknown" 특수 토큰 공용화** — `shared/session.ts` 상수로 BE/FE 공유.
5. **Dead 경로 정리** — `/api/grade-prompt` · `/api/conversations/{id}` (+ `conversationService.GetConversation`) 제거 여부 결정.
6. **FE 호출 경로 원칙 수립** — page loader는 BACKEND 직접, 클라이언트 fetcher는 api.* 프록시 (또는 반대) 중 하나로 통일.

---

※ 본 리포트는 대상 13개 파일 전수 read 후 작성 (샘플링 없음). 본문에서 언급한 외부 파일(conversation.go 등)은 shape 검증 목적의 grep 스냅샷에 의존.
