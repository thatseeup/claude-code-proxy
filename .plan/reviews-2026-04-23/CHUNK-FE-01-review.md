# CHUNK-FE-01 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23
- Files reviewed: 9 (2,023 LOC)
- Sampling: none (전량)
- Reviewer: o-web-reviewer subagent
- 스택: React 18 + Remix + Tailwind + lucide-react

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수/컴포넌트 LOC | 최대 중첩 | 최대 파라미터 | import | export |
|---|---|---|---|---|---|---|
| CodeDiff.tsx | 102 | `CodeDiff` ~94 | 4 (JSX) | 3 (props 1개, 구조분해) | 1 | 1 |
| CodeViewer.tsx | 244 | `CodeViewer` ~234 ⚠️ | 5 (JSX) ⚠️ | 3 | 2 | 1 |
| ConversationThread.tsx | 202 | `ConversationThread` ~164 ⚠️ | 5 ⚠️ | 1 | 4 | 1 |
| ImageContent.tsx | 143 | `ImageContent` ~127 ⚠️ | 4 | 1 | 2 | 1 |
| **MessageContent.tsx** | **399 ⚠️** | `ToolDefinition` ~100 ⚠️ | 7 ⚠️ | 1 | 6 | 1 (+2 local) |
| MessageFlow.tsx | 280 | `MessageFlow` ~258 ⚠️ | 6 ⚠️ | 4 | 4 | 1 |
| TodoList.tsx | 189 | `TodoList` ~102 ⚠️ + `TodoItem` ~67 ⚠️ | 4 | 1 | 1 | 1 |
| ToolResult.tsx | 256 | `ToolResult` ~245 ⚠️ | 5 ⚠️ | 3 | 4 | 1 |
| ToolUse.tsx | 208 | `ToolUse` ~195 ⚠️ | 5 ⚠️ | 4 | 5 | 1 |

- 임계값 초과 파일: 1/9 (MessageContent.tsx > 300)
- 임계값 초과 컴포넌트(>50 LOC): 9/9 (전부) — 컴포넌트 특성상 일반적이나 `MessageFlow`, `MessageContent`, `ToolResult`, `ToolUse`, `CodeViewer` 모두 150 LOC 이상
- 중첩 깊이 >4 초과: MessageContent(7), MessageFlow(6), CodeViewer/ConversationThread/ToolResult/ToolUse(5)
- Import 수 모두 ≤ 6 (임계값 25 여유)

### D3 의존성 맵

청크 내 내부 의존:
```
ConversationThread ─► MessageFlow ─► MessageContent
                                        ├─► ToolUse ─► CodeDiff
                                        │             └─► TodoList
                                        ├─► ToolResult ─► CodeViewer
                                        └─► ImageContent
```
- 순환 의존: **없음**
- Fan-out 과다 파일(>25): 없음 (최대 6)
- Fan-in (청크 외 사용자 추정): `ConversationThread`는 외부 라우트에서 호출, 그 외는 상위 컴포넌트 전용
- 외부 의존: `lucide-react`, `react`, `../utils/formatters` (형광표시: 단일 소스 utils)
- 레이어 위반: **없음** (fetch/axios 직접 호출 없음, DB 드라이버 없음)

### D1/D4 패턴 스캔 히트

| 패턴 | 히트 | 차원 | 비고 |
|---|---|---|---|
| `dangerouslySetInnerHTML` | 10 | D4 | MessageContent 6, MessageFlow 1, ToolResult 1, CodeViewer 1, ImageContent 0 (img src 별도) |
| `innerHTML` (직접 DOM) | 0 | D4 | — |
| `eval` / `new Function` | 0 | D4 | — |
| `console.log/debug/warn/error` | 3 | D1 | ConversationThread:57, CodeViewer:131, ToolUse:24 (모두 에러/경고, 잔존 debug 없음) |
| `: any` / `as any` | 11 | D1 | MessageContent(1), MessageFlow(1), ToolResult(1), ConversationThread(3), TodoList(1), ToolUse(1), 기타 |
| 하드코딩 credential | 0 | D1,D4 | — |
| 외부 `<img src={http...}>` | 0 | D4 | ImageContent는 data URI만, rel=noopener 자동(utils formatLargeText L84에 적용됨) |
| React list `key` 누락 | 0 | D1 | 모든 `.map` 렌더에 key 부여 확인 |
| `key={index}` 안티패턴 | 4 | D1 | CodeDiff:65, CodeViewer:202, MessageContent:44/196/265 — 입력 순서 변경 시 상태 꼬임 가능 |

