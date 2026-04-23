# CHUNK-FE-03 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23
- Files reviewed: 15 (1,658 LOC)
- Sampling: none (전량 판독)
- Reviewer: o-web-reviewer subagent
- Scope: Remix v2 entry/root + routes (api.* 프록시 + UI 라우트)

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 | 최대 파라미터 | import | export |
|---|---|---|---|---|---|---|
| entry.client.tsx | 18 | 8 | 3 | 0 | 3 | 0 |
| entry.server.tsx | 140 | 49 (handleBrowserRequest) | 4 | 4 (`handleRequest` 5) | 6 | 1 (default) |
| root.tsx | 56 | 18 (Layout) | 3 | 1 | 3 | 3 |
| routes/_index.tsx | 10 | 3 | 1 | 1 | 2 | 2 |
| routes/api.conversations.tsx | 25 | 22 | 2 | 1 | 2 | 1 |
| routes/api.grade-prompt.tsx | 32 | 29 | 2 | 1 | 2 | 1 |
| routes/api.projects.tsx | 18 | 15 | 2 | 0 | 2 | 1 |
| routes/api.requests.$id.tsx | 25 | 22 | 2 | 1 | 2 | 1 |
| routes/api.requests.tsx | 60 | 19 (action) | 2 | 1 | 2 | 2 |
| routes/api.sessions.$sessionId.tsx | 33 | 30 | 2 | 1 | 2 | 1 |
| routes/api.sessions.tsx | 18 | 15 | 2 | 0 | 2 | 1 |
| routes/conversations.$projectId.tsx | 358 ⚠️ | ~160 (기본 컴포넌트) ⚠️ | 7 ⚠️ | 2 | 9 | 2 |
| routes/conversations.tsx | 48 | 20 | 2 | 1 | 5 | 3 |
| routes/requests.$sessionId.tsx | 760 ⚠️ | ~320 (기본 컴포넌트) ⚠️ | 8 ⚠️ | 2 | 10 | 3 |
| routes/requests.tsx | 57 | 23 | 2 | 1 | 5 | 3 |

- ⚠️ 파일 LOC 초과: `requests.$sessionId.tsx` (760), `conversations.$projectId.tsx` (358)
- ⚠️ 함수 LOC 초과: 위 두 파일의 기본 export 컴포넌트 함수가 JSX+핸들러+헬퍼를 통째로 포함
- ⚠️ 중첩 깊이 초과: `requests.$sessionId.tsx` JSX 트리 8단(`flex > SessionPicker > div > div > map > Link > div > flex-wrap`), `conversations.$projectId.tsx` 7단
- Import 수 초과 없음 (최대 10)

### D3 의존성

- 외부 import 모듈 수: 주요 3rd-party = `@remix-run/node`, `@remix-run/react`, `react`, `react-dom`, `isbot`, `lucide-react`
- 내부 import: `../components/*`, `../utils/formatters`
- Fan-out 과다 파일 (>25): 없음
- Fan-in 추정:
  - `requests.$sessionId.tsx`: `useRouteLoaderData("routes/requests")` 참조 구조, `routes/requests.tsx`의 자식
  - `conversations.$projectId.tsx`: 동일 패턴, `routes/conversations.tsx`의 자식
- 순환 의존 후보: 없음
- **레이어 위반**: 8개 라우트 파일(UI + api 프록시)이 loader/action에서 `fetch("http://localhost:3001/...")`를 **직접** 호출. 중앙 API 클라이언트/URL 빌더 부재.

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 |
|---|---|---|
| 비밀 패턴 | 0 | D1, D4 |
| 디버그 로그 | 0 (`console.error`는 유효한 에러 로깅) | D1 |
| `any` 남용 | 8 | D1 |
| SQL injection 의심 | 0 | D4 |
| XSS 의심 (`dangerouslySetInnerHTML`) | 1 (root.tsx 테마 초기화 스크립트 — 정적 템플릿, 사용자 입력 없음) | D4 |
| eval/exec | 0 | D4 |
| CORS 와일드카드 | 0 | D4 |
| 민감정보 로깅 | 0 | D4 |
| 백엔드 URL 하드코딩 (`localhost:3001`) | 13 | D1, D3, D4 |

