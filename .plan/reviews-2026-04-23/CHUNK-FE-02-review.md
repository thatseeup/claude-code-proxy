# CHUNK-FE-02 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23
- Files reviewed: 6 (2,092 LOC)
- Sampling: none (전량 리뷰)
- Reviewer: o-web-reviewer subagent

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 | 최대 파라미터 | import | export |
|---|---|---|---|---|---|---|
| HorizontalSplit.tsx | 128 | ~32 (handleMouseDown) | 3 | 1 | 1 | 1 (default) |
| ProjectPicker.tsx | 139 | ~78 (컴포넌트 JSX) | 5 ⚠️ | 1 | 3 | 1 default + 1 type |
| RequestDetailContent.tsx | 1,301 ⚠️ | 397 ⚠️ (ResponseDetails) | 10+ ⚠️ (JSX) | 1 | 4 | 1 default |
| SessionPicker.tsx | 411 ⚠️ | ~205 (SessionPicker JSX) ⚠️ | 8 ⚠️ (JSX) | 1 | 3 | 1 default + 3 named |
| ThemeToggle.tsx | 58 | ~16 | 2 | 0 | 2 | 1 default |
| TopNav.tsx | 55 | ~35 (컴포넌트) | 4 | 0 | 2 | 1 default |

임계값 요약:
- 파일 LOC > 300: **RequestDetailContent(1301), SessionPicker(411)**
- 함수 LOC > 50: **RequestDetailContent(361)**, **ResponseDetails(397)**, **ToolCard(79)**, **RequestOverviewTable(85)**, **ResponseOverviewTable(99)**, **SessionPicker(≈205)**
- 중첩 깊이 > 4: **RequestDetailContent/ResponseDetails JSX(10+단)**, **SessionPicker JSX(8단)**, **ProjectPicker JSX(5단)**

### D3 의존성

- 외부 import 모듈: `react`, `@remix-run/react`, `lucide-react` (3종)
- 프로젝트 내부 import (RequestDetailContent): `./MessageContent`, `../utils/formatters`, `../utils/models` (3종)
- Fan-out 과다 파일(>25): **없음**
- Fan-in (청크 밖 라우트에서의 참조):
  - `TopNav` — 2 routes (`requests.tsx`, `conversations.tsx`)
  - `SessionPicker` — 2 imports (`requests.tsx`, `requests.$sessionId.tsx`)
  - `ProjectPicker` — 2 imports (`conversations.tsx`, `conversations.$projectId.tsx`)
  - `HorizontalSplit` — 2 imports (`requests.$sessionId.tsx`, `conversations.$projectId.tsx`)
  - `RequestDetailContent` — 1 import (`requests.$sessionId.tsx`)
  - `ThemeToggle` — 1 import (`TopNav.tsx`, 청크 내부)
- 순환 의존 후보: **없음**
- 레이어 위반:
  - `SessionPicker.tsx:161` — 컴포넌트가 `fetch("/api/sessions/…", { method: "DELETE" })`를 **직접 호출**. Remix `fetcher`/action 또는 `web/app/api/*` 서비스 레이어 우회. ([D3])

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 |
|---|---|---|
| 비밀 패턴 (credential) | 1 (false-positive: `UNKNOWN_TOKEN = "unknown"` 상수) | — |
| 디버그 로그 (`console.*`) | 5 (모두 catch-block의 `console.error/warn`) | D1 (정보성) |
| `any` 타입 사용 | 6 | D1 |
| SQL injection 의심 | 0 | — |
| XSS / `dangerouslySetInnerHTML` | 0 | — |
| `eval`/`new Function` | 0 | — |
| CORS 와일드카드 | 0 (해당 없음) | — |
| 민감정보 로깅 | 0 | — |