### AI 분석 친화성
- 타입 시그니처 완비도: **약 75%** (9 파일 중 `any` 오염 6개 파일: `content:any`, `input?:Record<string,any>`, `[key:string]:any`)
- 명명 일관성: camelCase 일관. 파일명 ↔ 주 export 일치 OK (9/9)
- 주석 밀도: 낮음~중 (JSX 섹션 구분 주석만 있음, 로직 주석은 MessageContent/ToolResult에 산재)
- 파일 간 중복 로직:
  - `getPriorityColor` / `getStatusIcon` / `getStatusColor` 가 `TodoList`와 내부 `TodoItem`에 **완전 중복** (L28-65 vs L134-171)
  - 코드 diff/코드뷰어에서 유사한 테이블-행 렌더 패턴

## 발견된 이슈 (심각도순)

### [Critical] [D4] MessageContent/MessageFlow가 사용자(대화) 콘텐츠를 `dangerouslySetInnerHTML`로 렌더 — 정규식 기반 HTML 재조립의 안전성이 `formatLargeText`에만 의존
- 파일:
  - `web/app/components/MessageContent.tsx:34,67,143,160,205,357`
  - `web/app/components/MessageFlow.tsx:222`
  - `web/app/utils/formatters.ts:61-96`
- 증거:
  ```tsx
  // MessageContent.tsx:30-36
  if (content.includes('<system-reminder>')) { ... }
  return (
    <div
      className="text-gray-700 ..."
      dangerouslySetInnerHTML={{ __html: formatLargeText(content) }}
    />
  );
  ```
  ```ts
  // formatters.ts:64-84 (escape 후 regex-injection이 다수)
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\n/g, '<br>')
    // ...
    .replace(/(https?:\/\/[^\s<]+)/g,
      '<a href="$1" ... target="_blank" rel="noopener noreferrer">$1</a>')
  ```
- 설명: `escapeHtml`이 `< > " ' &` 를 먼저 치환하므로 현재 구현은 직접적인 `<script>` 주입에는 안전하다. 그러나 (1) 향후 `formatLargeText` 의 regex 중 하나가 re-escape 없이 `$1`을 href 같은 속성 맥락으로 삽입하는 추가 패턴을 끼워 넣을 때 XSS 회귀 위험이 매우 크고, (2) 현재도 URL 정규식이 `javascript:` 스킴까지 제한하지 않음 → regex를 `https?:` prefix만 매칭해 href 주입을 방지하므로 당장은 `javascript:` 주입은 불가. 다만 **공격 표면이 7군데로 퍼져 있고**, Anthropic 메시지(tool result/ system-reminder)가 임의 사용자 입력(Shell stdout, 파일 내용 등)을 담을 수 있어 정규식의 사소한 변경이 즉시 XSS로 번진다. Critical은 방어 심층화 관점.
- 수정 제안:
  1) 단일 렌더 경로로 통일하고 **DOMPurify**로 후처리, 또는
  2) `formatLargeText`를 React 노드 트리(`ReactNode[]`)를 반환하도록 재작성해 `dangerouslySetInnerHTML` 의존 제거. 최소한 `href="$1"` 에 대해 `url.startsWith('https://') || url.startsWith('http://')` 가드와 `URL()` 파싱 기반 안전성 검사 추가.