### AI 분석 친화성

- 타입 시그니처 완비도: ~85% (loader/action 반환 타입 일부 `json<LoaderData>`만 명시, helper는 `any` 다수)
- 명명 일관성: `sessionIdToken`/`sessionId`/`sid`/`UNKNOWN_TOKEN` 혼재; single quote vs double quote 혼용(`api.conversations.tsx`·`api.requests.tsx`·`api.grade-prompt.tsx`는 `'`, 나머지는 `"`)
- 파일명 vs 주 export: OK (Remix 컨벤션 준수, default export가 파일 역할과 일치)
- 주석 밀도: 평균 이하. 핵심 흐름(예: `requests.$sessionId.tsx` line-by-line은 드물게 주석 존재, line 89-91/460-465/471-477에 inline 설명 양호)

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D4] 서버-사이드 `fetch("http://localhost:3001/...")` 하드코딩 — SSRF/배포 환경 의존

- 파일: `web/app/routes/api.conversations.tsx:9`, `api.grade-prompt.tsx:13`, `api.projects.tsx:6`, `api.requests.$id.tsx:11`, `api.requests.tsx:12,45`, `api.sessions.$sessionId.tsx:15`, `api.sessions.tsx:6`, `conversations.$projectId.tsx:55,71`, `conversations.tsx:21`, `requests.$sessionId.tsx:52`, `requests.tsx:27`
- 증거:
  ```ts
  // api.conversations.tsx:9-14
  const backendUrl = new URL('http://localhost:3001/api/conversations');
  if (modelFilter) {
    backendUrl.searchParams.append('model', modelFilter);
  }
  const response = await fetch(backendUrl.toString());
  ```
- 설명: 13군데에 동일 문자열이 산재. 환경변수/설정 기반 주입이 없어 Docker/프로덕션에서 백엔드 호스트 변경 시 전역 교체 필요. 또한 `http://` 평문(내부 네트워크 가정)과 인증 헤더 전달 부재는 백엔드가 인증을 요구하는 순간 즉시 회귀 버그. 외부 호출 대상 URL이 상수라는 점은 SSRF 위험 자체는 낮지만, `api.requests.$id.tsx:11`의 `encodeURIComponent(id)`처럼 입력값이 경로에 삽입되는 경우 백엔드 라우팅 규칙에 따라 prefix trick 가능성(예: `id = "../admin"`)이 생김 — 현재 백엔드가 경로 파라미터를 ID로만 취급하면 무해하나, path-traversal 방지를 위해 화이트리스트(영숫자+하이픈)를 별도 검증 필요.
- 수정 제안: `web/app/config/backend.ts`에 `BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001"` + `backendFetch(path, init)` 헬퍼. 모든 loader/action에서 이 헬퍼 사용. ID에 정규식 화이트리스트 검증.

### [High] [D2] `requests.$sessionId.tsx` 760 LOC · 기본 export 컴포넌트 ~320 LOC · JSX 8단 중첩

- 파일: `web/app/routes/requests.$sessionId.tsx:442-760`
- 증거:
  ```tsx
  // line 442-480: loader 데이터 + fetcher + keyboard handler + scroll ref + filter handler
  export default function RequestsForSession() {
    const { requests, modelFilter, sessionIdToken } = useLoaderData<typeof loader>();
    ...
    const detailFetcher = useFetcher<RequestLog>();
    const targetRid = summarySelected?.requestId ?? "";
    useEffect(() => { if (!targetRid) return; detailFetcher.load(...); }, [targetRid]);
    ...
    // line 600-710: 긴 JSX (request row 렌더링, IIFE 포함)
  ```