### AI 분석 친화성
- 타입 시그니처 완비도: 약 **70%** — `content: any`, `body?: any`, `message: any`, `tool: any`, `schema: any`, `promptGrade: any` 6곳이 타입 소실.
- 명명 일관성: SessionPicker/ProjectPicker는 `"` double-quote, RequestDetailContent는 `'` single-quote, HorizontalSplit는 `"` — **따옴표 스타일 혼재**. 세미콜론/포매팅은 일관.
- 파일명 vs 주 export 일치: **OK** (모두 파일명과 default export 일치)
- 주석 밀도: HorizontalSplit·SessionPicker 적절 / RequestDetailContent는 장문 함수 대비 주석 희박 + L129-137 주석처리된 `Grade This Prompt` dead JSX 잔존.

---

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D2] RequestDetailContent.tsx 1,301 LOC · 13 컴포넌트 동거 — 리팩토링 최우선 대상
- 파일: `web/app/components/RequestDetailContent.tsx:1-1302`
- 증거 (함수별 LOC):
  ```
  RequestDetailContent  361 LOC (L81-441)   JSX 중첩 10+
  ResponseDetails       397 LOC (L502-894)  JSX 중첩 9+
  ResponseOverviewTable  99 LOC (L1204-1302)
  RequestOverviewTable   85 LOC (L1032-1112)
  ToolCard               79 LOC (L953-1029)
  MessageBubble          42 LOC (L442-481)
  + 7 개 보조 함수 (Collapsible/SchemaBlock/GroupSection 등)
  ```
- 설명: 파일 LOC(>300)·함수 LOC(>50)·중첩(>4) 3개 임계값 모두 극단적으로 초과. 13개 컴포넌트가 한 파일에 공존하여 네비게이션/diff/코드리뷰가 사실상 불가능.
- 수정 제안: `web/app/components/RequestDetail/` 디렉토리 신설 후 다음 단위로 분할:
  - `RequestDetailContent.tsx` (메인 레이아웃, ≤150 LOC)
  - `ResponseDetails.tsx` (+ `ResponseHeaders`, `ResponseBody`, `StreamingResponse`)
  - `RequestOverviewTable.tsx` / `ResponseOverviewTable.tsx`
  - `OverviewTable.tsx` (`GroupSection`, 타입 포함)
  - `ToolCard.tsx` / `SchemaBlock.tsx`
  - `MessageBubble.tsx`
  - `CollapsibleJSON.tsx`
  - `utils/sse.ts` (`parseStreamingResponse`, `formatSSELines`, `beautifyRawJSON`)
  - `utils/headers.ts` (`getHeader`)

### [Critical] [D1] RequestDetailContent.tsx `any` 타입 남용으로 Anthropic content block 유니온 타입 소실
- 파일: `web/app/components/RequestDetailContent.tsx:37, 60, 442, 484, 930, 953`
- 증거:
  ```ts
  messages?: Array<{ role: string; content: any; }>;           // L37
  body?: any;                                                   // L60 (response.body)
  function MessageBubble({ message, index }: { message: any; ... }) { // L442
  function ToolCard({ tool, index }: { tool: any; ... }) {      // L953
  function SchemaBlock({ schema, ... }: { readonly schema: any; ... }) // L930
  ```
- 설명: CHUNK-FE-01 #62와 동일 패턴. `content`/`tool`/`schema` 등 핵심 도메인 구조가 `any`로 소실되어 IDE/AI 추론이 되지 않음. `response.body.usage.cache_read_input_tokens` 등 L1293-1297에서도 `any.usage?.cache_read_input_tokens` 체인으로 타입 안전성 없음.
- 수정 제안: `web/app/types/anthropic.ts`에 `AnthropicRequestBody`, `AnthropicResponseBody`, `ContentBlock`(discriminated union), `AnthropicTool`, `AnthropicUsage` 정의 후 전역 적용. CHUNK-FE-01 #62 작업과 합쳐 처리.

### [High] [D2] ResponseDetails 397 LOC — 3개 책임(overview/streaming/parsing) 혼재
- 파일: `web/app/components/RequestDetailContent.tsx:502-894`
- 증거:
  ```ts
  function ResponseDetails({ response }: ...) {
    const [expandedSections, setExpandedSections] = useState<...>({...});
    const [copied, setCopied] = useState<...>({...});
    const toggleSection = ...
    const handleCopy = ...
    const getStatusColor = ...
    const formatSSELines = (chunks) => { ... }       // 45 LOC
    const parseStreamingResponse = (chunks) => {...} // 73 LOC — try/for/for 중첩 4단
    return (<div>...수백 라인 JSX...</div>);
  }
  ```