### [High] [D4] `CodeViewer.highlightCode`의 regex 기반 구문강조가 HTML을 다단계로 덧씌움 — 토큰 경계 오인 시 태그 깨짐/잠재 주입
- 파일: `web/app/components/CodeViewer.tsx:91-123, 208`
- 증거:
  ```tsx
  // L93-96
  let highlighted = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // L118-120
  patterns.forEach(({ regex, class: className }) => {
    highlighted = highlighted.replace(regex, `<span class="${className}">$&</span>`);
  });
  // L208
  <span dangerouslySetInnerHTML={{ __html: highlightCode(line) }} />
  ```
- 설명: `&` 만 escape 하고 `"`, `'` 는 escape 하지 않음. 이후 `replace(/\b([A-Z][a-zA-Z0-9]*)\b/g, '<span class="...">$&</span>')` 등이 이미 만든 `<span class="text-green-400">` 내부 class 속성 값에 매칭될 수 있어 태그가 중첩 손상된다. 또한 `$&`가 원문 그대로 삽입되므로, 다음 패턴 반복 시 **이전 span이 내부적으로 다시 치환되어 HTML 구조가 깨진다** (예: `class` 가 키워드로 매칭). 현재는 `navigator.clipboard` 실패 시 `error`만 로깅하나, 시각적 오동작에 그치지 않고 class 주입 시 스타일 깨짐/추후 취약성 회귀 여지가 있다.
- 수정 제안: `Prism.js` / `highlight.js` / `shiki`(Remix 친화) 사용, 자체 regex 제거. 자체 유지 시 AST 토크나이저 또는 최소한 **단일 패스 토큰화 후 React 노드 생성**으로 전환.

### [High] [D2] MessageContent.tsx 399 LOC · 3 컴포넌트 · 중첩 7단 — 단일 파일 과대
- 파일: `web/app/components/MessageContent.tsx:1-399`
- 증거: `MessageContent`(L23-132) + `ToolDefinitions`(L135-210) + `ToolDefinition`(L213-313) + `SystemReminderContent`(L316-399). 내부 JSX 중첩: L193-199 → L258-298에서 `{isExpanded && ... {Object.entries(...).map(... <div><div><span>...`) 약 7단.
- 설명: 파일 크기/중첩 모두 임계값 초과. 세 컴포넌트가 서로 강결합되어 있지 않으므로 분할 안전.
- 수정 제안: `MessageContent.tsx`(엔트리), `ToolDefinitions.tsx`, `ToolDefinition.tsx`, `SystemReminderContent.tsx` 4개로 분리. 공용 `formatLargeText` import만 유지.

### [High] [D2] MessageFlow.tsx 280 LOC · 단일 컴포넌트 · 중첩 6단 — 렌더 책임 과다
- 파일: `web/app/components/MessageFlow.tsx:22-281`
- 증거: `getRoleConfig`(45 LOC switch) + `extractNonSystemContent`/`getContentPreview`/`shouldShowExpander`/`formatTimestamp` 4개 헬퍼 + 거대 JSX(L157-280). JSX 내부 `<div><div><div>...<div><button>` 6단.
- 수정 제안:
  - `utils/messagePreview.ts`로 `extractNonSystemContent` / `getContentPreview` / `shouldShowExpander` 이동 (순수 함수)
  - `components/MessageFlow/RoleBadge.tsx`로 `getRoleConfig` 표현 분리
  - 본 파일은 ≤ 150 LOC를 목표로 축소

### [High] [D2] ToolResult.tsx 256 LOC · 다중 책임
- 파일: `web/app/components/ToolResult.tsx:12-256`
- 증거: 코드 감지(`isCodeContent` L16-44), 포맷 선택(`getDisplayContent` L67-95), UI 설정(`getResultConfig` L109-134), JSX 렌더(L137-255) 한 컴포넌트에서 수행.
- 수정 제안:
  - `utils/toolResultDetect.ts`로 `isCodeContent`, `extractCodeFromCatN`, `getDisplayContent` 이동
  - 본 컴포넌트는 렌더에만 집중