- 설명: 단일 파일에 `modelBadge`, `statusPillClass`, `classifySession`, `summarizeMessage`, `lastTwoMessages`, `LastMessagePreview`, `UsageLine`, 그리고 기본 컴포넌트가 전부 존재. 테스트 어려움, 렌더 최적화(`useMemo`) 어려움, 인지 부하 큼.
- 수정 제안: 
  - `web/app/utils/request-classify.ts` — `classifySession`, `semanticSystemTexts`, `normalizeSystemText`, `systemEntryText`, `isStreamRequest`, `modelBadge`, `statusPillClass`, `hitRatioChipClass` 이동 + 단위 테스트
  - `web/app/utils/message-preview.ts` — `summarizeMessage`, `lastTwoMessages`, `stringifyToolResultContent` + 테스트
  - `web/app/components/requests/LastMessagePreview.tsx`, `UsageLine.tsx`, `RequestListRow.tsx` — 프레젠테이션 컴포넌트 분리
  - 결과 기본 파일 ≤ 200 LOC

### [High] [D2] `conversations.$projectId.tsx` 358 LOC · 기본 컴포넌트 ~160 LOC

- 파일: `web/app/routes/conversations.$projectId.tsx:142-358`
- 증거:
  ```tsx
  // line 142-196: keyboard handler + scroll + 선택 상태
  export default function ConversationsForProject() {
    ...
    useEffect(() => {
      if (conversations.length === 0) return;
      const handleKey = (e: KeyboardEvent) => { ... };
      globalThis.addEventListener("keydown", handleKey);
      return () => globalThis.removeEventListener("keydown", handleKey);
    }, [conversations, selected?.sessionId, searchParams]);
  ```
- 설명: `formatTime`, `firstUserText`, `safeJSONParse`, `extractText`, 그리고 JSX 전체가 한 파일. `requests.$sessionId.tsx`와 **동일한 키보드 핸들러/스크롤 패턴**이 복제되어 있어 유지보수 비용 2배.
- 수정 제안: 
  - `web/app/hooks/useListKeyboardNav.ts` — `(items, currentIdx, onChange)` → `requests.$sessionId.tsx`와 `conversations.$projectId.tsx` 공용 훅
  - `web/app/utils/conversation-preview.ts` — `firstUserText`, `extractText`, `safeJSONParse`
  - `web/app/components/conversations/ConversationListRow.tsx`

### [High] [D1] `any` 타입 8곳 — Anthropic 도메인 타입 소실

- 파일: `web/app/routes/conversations.$projectId.tsx:27,117,125`, `requests.$sessionId.tsx:31,32,33,184,731`
- 증거:
  ```ts
  // requests.$sessionId.tsx:22-34
  interface RequestLog {
    ...
    body?: any;        // L31
    response?: any;    // L32
    promptGrade?: any; // L33
  }
  // line 731
  } as any
  ```