- 설명: `parseStreamingResponse`(L591-663)와 `formatSSELines`(L543-588)는 순수 함수인데 컴포넌트 내부에 선언되어 매 렌더마다 재생성 + 테스트 불가.
- 수정 제안: `web/app/utils/sse.ts`로 두 함수 추출 + unit test 추가. `ResponseDetails`는 ≤120 LOC로 축소.

### [High] [D2] SessionPicker.tsx 411 LOC · JSX 8단 중첩
- 파일: `web/app/components/SessionPicker.tsx:1-412`
- 증거:
  ```ts
  // L203-410: 단일 return 내부에 project picker + session picker + delete + link 버튼이 모두 인라인
  <div>
    <div>{/* project */}
      <button>...</button>
      {projectOpen && groups.length > 0 ? (
        <div><ul>{groups.map(g => (
          <li><button><div><span>...</span></button></li>
        ))}</ul></div>
      ) : null}
    </div>
    <div>{/* session */}... 동일 패턴 ...</div>
  </div>
  ```
- 설명: 두 dropdown이 복붙 수준 유사 구조. JSX 중첩 8단에 inline `className` 문자열이 길어 diff/유지보수 난이도 높음.
- 수정 제안:
  - `ProjectDropdown` / `SessionDropdown` 컴포넌트 분리 (`SessionPicker/` 디렉토리)
  - `DropdownButton` / `DropdownList` 공통 컴포넌트로 UI 중복 제거
  - `ProjectPicker.tsx`의 드롭다운 UI와도 겹치므로 3곳 통합 고려