### [High] [D3] TodoList.tsx가 `getPriorityColor` / `getStatusIcon` / `getStatusColor`를 부모와 자식에서 **완전 중복 정의**
- 파일: `web/app/components/TodoList.tsx:28-65, 134-171`
- 증거:
  ```tsx
  // L28-39 (TodoList)
  const getPriorityColor = (priority: string) => { switch (priority) { ... } };
  // L134-145 (TodoItem) — 동일
  const getPriorityColor = (priority: string) => { switch (priority) { ... } };
  ```
- 설명: 부모 `TodoList`는 자신의 `getPriorityColor`/`getStatusIcon`을 **사용하지 않는다**(실제 렌더는 `TodoItem`이 담당). 부모의 세 함수는 **전부 dead code**.
- 수정 제안: 부모 정의 삭제. 자식 정의를 모듈 최상위 `const`로 끌어올려 재랜더마다 재생성 방지.

### [High] [D1] `key={index}`/`key={idx}` 사용 — 재정렬/삽입 시 상태 꼬임
- 파일:
  - `web/app/components/CodeDiff.tsx:65` (`key={idx}` — 라인 목록)
  - `web/app/components/CodeViewer.tsx:202` (`key={idx}` — 라인 목록)
  - `web/app/components/MessageContent.tsx:44` (`key={index}` — content 블록)
  - `web/app/components/MessageContent.tsx:196` (`key={index}` — 툴 정의)
  - `web/app/components/MessageContent.tsx:265` (`key={name}` OK, 그러나 L196/L44는 인덱스)
- 증거:
  ```tsx
  // MessageContent.tsx:43-48
  {content.map((item, index) => (
    <div key={index} className="content-block">
      <MessageContent content={item} />
    </div>
  ))}
  ```
- 설명: 코드뷰/diff는 불변 리스트라 상대적으로 안전. 그러나 MessageContent의 **대화 content 블록**은 중간 삽입·필터링이 빈번하며(`SystemReminderContent.parts` 중간 reminder 파싱), 인덱스 키는 내부 상태(`ToolDefinition`의 `showDetails`, `SystemReminderContent`의 `showReminders`)가 잘못된 아이템으로 이월되는 리스크가 있다.
- 수정 제안: content 블록에 안정 키 (`item.id` 또는 `${item.type}-${hash(item.text||JSON.stringify(item)).slice(0,8)}`). 코드뷰 라인은 현행 유지 가능.

### [High] [D1] `content: any` / `message: any` / `input?: Record<string, any>` — 타입 안전성 전면 소실
- 파일:
  - `web/app/components/MessageContent.tsx:11,20` (`content?: any`, `ContentItem | ContentItem[] | string`)
  - `web/app/components/MessageFlow.tsx:8` (`content: any`)
  - `web/app/components/ToolResult.tsx:7` (`content: any`)
  - `web/app/components/ConversationThread.tsx:19,31,64` (`message: any`, `content: any`, `parsedMessage: any`)
  - `web/app/components/TodoList.tsx:11` (`[key: string]: any`)
- 증거:
  ```tsx
  // MessageContent.tsx:8-21
  interface ContentItem {
    type: string;
    text?: string;
    content?: any;
    name?: string;
    id?: string;
    input?: Record<string, any>;
    tool_call_id?: string;
    is_error?: boolean;
  }
  ```
- 설명: Anthropic Messages API 의 block union(`text | tool_use | tool_result | image`)은 공식 SDK 타입이 존재하며, discriminated union으로 타입화 가능. 현재는 switch case마다 런타임 분기로 대체되어 있어 AI/IDE 분석 친화성이 낮다.
- 수정 제안: `web/app/types/anthropic.ts` 도입 (또는 `@anthropic-ai/sdk` 타입 사용), `ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock`로 정의. `MessageFlow`의 `content` 역시 같은 유니온 + `string` 허용.