- 설명: Anthropic request/response body를 `any`로 두어 `modelBadge(req.body?.model)`, `req.response?.body?.stop_reason`, `req.response.body.usage` 등 안전하지 않은 접근. CHUNK-FE-01 #62 / FE-02 #77과 같은 맥락 — 공용 `types/anthropic.ts`가 필요.
- 수정 제안: `web/app/types/anthropic.ts`에 `AnthropicRequestBody`/`AnthropicResponseBody`/`ContentBlock`/`UsageShape`/`RequestLog` 정의 후 import. (CHUNK-FE-02 #77과 통합 작업)

### [High] [D1] 백엔드 실패 시 200 OK + 빈 데이터 — 사용자 UX 혼란

- 파일: `api.conversations.tsx:22-25`, `api.projects.tsx:14-17`, `api.requests.tsx:31-36`, `api.sessions.tsx:14-17`, `conversations.$projectId.tsx:63-66,76-79`, `conversations.tsx:25-27`, `requests.$sessionId.tsx:76-78`, `requests.tsx:31-33`
- 증거:
  ```ts
  // api.requests.tsx:31-36
  } catch (error) {
    console.error('Failed to fetch requests:', error);
    // Return empty array if backend is not available
    return json({ requests: [] });
  }
  ```
- 설명: 백엔드가 다운되거나 5xx를 반환해도 프론트는 200 + 빈 리스트를 받는다. 사용자는 "요청 없음"과 "백엔드 오류"를 구별할 수 없고, 모니터링/알림도 불가.
- 수정 제안: 
  - api.* 프록시: `throw new Response(..., { status: 502 })` 또는 `{ error, requests: [] }`로 통일 후 `ErrorBoundary`에서 토스트
  - loader(`conversations.$projectId.tsx` 등): `{ error: string | null, conversations: [] }` 형태로 전달 후 UI에서 배너 렌더

### [High] [D4] `api.requests.tsx` DELETE는 전체 삭제 — 인증/CSRF 없음

- 파일: `web/app/routes/api.requests.tsx:39-60`
- 증거:
  ```ts
  export const action: ActionFunction = async ({ request }) => {
    const method = request.method;
    if (method === "DELETE") {
      try {
        const response = await fetch('http://localhost:3001/api/requests', {
          method: 'DELETE'
        });
        ...
        return json({ success: true });
  ```
- 설명: 임의의 요청이 전체 로그를 삭제할 수 있다. CSRF 토큰/Origin 검증/인증 미들웨어 전무. 로컬 개발 환경 한정 도구라 해도, 같은 머신의 다른 사이트가 `fetch('/api/requests', {method:'DELETE', credentials:'omit'})`만으로 삭제 성공. 브라우저 간 `mode: 'cors'`로 preflight가 생기지만 Remix는 기본 same-origin에서 preflight 없이 처리.
- 수정 제안: 
  - 최소한 `Origin` 헤더 화이트리스트 검증
  - Remix `csrfToken`(cookie+form field) 또는 `X-Requested-With` 헤더 강제
  - 장기: 인증 미들웨어(로컬 전용 사용자 토큰)

### [High] [D3] `api.grade-prompt.tsx` — 백엔드 엔드포인트 없음 (404)

- 파일: `web/app/routes/api.grade-prompt.tsx:1-32`
- 증거:
  ```ts
  const response = await fetch('http://localhost:3001/api/grade-prompt', { ... });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  ```
- 설명: 백엔드에 대응 핸들러가 없다(CHUNK 컨텍스트 명시). 현재 UI에서도 `onGrade={() => { /* grading UI out of scope */ }}` (requests.$sessionId.tsx:733)로 실호출 경로가 죽어 있다. 단순 dead code로 남으면 향후 복원 시 silent 404를 삼키는 500 응답이 내려감.
- 수정 제안: 라우트 파일 삭제 + `RequestDetailContent`의 `onGrade` prop까지 정리 (CHUNK-FE-02 #84와 병합). 복원이 필요하면 백엔드 구현 이후에만 부활.

### [High] [D1] `requests.$sessionId.tsx` — `projectFilter`를 loader가 반환만 하고 백엔드 전달/UI 사용 없음

- 파일: `web/app/routes/requests.$sessionId.tsx:50,85`
- 증거:
  ```ts
  // L50
  const projectFilter = url.searchParams.get("project");
  // L52-63: backendUrl 빌드 — projectFilter가 searchParams에 추가되지 않음
  backendUrl.searchParams.set("sessionId", sessionIdToken);
  if (modelFilter !== "all") { backendUrl.searchParams.set("model", modelFilter); }
  ...
  return json<LoaderData>({ ..., projectFilter });
  ```
- 설명: `projectFilter`가 `LoaderData`에 포함되지만 컴포넌트에서 사용되지 않고(`useLoaderData` 구조분해에서 제외), 백엔드 URL에도 주입되지 않는다. 의도가 있었다면 누락 버그, 아니면 dead data.
- 수정 제안: 사용 의도 확인 후 (a) backend `project` 쿼리 전달 + UI 필터 노출 또는 (b) `projectFilter` 전체 제거.

### [High] [D2,D1] 키보드 내비게이션 로직 중복 (69 LOC × 2 파일)

- 파일: `conversations.$projectId.tsx:166-196`, `requests.$sessionId.tsx:495-527`
- 증거:
  ```tsx
  // requests.$sessionId.tsx:497-527 vs conversations.$projectId.tsx:168-196
  const handleKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
    }
    const currentIdx = requests.findIndex(...);
    ...
  };
  globalThis.addEventListener("keydown", handleKey);
  ```
- 설명: 동일한 Input/Textarea/Select/ContentEditable 가드 + Arrow 처리가 두 파일에 복제. 한쪽 수정 시 다른쪽 누락 위험.
- 수정 제안: `web/app/hooks/useListKeyboardNav.ts`(`{ items, currentId, onChange, skipEditable:true }`)로 통일.

### [Medium] [D1] Quote 스타일 혼용 (single vs double)

- 파일: `api.conversations.tsx`·`api.grade-prompt.tsx`·`api.requests.tsx`는 `'`, 나머지 api.* 및 UI는 `"`
- 증거:
  ```ts
  // api.conversations.tsx:9
  const backendUrl = new URL('http://localhost:3001/api/conversations');
  // api.projects.tsx:6
  const response = await fetch("http://localhost:3001/api/projects");
  ```
- 설명: Prettier/ESLint 스타일 규칙 부재. 기계적 일관성 결여 → AI/diff 도구 친화성 저하.
- 수정 제안: `.prettierrc`(`"singleQuote": false`) + `npx prettier --write web/app` (CHUNK-FE-02 #92와 통합).

### [Medium] [D1] `sid`/`sessionId`/`sessionIdToken`/`rid` 네이밍 혼재

- 파일: `requests.$sessionId.tsx:44,47,51,80,83,444,451`, `conversations.$projectId.tsx:50,151,152`
- 증거:
  ```ts
  // requests.$sessionId.tsx
  const UNKNOWN_TOKEN = "unknown";          // L44
  const sessionIdToken = params.sessionId ?? ""; // L47
  const rid = searchParams.get("rid") ?? ""; // L451
  ```
- 설명: `sessionIdToken`(URL segment, `"unknown"`/`""` 양쪽 의미), `sessionId`(도메인 ID), `sid`(쿼리스트링), `rid`(request ID 쿼리스트링) 4개 심볼이 혼용. 새 엔지니어/AI 에이전트 onboarding 비용 증가.
- 수정 제안: 명명 규약 문서(`web/app/README.md`) + 가능한 범위에서 alias 제거.

### [Medium] [D1] `RequestLog` 타입 2곳 중복 정의

- 파일: `requests.$sessionId.tsx:22-34` (자체 정의), 그리고 `web/app/components/RequestDetailContent.tsx` 유사 타입(FE-02 #77 참조)
- 증거:
  ```ts
  // requests.$sessionId.tsx:22-34
  interface RequestLog { requestId: string; timestamp: string; method: string; ... }
  ```
- 설명: 백엔드 DTO가 프론트 여러 파일에 중복 정의되면 필드 추가/변경 시 누락 위험. 공용 `types/request.ts` 필요.
- 수정 제안: `web/app/types/request.ts`로 분리 + `RequestDetailContent` 타입과 통합.

### [Medium] [D1] `api.requests.$id.tsx:5-8` — `id` 검증이 빈 문자열만 차단

- 파일: `web/app/routes/api.requests.$id.tsx:4-12`
- 증거:
  ```ts
  const id = params.id;
  if (!id) {
    return json({ error: "Missing id" }, { status: 400 });
  }
  try {
    const res = await fetch(
      `http://localhost:3001/api/requests/${encodeURIComponent(id)}`,
    );
  ```
- 설명: `id`에 어떤 문자열이든 오면 백엔드로 전달. `encodeURIComponent`로 경로 끊기는 방지되지만, `id=%00`·길이 제한 없음 등으로 백엔드에 부하 전달 가능. UUID/영숫자 규격 검증이 없다.
- 수정 제안: `/^[A-Za-z0-9_-]{1,128}$/` 정규식 가드 추가.

### [Medium] [D1] `api.sessions.$sessionId.tsx:9-12` — 동일 패턴, 빈 문자열만 차단

- 파일: `web/app/routes/api.sessions.$sessionId.tsx:9-12`
- 증거:
  ```ts
  const sessionIdToken = params.sessionId ?? "";
  if (sessionIdToken === "") {
    return json({ error: "Missing sessionId" }, { status: 400 });
  }
  ```
- 설명: 위와 동일. `sessionIdToken`이 `unknown` 같은 특수 토큰인지 여부도 분기 없음 → 백엔드가 `"unknown"`을 삭제 요청으로 받으면 의도치 않은 대량 삭제 가능 여부 확인 필요.
- 수정 제안: 토큰 형식 검증 + `UNKNOWN_TOKEN`일 때 분기/거부.

### [Medium] [D2] `entry.server.tsx` — `handleBotRequest` / `handleBrowserRequest` 95% 중복

- 파일: `web/app/entry.server.tsx:42-140`
- 증거:
  ```ts
  function handleBotRequest(...) { ... onAllReady() { ... } ... }
  function handleBrowserRequest(...) { ... onShellReady() { ... } ... }
  ```
- 설명: Remix 템플릿 그대로라 수정 우선순위는 낮지만, `ready` 콜백 키 이름만 다른 49 LOC 중복. 템플릿 유지는 합리적이나 향후 에러 처리 개선 시 양쪽을 같이 바꿔야 함.
- 수정 제안: (선택) `renderAppShell(request, ctx, statusCode, headers, readyKey)` 공통 함수로 추출. 낮은 우선순위.

### [Medium] [D1] `root.tsx:25-33` — 테마 초기화 스크립트 에러 무시 + 시스템 테마 변경 미반응

- 파일: `web/app/root.tsx:25-33,43`
- 증거:
  ```ts
  const themeInitScript = `
  (function(){
    try {
      var saved = localStorage.getItem('ccm-theme');
      var theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      if (theme === 'dark') document.documentElement.classList.add('dark');
    } catch (e) {}
  })();`;
  ```
- 설명: XSS 위험 자체는 없다(정적 상수 + 사용자 입력 없음). 다만 (a) `catch(e){}` 완전 침묵 — 디버깅 어려움, (b) `matchMedia` change 이벤트 미구독으로 OS 테마 전환 시 반영 없음(페이지 새로고침 필요), (c) `localStorage`가 `"light"`일 때 `dark` 클래스 제거 로직 없음(hydration mismatch에서 `dark` 잔존 가능).
- 수정 제안: `catch (e) { console.error(e); }` + 명시적 `classList.toggle('dark', theme === 'dark')` + 런타임 `matchMedia` listener (CHUNK-FE-02 #82 ThemeToggle과 통합 설계).

### [Medium] [D1] `requests.$sessionId.tsx:729-732` — `requestId as unknown as number` 의도적 타입 침식

- 파일: `web/app/routes/requests.$sessionId.tsx:729-732`
- 증거:
  ```tsx
  // RequestDetailContent expects `id` as number — re-use requestId
  // string; its usage is only for onGrade / display keys.
  id: selected.requestId as unknown as number,
  ```
- 설명: `RequestDetailContent` prop 타입 불일치를 강제 캐스팅으로 우회. 주석은 친절하지만 장기적으로 prop 타입을 고쳐야 한다.
- 수정 제안: `RequestDetailContent`의 `id` prop을 `string | number` 유니온으로 변경 또는 `requestId`만 사용하도록 리팩토링(FE-02 #77/#84 작업에 포함).

### [Medium] [D3] loader 중복: `conversations.$projectId.tsx` 와 `conversations.tsx`가 각각 `/api/sessions` / `/api/projects` 호출

- 파일: `conversations.$projectId.tsx:69-80`, `conversations.tsx:18-37`, `requests.$sessionId.tsx:46-87`, `requests.tsx:24-46`
- 증거:
  ```ts
  // conversations.$projectId.tsx:69-80
  const requestSessionIdsPromise = (async (): Promise<string[]> => {
    try {
      const res = await fetch("http://localhost:3001/api/sessions");
      ...
    }
  })();
  ```
- 설명: `conversations` parent loader가 `/api/projects`를 가져오고, `conversations.$projectId.tsx` 자식 loader가 `/api/sessions`를 다시 호출. Remix `useRouteLoaderData` 패턴을 활용하면 parent가 두 리소스를 한 번에 주고 자식은 `existingRequestSessionIds`만 계산하면 된다. 현재 구조는 리소스 정책이 자식에 흩어져 있어 응집도 저하.
- 수정 제안: parent(`conversations.tsx`)에서 projects + sessions 일괄 로드, 자식은 projectPath만 사용.

### [Low] [D1] `console.error`만 있고 사용자 UI 피드백 없음 — 전 파일 공통

- 파일: 모든 api.* + loader (예: `api.conversations.tsx:23`, `conversations.$projectId.tsx:64,77`)
- 설명: 백엔드 실패 시 서버 콘솔에만 로그. 사용자는 "데이터 없음"만 본다. 관측/디버깅에 장기적 비용.
- 수정 제안: `ErrorBoundary` 렌더 + `error` 필드 payload 전파(High #4와 통합).

### [Low] [D1] `routes/_index.tsx:4` — `_args` 인자 네이밍

- 파일: `web/app/routes/_index.tsx:4`
- 증거:
  ```ts
  export const loader = async (_args: LoaderFunctionArgs) => { return redirect("/requests"); };
  ```
- 설명: Remix는 인자를 쓰지 않는 loader에서 `async () =>` 형태로도 충분. `_args` underscore prefix는 관용적으로 OK이나 시그니처 타입 선언 자체가 불필요.
- 수정 제안: `async () => redirect("/requests")`로 축약.

## 긍정적 관찰

- **`shouldRevalidate`** (`requests.$sessionId.tsx:91-107`): `?rid=` 변경 시 무거운 list loader 재실행을 막는 최적화. 주석도 명확.
- **Summary 로딩 + on-demand detail fetcher** (`requests.$sessionId.tsx:60-63, 465-471`): `summary=true` 쿼리로 목록 페이로드 축소 + 선택 시 `useFetcher`로 상세 지연 로드. 규모 대응 설계.
- **Stale-while-loading detail** (`requests.$sessionId.tsx:473-479`): fetcher 로딩 중 이전 detail 유지 → UI flash 방지. 주석도 잘 달려 있음.
- **Modifier-click 보존** (`conversations.$projectId.tsx:240-245`): `meta/ctrl/shift` click에 새 탭 열기 허용.
- **SSRF/eval/innerHTML/SQL 위험 최소화**: `dangerouslySetInnerHTML`은 root의 정적 테마 초기화 1건, 사용자 입력 경로 없음.

## Cross-cutting 리뷰 시 참고 단서

- **CC-01 인증 플로우**: 본 청크는 인증 미도입. `/api/requests` DELETE(전체 삭제), `/api/sessions/:id` DELETE에 인증/CSRF 없음 — CC-01에서 백엔드 전체 (proxy Go) 인증 정책과 교차 확인 필요.
- **CC-02 API 계약 정합성**: 
  - `api.grade-prompt.tsx`는 **백엔드 미구현**(사용자 제공 컨텍스트). CC-02에서 반드시 확인.
  - `api.requests.tsx`/`requests.$sessionId.tsx` — 프론트는 `{requests, total}` 기대, 일부 파일은 `{requests: []}` 폴백만 반환(`total` 누락). 백엔드 응답 shape과 대조 필요.
  - `/api/sessions` 응답을 `conversations.$projectId.tsx:73`은 `Array<{sessionId: string}>`로, `requests.tsx:29`은 `SessionSummary[]`로 해석 → 동일 엔드포인트의 두 가지 타입 가정. CC-02에서 shape 통일.
- **CC-03 에러 처리 일관성**: 전 api.* 프록시가 실패 시 200 OK + 빈 본문으로 수렴. 나머지 백엔드(Go) 쪽 에러 포맷과 대조해 4xx/5xx 전파 규약 합의 필요.
- **CC-04 설정/비밀 관리**: `http://localhost:3001` 13회 하드코딩 + `process.env` 참조 전무. `BACKEND_URL` env 도입 필요 — `.env.example`·`Dockerfile`·`run.sh`·`docker-entrypoint.sh`와 교차 확인.