### [High] [D1,D3] SessionPicker: DELETE API 직접 fetch — Remix fetcher/action 미사용
- 파일: `web/app/components/SessionPicker.tsx:157-175`
- 증거:
  ```ts
  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(activeSessionId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Failed to delete session (status ${res.status})`);
      revalidator.revalidate();
      navigate("/requests");
  ```
- 설명: Remix 관례인 `useFetcher` 또는 route `action`을 우회하고 컴포넌트가 HTTP를 직접 호출. 에러는 `console.error`로만 삼킨 뒤 사용자에게 UI 피드백이 없음(L170-172). `activeSessionId`가 `"unknown"` 토큰일 때 서버가 어떻게 처리하는지도 불명.
- 수정 제안:
  - `useFetcher()`로 전환하여 pending 상태/에러 토스트 UI 통합
  - 서버 action에서 401/404 처리 후 `fetcher.data.error`를 사용자에게 노출
  - `activeSessionId === UNKNOWN_TOKEN`일 때 delete 버튼 disabled 처리

### [High] [D1] SessionPicker: Delete 시 확인 다이얼로그 없음
- 파일: `web/app/components/SessionPicker.tsx:349-358`
- 증거:
  ```tsx
  <button
    type="button"
    onClick={handleDelete}
    disabled={isDeleting || sessions.length === 0}
    aria-label={`Delete session ${triggerShortId}`}
    title="Delete session"
    className="... hover:text-red-600 ..."
  >
    <Trash2 className="w-4 h-4" />
  </button>
  ```
- 설명: 단일 클릭으로 세션 삭제 → `revalidate` → `navigate("/requests")`. 실수 클릭 시 복구 불가 (서버가 restore API 제공하지 않는다고 가정).
- 수정 제안: `window.confirm(...)` 최소 적용 또는 2-step confirm(첫 클릭 시 "Click again to confirm") UI, 혹은 모달.

### [High] [D1] ThemeToggle FOUC: 초기 렌더에서 `light` 강제 후 useEffect에서 교체
- 파일: `web/app/components/ThemeToggle.tsx:23-39`
- 증거:
  ```ts
  export default function ThemeToggle() {
    const [theme, setTheme] = useState<Theme>("light");  // 항상 light로 시작
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      const initial = getInitialTheme();
      setTheme(initial);
      applyTheme(initial);                // 초기 mount 후에야 dark class 부착
      setMounted(true);
    }, []);
  ```
- 설명: Remix SSR에서 `<html>`에 dark class가 없는 상태로 도달 → 브라우저에서 dark 사용자는 흰 화면 플래시(FOUC)를 본 뒤 dark로 전환. `root.tsx`에서 쿠키/inline script로 `<html class="dark">`를 pre-paint로 결정해야 함.
- 수정 제안:
  - 서버에서 쿠키로 테마 저장 + `loader`에서 읽어 `<html class={theme === "dark" ? "dark" : ""}>` 직접 렌더
  - 또는 `<head>`에 inline `<script>`로 `localStorage` 읽고 `documentElement.classList.add('dark')` (hydration 전)

### [High] [D1] SessionPicker `groupSessionsByProject.latestTimestamp` 초기값 `""` 버그
- 파일: `web/app/components/SessionPicker.tsx:67-70`
- 증거:
  ```ts
  const latestTimestamp = groupSessions.reduce((best, s) => {
    const t = s.lastTimestamp ? new Date(s.lastTimestamp).getTime() : 0;
    return t > new Date(best).getTime() ? s.lastTimestamp : best;
  }, "");
  ```
- 설명: 초기 accumulator가 빈 문자열 `""`. `new Date("")` → `Invalid Date`, `.getTime()` → `NaN`. `t > NaN`은 항상 false이므로 **첫 세션의 lastTimestamp가 유효해도 best 갱신이 실패할 수 있음**(반대로 JS에서는 `number > NaN === false`이므로 첫 값이 선택되지 않고 `""`가 유지됨 → `groups.sort`에서 `new Date("").getTime()` → NaN → 정렬 불안정).
- 수정 제안:
  ```ts
  const latestTimestamp = groupSessions.reduce((best, s) => {
    if (!s.lastTimestamp) return best;
    if (!best) return s.lastTimestamp;
    return new Date(s.lastTimestamp).getTime() > new Date(best).getTime()
      ? s.lastTimestamp : best;
  }, "" as string);
  ```
  또는 이미 L61-65에서 sessions를 lastTimestamp desc로 정렬했으므로 `groupSessions[0].lastTimestamp`로 대체.

### [High] [D1] RequestDetailContent: 주석 처리된 dead JSX + `onGrade`/`canGradeRequest` 사용처 없음
- 파일: `web/app/components/RequestDetailContent.tsx:76-112, 129-137`
- 증거:
  ```tsx
  interface RequestDetailContentProps {
    request: Request;
    onGrade: () => void;          // prop은 선언되지만 어디서도 호출되지 않음
  }
  ...
  const canGradeRequest = (request: Request) => { ... } // 정의만, 사용처 없음
  ...
  {/* {!request.promptGrade && canGradeRequest(request) && (
    <button onClick={onGrade} ...>Grade This Prompt</button>
  )} */}
  ```
- 설명: `onGrade` prop과 `canGradeRequest` 함수 모두 dead code. 주석된 JSX는 리팩토링 시 혼란 유발. 호출부에서도 의미 없는 콜백 prop을 전달해야 함.
- 수정 제안: prop 제거, 함수 삭제, 주석 JSX 삭제. 기능 유지가 필요하면 feature flag 로 복원.

### [High] [D1] RequestDetailContent `key={index}` 안티패턴 (3곳)
- 파일: `web/app/components/RequestDetailContent.tsx:266, 308, 338`
- 증거:
  ```tsx
  {request.body.system.map((sys, index) => (
    <div key={index} className="...">...</div>       // L266
  ))}
  {request.body.tools.map((tool, index) => (
    <ToolCard key={index} tool={tool} index={index} /> // L308  ToolCard는 useState 보유
  ))}
  {request.body.messages.map((message, index) => (
    <MessageBubble key={index} message={message} index={index} /> // L338
  ))}
  ```
- 설명: `ToolCard`는 `expanded`/`copiedSchema` 로컬 state를 가지고 있어 메시지 삽입/삭제 시 state가 엉뚱한 tool로 이월됨. CHUNK-FE-01 #61과 동일 패턴.
- 수정 제안: `key={tool.name}`(고유 시), 그렇지 않으면 `key={\`tool-${index}-${tool.name}\`}`. 실제로는 요청 단위로 immutable이지만 state 이월 방지를 위해 안정 키 권장.

### [High] [D1] RequestDetailContent `toggleSection`이 정의되지 않은 section 키로도 호출 가능
- 파일: `web/app/components/RequestDetailContent.tsx:82-93, 172, 198-239`
- 증거:
  ```ts
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
  });
  // L204: onClick={() => toggleSection('requestBody')}
  // L216: {expandedSections.requestBody && ...}   // 초기 undefined → falsy
  ```
- 설명: `headers`/`requestBody`/`system`/`tools`/`conversation`/`model`/`responseHeaders`/`responseBody`/`streamingResponse`/`rawStreamingData` 섹션 상태가 초기 `undefined`. 첫 렌더에서 `!!undefined === false` 이므로 접힌 상태. 그러나 초기 "펼침" 의도가 있는 섹션이 있다면 주석만으로는 불명확(L83-84 `// conversation: true` 주석 처리됨). 의도와 실제 UX 불일치 위험.
- 수정 제안: 초기 상태 객체에 전체 섹션 키를 명시적으로 `false|true`로 선언, 또는 `toggleSection(k)`에서 `prev[k] ?? defaultOpen(k)` 처리.

### [Medium] [D2] ProjectPicker JSX 중첩 5단 + inline 긴 `className` 문자열
- 파일: `web/app/components/ProjectPicker.tsx:96-136`
- 증거: listbox dropdown 내 `div > ul > li > button > div > span/span` 구조. className 길이 150+ 자.
- 설명: 임계값(>4) 초과 & `SessionPicker` dropdown과 구조 중복.
- 수정 제안: `DropdownList` + `ProjectOption` 컴포넌트 분리, `SessionPicker` dropdown과 통합.

### [Medium] [D2] HorizontalSplit `handleMouseDown` 내부에 `onMove`/`onUp` 정의 — 마운트당 closure 재생성
- 파일: `web/app/components/HorizontalSplit.tsx:47-78`
- 증거:
  ```ts
  const handleMouseDown = useCallback((event) => {
    event.preventDefault();
    draggingRef.current = true;
    ...
    const onMove = (e) => { ... setLeftWidth(next); };
    const onUp = () => { ... };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [clamp]);
  ```
- 설명: 기능적으로는 안전(cleanup 완비)하지만 매 mousedown 때 두 closure 생성 + addEventListener 호출. 리스너 등록/해제를 `useEffect`로 옮기면 dragging 중 setState→rerender에 따른 listener 재등록을 피할 수 있음. 현재 구현도 OK (draggingRef 패턴이 잘 설계됨)이지만 가독성 향상을 위해 모듈 상위 or `useRef<Handler>` 패턴 권장.
- 수정 제안: 선택적 리팩토링. 현행도 올바르므로 낮은 우선순위.

### [Medium] [D1] RequestDetailContent `getHeader` 순회는 header 개수만큼 lowercase 변환 — 매 렌더 재계산
- 파일: `web/app/components/RequestDetailContent.tsx:1188-1200, 1207-1216`
- 증거: `ResponseOverviewTable`에서 8종 헤더 각각 lookup → 각 lookup이 `Object.keys()` + `toLowerCase()` 풀스캔.
- 설명: 일반적으로 response headers는 소규모라 문제는 아니나, 헤더 100개 이상 응답에서 O(N×M) 동작. `useMemo`로 lowercase 맵을 1회 빌드.
- 수정 제안:
  ```ts
  const lowerMap = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const k of Object.keys(headers)) m[k.toLowerCase()] = headers[k];
    return m;
  }, [headers]);
  ```

### [Medium] [D1] RequestDetailContent 매직 넘버 및 상수
- 파일: `web/app/components/RequestDetailContent.tsx:101, 521, 961, 908, 988-989, 336, 872`
- 증거:
  ```ts
  setTimeout(() => { ... }, 2000);            // L101,521,961 — copy feedback
  const JSON_PREVIEW_LENGTH = 500;            // L908 (상수화 되어 있음 — OK)
  const isLongDescription = tool.description.length > 300;   // L988
  const displayDescription = expanded ? tool.description : tool.description.slice(0, 300); // L989
  max-h-[600px] overflow-y-auto               // L336
  max-h-96 overflow-y-auto                    // L872
  ```
- 설명: 2000(ms), 300, 600px 등 매직 넘버 산재. CHUNK-FE-01 #67과 동일 맥락 — `web/app/constants/ui.ts`로 승격 필요.
- 수정 제안: `COPY_FEEDBACK_MS=2000`, `TOOL_DESC_PREVIEW_CHARS=300`, `JSON_PREVIEW_CHARS=500`.

### [Medium] [D1] SessionPicker/ProjectPicker: `formatLastMTime`/`formatFirstSeen` 중복
- 파일: `web/app/components/SessionPicker.tsx:86-96`, `web/app/components/ProjectPicker.tsx:17-27`
- 증거: 동일 로직(`yyyy-MM-dd HH:mm` 로컬 포맷)을 두 파일이 각각 정의.
- 설명: `web/app/utils/formatters.ts`(이미 존재, RequestDetailContent에서 사용 중)에 통합 가능.
- 수정 제안: `formatters.ts`의 `formatStableDateTime` 변형 또는 `formatYearToMinute` 신설.

### [Medium] [D1] SessionPicker `handleSelectSession` 에서 현재 프로젝트 그룹 유지 실패 가능
- 파일: `web/app/components/SessionPicker.tsx:186-190`
- 증거:
  ```ts
  const handleSelectSession = (token: string) => {
    setSessionOpen(false);
    if (token === activeSessionId) return;
    navigate(`/requests/${encodeURIComponent(token)}${buildQuery(selectedProject)}`);
  };
  ```
- 설명: `selectedProject`는 `projectParam ?? activeProjectName`(L128). URL에 `?project=`가 없고 기존 activeProjectName이 `"Unknown"` 문자열일 경우 `buildQuery("Unknown")`이 `?project=Unknown`을 URL에 삽입 — 사용자가 직접 타이핑한 것이 아닌데 쿼리 오염.
- 수정 제안: `selectedProject === UNKNOWN_PROJECT`일 때는 `buildQuery("")` 처리.

### [Medium] [D2] RequestDetailContent 따옴표 스타일 혼재
- 파일: `web/app/components/RequestDetailContent.tsx` (single `'`) vs 나머지 청크 5개 파일 (double `"`)
- 설명: 프로젝트 전반에 ESLint/Prettier 규칙이 적용되지 않은 상태로 보임. AI 분석 친화성 저하.
- 수정 제안: Prettier 설정 추가(`"singleQuote": false` 또는 `true` 통일) 후 일괄 fix.

### [Low] [D1] HorizontalSplit: `previousUserSelect`/`previousCursor` cleanup 시 복원 로직이 useEffect cleanup에 누락
- 파일: `web/app/components/HorizontalSplit.tsx:83-90`
- 증거:
  ```ts
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.userSelect = "";   // 이전 값이 아닌 빈 문자열로 리셋
        document.body.style.cursor = "";
      }
    };
  }, []);
  ```
- 설명: onUp 핸들러(L68-69)는 `previousUserSelect`/`previousCursor`로 복원하지만 unmount cleanup은 빈 문자열로만 리셋. 외부 코드가 `body.style.userSelect`를 설정한 상태에서 드래그 중 언마운트되면 그 값이 소실됨.
- 수정 제안: ref로 이전 값 저장 후 cleanup에서 복원. 실무 영향은 미미하므로 Low.

### [Low] [D1] TopNav `handleKeepCurrent`: active 시 preventDefault로 "동일 경로 클릭 무시"는 NavLink 기본 동작과 중복
- 파일: `web/app/components/TopNav.tsx:16-19`
- 증거:
  ```ts
  const handleKeepCurrent =
    (active: boolean) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (active) e.preventDefault();
    };
  ```
- 설명: Remix `NavLink`는 동일 URL 클릭 시 기본적으로 `replace` 내비게이션을 수행하지만, 사이드 이펙트 없음. `preventDefault`는 "현재 path의 `/requests/*` 서브라우트를 유지하기 위함"으로 추정되나 주석 없음.
- 수정 제안: JSDoc 추가 — "Clicking active tab should not reset sub-route (e.g., /requests/:sessionId)".

### [Low] [D1] SessionPicker `shortLabel` 상수 미추출
- 파일: `web/app/components/SessionPicker.tsx:32-35`
- 증거: `sessionId.length > 8` 하드코딩. `SHORT_ID_LEN = 8` 상수화.

### [Low] [D2] RequestDetailContent 이모지 렌더 `'✅ Yes' / '❌ No'`
- 파일: `web/app/components/RequestDetailContent.tsx:418`
- 증거: `{request.body.stream ? '✅ Yes' : '❌ No'}`
- 설명: i18n/접근성 관점에서 텍스트 라벨이 이모지에 의존. 아이콘 컴포넌트로 대체 권장.

---

## 긍정적 관찰

- **HorizontalSplit**은 드래그 중 unmount 케이스까지 고려한 cleanup(L83-90), window-level 리스너 해제(L70-71), ArrowLeft/Right 키보드 접근성(L92-104), `role="separator"`/`aria-valuenow` (L116-119) 등 접근성이 훌륭. 요구사항(state 영속화 금지)에도 부합.
- **SessionPicker `groupSessionsByProject`** 순수 함수 분리 + named export로 단위 테스트 가능 구조(L43-84).
- **ProjectPicker**: 외부 클릭 감지 cleanup(L38-48), ARIA role/aria-expanded/aria-selected 성실.
- **RequestOverviewTable/ResponseOverviewTable**: `OverviewGroup`/`OverviewRow` 타입을 통한 테이블 추상화(L1114-1184) — 선언적이고 확장 용이.
- **beautifyRawJSON**(L899-905)의 원본 키 순서 보존 주석은 AI/인간 분석에 유용한 문서화.

---

## Cross-cutting 리뷰 시 참고 단서

- **CC — Remix 데이터 패턴**: `SessionPicker.tsx:161`의 `fetch DELETE`는 Remix 관례 위반. 프로젝트 전반에 걸쳐 `useFetcher`/route `action` 패턴과 일관되게 사용되는지 교차 확인 필요.
- **CC — Theme/FOUC**: `ThemeToggle.tsx:23-39`의 클라이언트 전용 테마 결정. `web/app/root.tsx`에 SSR 테마 적용 여부 확인 필요(CC 후보).
- **CC — 타입 공유**: `RequestDetailContent.tsx:24-74`의 `Request` interface vs `ConversationThread`의 `any` 그리고 백엔드 `RequestBodySummary`(FIXES #29)의 `interface{}` — FE/BE 타입 공유 DTO 부재를 CC에서 확인.
- **CC — URL 상태 규칙**: `SessionPicker.tsx:189`의 `buildQuery(selectedProject)`와 `ProjectPicker.tsx:50-56`의 "switching projects drops `?sid=`" 정책이 라우트 전반에 일관되는지.
- **CC — 컴포넌트 key 패턴**: `RequestDetailContent` 3곳 + CHUNK-FE-01 4곳 + `ConversationThread` 2곳에서 `key={index}` 패턴 — 프로젝트 전역 고유 key 전략 일괄 적용 필요.
- **CC — any 타입 소실**: CHUNK-FE-01 #62와 본 청크 #2를 묶어 `web/app/types/anthropic.ts` 도입 필요.