### [High] [D1] ConversationThread: `analyzeConversationFlow`가 매 렌더마다 JSON.parse 수행 — 재랜더 비용/메모이제이션 누락
- 파일: `web/app/components/ConversationThread.tsx:52-109`
- 증거:
  ```tsx
  const analyzeConversationFlow = () => { /* forEach messages + JSON.parse */ };
  const messages = analyzeConversationFlow();  // 매 렌더
  ```
- 설명: `expandedSections` 토글마다 `conversation.messages`(수백개 가능)를 재파싱. `MessageFlow`에 새 객체가 전달되어 하위 트리 재랜더 유발.
- 수정 제안: `useMemo(() => analyzeConversationFlow(), [conversation])` 적용. 각 `MessageFlow` 는 `React.memo` + stable key(`msg.uuid`) 도입.

### [High] [D1] MessageFlow: `conversation.sessionId`+index 조합 키로 React 엘리먼트 ID 부여 — 정렬/중간 삽입 시 상태 이월
- 파일: `web/app/components/ConversationThread.tsx:169`
- 증거:
  ```tsx
  key={`${conversation.sessionId}-${index}`}
  ```
- 설명: 원본 JSONL 메시지에는 `uuid` 가 있음에도 사용하지 않음. `MessageFlow.isExpanded` 상태가 index로 고정되어, 메시지 삽입/필터 시 다른 메시지에 귀속되는 버그 가능.
- 수정 제안: `key={msg.uuid ?? \`${conversation.sessionId}-${index}\`}` 로 폴백 구조 사용.

### [Medium] [D2] ImageContent: 두 상태(`isFullscreen`, `imageError`)가 상호 배타적이나 분리되어 있음 + modal close 핸들러 2개 중복
- 파일: `web/app/components/ImageContent.tsx:17-141`
- 증거: L119 배경 클릭 닫기 + L124-127 X 버튼 모두 `setIsFullscreen(false)`. `e.stopPropagation` 분기가 2곳(L124, L137)에 흩어져 있어 수정 시 실수 유발.
- 수정 제안: 단일 `closeFullscreen` 콜백 추출. 상태를 `status: 'ok' | 'error' | 'fullscreen'` 등 단일 enum 으로 합칠지 검토.

### [Medium] [D1] `CodeViewer.getLanguageFromFileName`이 71개 매핑을 함수 내부 리터럴로 보유 — 렌더마다 재생성
- 파일: `web/app/components/CodeViewer.tsx:20-86`
- 증거: `languageMap` 객체가 함수 스코프 내에 정의되어 매 호출(`detectedLanguage` 계산 시) 새로 생성.
- 수정 제안: 모듈 최상위 `const LANGUAGE_MAP = { ... } as const` 로 분리. `highlightCode.patterns` 도 동일 처리.

### [Medium] [D1] 매직 넘버 다수 — 500/300/200/100/10/16384 등
- 파일:
  - `web/app/components/ToolResult.tsx:98,100` (`500`)
  - `web/app/components/MessageFlow.tsx:91,112,121,130,138` (`300`)
  - `web/app/components/ToolUse.tsx:30` (`200`)
  - `web/app/components/CodeViewer.tsx:129` (`2000` timeout)
  - `web/app/components/ImageContent.tsx:53` (`Date.now()` 파일명)
- 증거:
  ```tsx
  const isLargeContent = displayContent.length > 500; // ToolResult.tsx:98
  return nonSystemContent.length > 300 ? nonSystemContent.substring(0, 300) + '...' : ...; // MessageFlow.tsx:91
  ```
- 수정 제안: `web/app/constants/ui.ts` 신설 — `LARGE_RESULT_THRESHOLD_CHARS = 500`, `MESSAGE_PREVIEW_CHARS = 300`, `LONG_PARAM_CHARS = 200`, `COPY_FEEDBACK_MS = 2000`.

### [Medium] [D2] ToolUse: `renderParameterValue` 가 `isExpanded` 플래그 하나를 "파라미터 보기/숨기기"와 "큰 문자열 보기/숨기기" 두 용도로 공용 → UX 혼선
- 파일: `web/app/components/ToolUse.tsx:14-64, 137-190`
- 증거:
  ```tsx
  const [isExpanded, setIsExpanded] = useState(false);
  // L36: renderParameterValue 내부 큰 문자열 토글
  onClick={() => setIsExpanded(!isExpanded)}
  // L148: 파라미터 전체 expand/collapse
  onClick={() => setIsExpanded(!isExpanded)}
  ```
- 설명: 큰 파라미터 1개를 열면 다른 "모든 파라미터 보기"도 동시에 전환됨.
- 수정 제안: `isParamsExpanded`, `expandedLargeParamKeys: Set<string>` 두 상태로 분리.

### [Medium] [D2] MessageContent/MessageFlow에 동일한 `<system-reminder>` 처리 로직이 중복
- 파일:
  - `web/app/components/MessageContent.tsx:316-399` (`SystemReminderContent`, 정규식 기반 split)
  - `web/app/components/MessageFlow.tsx:78-82` (`extractNonSystemContent` — 미리보기용 split)
- 증거: 동일한 `/<system-reminder>[\s\S]*?<\/system-reminder>/g` 패턴이 두 파일에 분산.
- 수정 제안: `web/app/utils/systemReminder.ts`로 `splitSystemReminders(text) → {text[], reminder[]}` 추출 후 양쪽에서 재사용.

### [Medium] [D1] MessageFlow: `<div>` JSX 내부 템플릿 문자열 `\\n` (escaped) — literal `\n`이 아니라 두 글자 `\n` 리터럴 출력
- 파일: `web/app/components/MessageFlow.tsx:102,137`
- 증거:
  ```tsx
  .join('\\n'); // 실제 값은 두 글자 '\' + 'n'
  ```
- 설명: `extractNonSystemContent`의 결과들을 합칠 때 `'\\n'`으로 조인하면 미리보기 텍스트에 `"\\n"` 리터럴이 남는다 (사용자에게 노출될 위험).
- 수정 제안: `'\n'` 으로 교체.

### [Medium] [D1] ConversationThread: 시스템 메시지 "Latest: " 라벨이 매 렌더마다 `new Date()` 호출로 매번 현재 시각을 갱신
- 파일: `web/app/components/ConversationThread.tsx:194`
- 증거: `<span>Latest: {formatStableTime(new Date())}</span>` — 실제 대화의 최신 시각이 아닌 현재 시각.
- 수정 제안: `messages.at(-1)?.timestamp` 또는 `conversation.endTime` 사용.

### [Medium] [D1] ToolResult: `isCodeContent`의 `content.includes('{') && content.includes('}')` 과탐 — 일반 JSON/prose도 코드 블록으로 오인
- 파일: `web/app/components/ToolResult.tsx:37`
- 증거:
  ```tsx
  content.includes('{') && content.includes('}') // L37, && 우선순위도 OR 체인과 혼재
  ```
- 설명: 논리 우선순위: `||` 체인 중간에 `A || B || (C && D)`가 아니라 `A || B || ... || C && D` 로 해석됨. 작성자가 의도한 괄호 아님. 또한 JSON 출력을 `Code`로 잘못 라우팅해 `CodeViewer`로 전달됨.
- 수정 제안: `||` 체인 외부에 괄호 명시 `(content.includes('{') && content.includes('}'))`. 또는 `includes` 세트를 `const marker = [...]` 배열화.

### [Medium] [D1] ConversationThread: 미사용 import `formatLargeText`, `ArrowRight`
- 파일: `web/app/components/ConversationThread.tsx:1,4`
- 증거: `formatLargeText`는 import되나 본문 미사용. `ArrowRight` 역시 미사용.
- 수정 제안: 제거.

### [Medium] [D1] TodoList: `TodoList` 컴포넌트 내부의 `getPriorityColor`/`getStatusIcon`/`getStatusColor`가 미사용
- (High 항목과 동일 원인이나 Dead code 관점에서 별도 기록)
- 파일: `web/app/components/TodoList.tsx:28-65`
- 수정 제안: High 이슈 수정 시 함께 제거.

### [Medium] [D4] `window.URL.createObjectURL` 의 revoke 타이밍이 `click()` 직후 — Safari에서 다운로드 취소 가능
- 파일: `web/app/components/CodeViewer.tsx:135-145`
- 증거:
  ```tsx
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url); // 즉시 revoke
  ```
- 설명: 일부 브라우저에서 `click()` 이후 동기 revoke 시 실제 다운로드가 중단될 수 있음. 또한 XSS 관점에서 큰 issue는 아니나 신뢰성 문제.
- 수정 제안: `setTimeout(() => URL.revokeObjectURL(url), 1000)` 또는 `requestAnimationFrame`.

### [Low] [D2] 모든 컴포넌트가 동일 Tailwind 카드 셸(`rounded-xl p-5 shadow-sm`) 중복
- 수정 제안: `components/ui/Card.tsx`로 추출.

### [Low] [D1] `TodoList` Todo 인터페이스의 `[key: string]: any` — 추가 프로퍼티 자유화
- 파일: `web/app/components/TodoList.tsx:11`
- 수정 제안: 실제 사용처 수집 후 `Record<'task'|'description'|..., string | undefined>`로 축소.

### [Low] [D2] MessageFlow의 `getContentPreview`/`shouldShowExpander`가 유사한 분기 로직 3회 반복(string/array/other)
- 수정 제안: 공통 `summarizeContent(content) → { preview, isExpandable }` 단일 함수화.

### [Low] [D1] CodeViewer `lang` 매핑에 `bash/fish/zsh` 등 다수 — 언어 판별 실제로는 하이라이팅에 사용되지 않음(span class만 달려 있고 언어별 분기 없음)
- 파일: `web/app/components/CodeViewer.tsx:20-88, 91-123`
- 수정 제안: 표시용으로만 쓰이는 `detectedLanguage` UI 배지는 현행 유지, 하이라이터 교체 시 언어별 정확성 확보.

## 긍정적 관찰

- `formatters.ts`가 **escapeHtml을 항상 선행 적용**하도록 일관성 유지 → XSS 1차 방어선 확립
- 구조분해 props / TS interface 선언이 대체로 명시적
- lucide-react 아이콘 사용 일관
- 컴포넌트 파일명 ↔ 기본 export 명 완전 일치 (AI 탐색 친화)
- 순환 의존 없음, fan-out 낮음 — 리팩토링 시 영향범위 작음
- 각 컴포넌트가 local state만 사용, 전역 상태 남용 없음

## Cross-cutting 리뷰 시 참고 단서

- **CC XSS 방어선**: 청크 내 `dangerouslySetInnerHTML` 진입점은 전부 `formatLargeText` 단일 의존. `CodeViewer.highlightCode`는 **별도 경로** 이므로 CC에서 규칙 통일 필요. (DOMPurify 도입 여부를 CC 차원에서 결정)
- **CC 타입 계약**: Anthropic Messages API content block 타입이 BE `proxy/internal/model/models.go` 와 FE `ContentItem` 양쪽에서 중복/상이 정의. BE/FE 타입 공유(OpenAPI/codegen) 도입 검토.
- **CC 상태 키 안정성**: `MessageFlow`의 index key 문제는 `ConversationThread`의 uuid 보존과 연동. JSONL `uuid` 가 존재하므로 모든 경로에서 `msg.uuid` 우선 사용 규약 필요.
- **CC 보안 헤더**: FE가 `dangerouslySetInnerHTML`을 사용하는 한, BE(CHUNK-BE-02 #24/#25) CSP/X-Frame-Options 도입과 함께 **`script-src 'self'; object-src 'none'`** 설정이 실제로 FE 렌더링에 영향 없는지 점검 필요.
- **CC 대화 렌더 페이지**: `ConversationThread` fan-in 탐색 시 Remix route 파일을 함께 보고 SSR/hydration 경계에서 `formatLargeText` 결과가 서버/클라 동일한지(regex의 locale/typography 출력) 확인.
