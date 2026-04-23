# CHUNK-SH-01 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23T00:00:00Z
- Files reviewed: 3 (460 LOC)
  - `web/app/tailwind.css` — 197 LOC
  - `web/app/utils/formatters.ts` — 232 LOC
  - `web/app/utils/models.ts` — 31 LOC
- Sampling: none
- Reviewer: o-web-reviewer subagent

---

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 | 최대 파라미터 | import | export |
|---|---|---|---|---|---|---|
| web/app/tailwind.css | 197 | N/A (CSS) | 2 (@layer) | N/A | 0 | 0 |
| web/app/utils/formatters.ts | 232 | 36 (`formatLargeText` L61-96, 14 replace 체인) | 3 (try/replace/ternary) | 2 (`truncateText`, `createContentPreview`) | 0 | 13 |
| web/app/utils/models.ts | 31 | 3 (`isOpenAIModel`) | 1 | 2 (`getChatCompletionsEndpoint`) | 0 | 3 |

- 임계값 초과 없음.

### D3 의존성

- 외부 import 모듈 수: **0** (세 파일 모두 외부 의존 없음 — pure utils)
- Fan-out 과다 파일(>25): 없음
- Fan-in 추정(grep 기준):
  - `formatters.ts` → 7개 컴포넌트/라우트에서 참조 (ConversationThread, MessageFlow, MessageContent, RequestDetailContent, ToolUse, ToolResult, requests.$sessionId.tsx)
  - `models.ts` → 2개 참조 (RequestDetailContent)
  - `tailwind.css` → `root.tsx` 1회 import
- 순환 의존 후보: 없음

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 |
|---|---|---|
| 비밀 패턴 (api_key/secret/password/token) | 0 | D1, D4 |
| 디버그 로그 (console.*/print/Println) | 0 | D1 |
| `any` 남용 | **5** (formatters.ts L8, 38, 101, 212, 218) | D1 |
| SQL injection 의심 | 0 | D4 |
| XSS 의심 (`dangerouslySetInnerHTML` 소비자 다수) | **10** (호출부) — formatters.ts의 `formatLargeText`가 원천 | **D4** |
| eval/exec/new Function | 0 | D4 |
| CORS 와일드카드 | 0 | D4 |
| 민감 정보 로깅 | 0 | D4 |

### AI 분석 친화성

- JSDoc 완비도: `formatters.ts` 13/13 export 전원 JSDoc, `models.ts` 3/3 JSDoc — **100%**.
- 타입 시그니처 완비도: `models.ts` 100% (정확한 union 반환). `formatters.ts` 5개 함수 시그니처에 `any` — **~61%**.
- 명명 일관성: camelCase 일관. 단 `formatters.ts` 내부에서 `timestamp: string | Date`(L119)와 `DateInput`(L153) 두 형태가 유사 목적으로 공존 → 약한 불일치.
- 파일명 ↔ 주 export 일치: `formatters.ts`(다수 format*) OK, `models.ts`(isOpenAIModel 등 모델 헬퍼) OK, `tailwind.css` OK.
- 주석 밀도: `formatters.ts`에 함수 단위 JSDoc + `formatLargeText` 내부 섹션 주석 양호.

---

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D4] `formatLargeText`의 HTML 생성 로직이 공격 표면 — 현재는 사전 `escapeHtml`로 완화되지만 깨지기 쉬운 계약

- 파일: `web/app/utils/formatters.ts:61-96`
- 증거:
  ```ts
  export function formatLargeText(text: string): string {
    if (!text) return '';
    // Escape HTML first
    const escaped = escapeHtml(text);
    return escaped
      .replace(/\n\n/g, '<br><br>')
      ...
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" class="..." target="_blank" rel="noopener noreferrer">$1</a>')
      ...
  ```
- 설명:
  1. 입력을 먼저 `escapeHtml`(L49-56)로 이스케이프한 뒤 정규식으로 `<br>`, `<a href="$1">`, `<code>` 등을 재주입하므로 **원칙적으로 XSS는 차단됨**(결과는 10곳의 `dangerouslySetInnerHTML`로 주입: `MessageContent.tsx:34/67/143/160/205/357`, `MessageFlow.tsx:222` 등).
  2. 그러나 URL 치환 `replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">...')`은 이미 이스케이프된 텍스트에서 실행되므로 URL 안에 원래 포함되었던 `"`/`'`/`<`/`>` 는 이미 엔티티(`&quot;` 등)로 바뀌어 있다. 따라서 `href="$1"` 자체가 속성값을 깨뜨릴 여지는 적다. **그럼에도 `javascript:` 스킴은 이 정규식에 매칭되지 않지만**, 향후 정규식을 완화(예: `[a-z]+:\/\/`)하거나 `escapeHtml` 호출이 제거되는 순간 즉시 저장형 XSS가 된다.
  3. `formatLargeText`가 반환한 HTML은 `DOMPurify` 등의 화이트리스트 sanitizer를 통과하지 않고 그대로 innerHTML에 주입된다. 서버 백엔드가 로깅한 요청/응답 본문이 소스이므로, 공격자가 Claude API를 경유해 악성 payload를 넣을 수 있으면 관리자 웹 UI의 `dangerouslySetInnerHTML` 경로에서 렌더된다.
- 수정 제안:
  - `DOMPurify.sanitize(result, { ALLOWED_TAGS: [...], ALLOWED_ATTR: ['href','class','target','rel'] })`를 최종 반환 직전에 적용하고, `a` 태그 href에 대해 `allowedSchemes: ['http','https']` 강제.
  - 또는 `dangerouslySetInnerHTML` 전체를 걷어내고 `react-markdown` + `remark-gfm` + `rehype-sanitize` 조합으로 대체 (FE-01 연결 과제).
  - 최소 변경: `formatLargeText` 내부에서 URL 치환 전에 `url.startsWith('http://') || url.startsWith('https://')` 이중 가드를 추가하고, 단위 테스트(`<script>`, `javascript:`, `on*=`, `data:text/html`)를 고정.

### [High] [D1,D2] `formatLargeText`의 정규식 치환이 14단계 파이프라인 — 순서 의존성으로 인해 깨지기 쉽고 테스트 부재

- 파일: `web/app/utils/formatters.ts:68-95`
- 증거:
  ```ts
  return escaped
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>')
    .replace(/^(\s*)([-*•])\s+(.+)$/gm, '$1<span ...>...</span>')
    .replace(/^(\s*)(\d+)\.\s+(.+)$/gm, '$1<span ...>$2</span><span>$3</span></span>')
    .replace(/^([A-Z][^<\n]*:)(<br>|$)/gm, '<div ...>$1</div>$2')
    .replace(/\b([A-Z_]{3,})\b/g, '<code ...>$1</code>')
    .replace(/\b([a-zA-Z0-9_-]+\.[a-zA-Z]{2,4})\b/g, '<span ...>$1</span>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" ...>$1</a>')
    .replace(/^(\s*)([""](.+?)[""])/gm, '$1<blockquote ...>$3</blockquote>')
    ...
    .replace(/\*\*([^*]+)\*\*/g, '<strong ...>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em ...>$1</em>')
    .replace(/`([^`]+)`/g, '<code ...>$1</code>');
  ```
- 설명:
  1. 줄바꿈을 먼저 `<br>`로 치환한 뒤에 bullet/header/blockquote가 `^`/`$` 다중행 앵커로 매칭된다. 그러나 `^...:$` 헤더 치환(L78)은 `(<br>|$)`를 뒤에 둬서 이미 `<br>`가 주입된 상태를 가정하므로 **순서 의존**이 강하다. 입력에 콜론이 포함된 일반 문장("This is: a test.")도 대문자로 시작하면 전체가 `<div border-b>`로 감싸진다 → 렌더 오염.
  2. `\b([A-Z_]{3,})\b` (L80)는 모든 3자 이상 대문자 토큰(`JSON`, `HTTP`, `ID`, 사용자 변수명)을 자동으로 `<code>`화. `API_KEY`, `BEARER` 같은 토큰이 본문에 있으면 의도치 않게 강조 + 레이아웃 변화.
  3. `\b([a-zA-Z0-9_-]+\.[a-zA-Z]{2,4})\b` (L82)는 파일명을 추정하지만 `www.google.com`의 `google.com`, `req.body`의 `req.body`, 도메인, `v1.0` 등 오탐 다수. URL 치환(L84)보다 먼저 실행되어 URL 내부의 `.com`이 먼저 span으로 감싸져 URL 치환이 깨질 수 있음.
  4. `\*([^*]+)\*/g` emphasis(L93)가 bullet 치환(L74)의 `[-*•]` 뒤에 오므로, bullet `*`가 이미 span에 먹힌 뒤에도 다른 `*...*` 쌍이 있으면 정상. 그러나 입력에 `a*b*c*d`처럼 세 쌍이면 greedy 매칭 없이 첫 짝을 em으로 만들고 `*d`는 남는다.
  5. **단위 테스트 부재.** `web/app/utils/*.test.ts` 없음. 정규식 파이프라인은 회귀가 매우 쉬우나 안전망이 없다.
- 수정 제안:
  - 짧은 단계별 순수 함수(`escape → breaks → lists → headers → code → paths → links → quotes → emphasis`)로 분해하고, 각 단계에 Vitest 스냅샷 테스트(`formatLargeText.spec.ts`) 추가.
  - 대문자 토큰/파일명 추정 규칙은 false positive 비율이 높으므로 삭제하거나, 명시적 delimiter(예: `` `` `` ``)로만 작동하도록 축소.
  - 장기: `react-markdown` 도입으로 정규식 파이프라인을 교체 (FE-01과 공유 과제).

### [High] [D1] `any` 타입 남용 — 5개 공개 API

- 파일: `web/app/utils/formatters.ts:8, 38, 101, 212, 218`
- 증거:
  ```ts
  export function formatValue(value: any): string { ... }               // L8
  export function formatJSON(obj: any): string { ... }                   // L38
  export function isComplexObject(value: any): boolean { ... }           // L101
  export function createContentPreview(content: any, maxLength ...)     // L212
      const textContent = content.find(c => c.type === 'text')?.text    // L218 (암묵적 any)
  ```
- 설명: 해당 함수들은 `formatters.ts`가 외부 컴포넌트에서 7곳 이상 참조되는 유틸이므로 `any`는 호출부 전체로 전파된다. `formatValue`/`formatJSON`은 `unknown`으로, `createContentPreview`는 `MessageContentBlock` union 타입으로 좁힐 수 있다 (FE-01 리포트 #62, FE-03 #96에 공용 타입 도입 TODO가 이미 등록됨). 본 청크에서는 의존이 단절되어 있으므로 **1차적으로는 `unknown` 교체만으로도 안전성이 크게 개선**된다.
- 수정 제안:
  - `formatValue/formatJSON/isComplexObject`: `unknown` 전환 + in-body `typeof`/`Array.isArray` narrowing (이미 내부 분기는 있음).
  - `createContentPreview`: `ContentBlock[] | { text?: string } | string`로 좁히고 FE-01 공용 `types/anthropic.ts` 도입 시 대체.

### [High] [D2] tailwind.css 다크모드 오버라이드 105줄이 단일 `@layer components` 블록에 평면 나열 — 유지보수성 저하

- 파일: `web/app/tailwind.css:13-117`
- 증거:
  ```css
  @layer components {
    html.dark .bg-white { background-color: #0f172a; }
    html.dark .bg-gray-50 { background-color: #111827; }
    ...  (85개 라인 연속)
    html.dark .from-emerald-50 { --tw-gradient-from: rgba(6, 78, 59, 0.35) ...; }
    ...
  }
  ```
- 설명:
  1. Tailwind v3의 `darkMode: 'class'` 설정을 쓰는 프로젝트에서 `dark:bg-*` 유틸리티를 컴포넌트에 직접 붙이는 것이 정석이나, 이 파일은 **라이트 유틸리티 클래스 자체를 다크에서 재정의**해 모든 컴포넌트를 다크로 끌어내린다. 주석(L4-12)에 의도는 명시되어 있지만, Tailwind가 JIT에서 생성하는 CSS 순서/특이도를 덮어쓰는 방식이라 업그레이드/버전 변경 시 회귀 위험이 크다.
  2. `html.dark .text-gray-600` (L25) 과 `html.dark .text-gray-500` (L26)이 동일 색상 `#94a3b8` — 의도인지 버그인지 불분명 (주석 없음).
  3. 색상 리터럴이 전부 인라인 hex/rgba. `tailwind.config.*`의 `theme.extend.colors`/CSS 변수로 중앙화하면 팔레트 변경 1곳에서 반영 가능.
- 수정 제안:
  - 중기: CSS 변수 도입 `:root { --surface: #fff } html.dark { --surface: #0f172a }` 후 컴포넌트에서 `bg-[var(--surface)]` 사용.
  - 단기: 섹션별 주석/블록 분리 (`/* Surfaces */`, `/* Text */`, `/* Borders */`, `/* Gradients */`, `/* Scrollbar */`).
  - `text-gray-600`/`text-gray-500` 동일값은 의도 여부 확인 후 한쪽 제거 혹은 주석화.

### [High] [D1] `formatFileSize(0)` 특수 처리 누락 분기 — 음수/NaN 미가드

- 파일: `web/app/utils/formatters.ts:202-207`
- 증거:
  ```ts
  export function formatFileSize(bytes: number): string {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
  ```
- 설명:
  1. `bytes < 0`일 때 `Math.log(음수) = NaN` → 반환값 `NaN undefined`.
  2. `bytes >= 1024^4` (TB 이상)일 때 `i=4`, `sizes[4]=undefined` → `"1024.00 undefined"`.
  3. `NaN`/`Infinity` 미가드.
- 수정 제안:
  ```ts
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  ```

### [High] [D1] `isOpenAIModel`의 `startsWith('o')` 과잉 매칭 — Anthropic/기타 벤더 오분류 위험

- 파일: `web/app/utils/models.ts:10-13`
- 증거:
  ```ts
  export function isOpenAIModel(model: string | null | undefined): boolean {
    if (!model) return false;
    return model.startsWith('gpt-') || model.startsWith('o');
  }
  ```
- 설명:
  1. `startsWith('o')`는 OpenAI의 o1/o3/o4 시리즈를 겨냥한 것으로 보이나, 실제로는 알파벳 `o`로 시작하는 **모든 문자열**을 매칭한다: `ollama/llama3`, `open-mistral`, 가상의 `opus-4`, `other-model-name` 등. 이 청크에서 `getProviderName`은 `'OpenAI' | 'Anthropic'` 이분법을 쓰므로 `ollama/*` 모델도 'OpenAI'로 분류된다 → `getChatCompletionsEndpoint`도 잘못된 `/v1/chat/completions`를 돌려준다.
  2. 현재 백엔드 라우팅(CHUNK-BE-01 리뷰 기준)은 config 기반 라우터를 쓰므로 UI 표시만 어긋날 수 있으나, 사용자에게 오도되는 정보(Target Endpoint 표시, Provider 뱃지)를 보여줘 디버깅을 방해한다.
- 수정 제안:
  ```ts
  const OPENAI_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-', 'text-embedding-'];
  return OPENAI_PREFIXES.some(p => model.startsWith(p));
  ```
  혹은 backend가 이미 `routedModel`을 돌려주므로, UI는 backend가 추가로 제공하는 `provider` 필드를 직접 소비하도록 변경 (근본 해결).

### [Medium] [D1] `formatTimestamp` 경계값/로케일 일관성 문제

- 파일: `web/app/utils/formatters.ts:119-151`
- 증거:
  ```ts
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }
  ...
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  ```
- 설명:
  1. 미래 시각(`diff < 0`)일 경우 `-5m ago` 처럼 음수가 찍힌다 (시계 동기화 어긋남, SSR-Client 간 hydration timing).
  2. 1일 경과 시 `toLocaleTimeString`은 **클라이언트 로케일**에 따라 다르게 렌더되어 SSR hydration mismatch 가능. 같은 파일에 `formatStableDateTime`(L188)라는 SSR-safe 대안이 이미 있는데 `formatTimestamp`만 unsafe.
  3. `formatStableDate/Time/DateTime`은 로컬 타임존(`getFullYear`/`getMonth`)에 의존 — SSR과 클라 타임존이 다르면 하이드레이션 경고.
- 수정 제안:
  - `diff < 0`일 때 `formatStableDateTime(timestamp)`로 폴백.
  - 하이드레이션 안정성을 위해 `formatTimestamp`는 클라이언트 effect 이후에만 렌더하거나(`useMounted`), UTC 기반으로 고정.
  - `formatStable*` 3종에 `Date.prototype.getUTC*` 버전을 추가 export.

### [Medium] [D1,D2] `DateInput` 타입과 `formatTimestamp`의 `string | Date` 시그니처 불일치

- 파일: `web/app/utils/formatters.ts:119, 153`
- 증거:
  ```ts
  export function formatTimestamp(timestamp: string | Date): string { ... }   // L119
  export type DateInput = string | number | Date | null | undefined;           // L153
  function toValidDate(input: DateInput): Date | null { ... }
  ```
- 설명: 같은 파일 안에 날짜 입력 타입이 두 계통으로 공존. `formatTimestamp`는 `number`/`null`/`undefined`/빈 문자열을 받지 못해 호출부가 방어 로직을 중복 작성해야 한다.
- 수정 제안: `formatTimestamp` 시그니처를 `(timestamp: DateInput) => string`으로 넓히고 진입부에 `toValidDate`를 사용한다.

### [Medium] [D1] `escapeHtml`이 대체 시퀀스를 `String(text)` 이후 `.replaceAll` 5회 — Node/브라우저 구형 미지원 + 성능

- 파일: `web/app/utils/formatters.ts:49-56`
- 증거:
  ```ts
  export function escapeHtml(text: string): string {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
  ```
- 설명:
  1. `String.prototype.replaceAll`은 Node 15+/모던 브라우저에서만 지원. `package.json`/`tsconfig`의 타겟이 `es2021+`라면 OK이나, 현재 타겟은 확인되지 않음. 구형 타겟이면 런타임 에러.
  2. 5회 문자열 복사 → 긴 입력에서 비효율. 단일 `.replace(/[&<>"']/g, ch => map[ch])`가 더 빠르고 호환성 높음.
- 수정 제안:
  ```ts
  const ESC: Record<string,string> = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
  return String(text).replace(/[&<>"']/g, c => ESC[c]);
  ```

### [Medium] [D2] `formatters.ts` 232 LOC에 포매팅/파싱/미리보기/날짜 유틸이 혼재 — 파일 책임 분산

- 파일: `web/app/utils/formatters.ts` 전역
- 증거: 13개 export — `formatValue/formatRawHeaders/formatJSON/escapeHtml/formatLargeText/isComplexObject/truncateText/formatTimestamp/formatStableDate/formatStableTime/formatStableDateTime/formatFileSize/createContentPreview`.
- 설명: 임계값(300 LOC) 미만이지만, 주제가 4가지(HTML escape & markup, JSON, 날짜, 크기·미리보기)로 분산되어 AI 분석 시 파일 목적 요약이 흐려진다. `formatLargeText`가 향후 sanitizer 도입으로 커질 것이 예상됨.
- 수정 제안:
  - `utils/format/text.ts` (escapeHtml, formatLargeText, truncateText, createContentPreview)
  - `utils/format/json.ts` (formatValue, formatJSON, formatRawHeaders, isComplexObject)
  - `utils/format/date.ts` (formatTimestamp, formatStable*, DateInput, toValidDate)
  - `utils/format/size.ts` (formatFileSize)
  - barrel `utils/formatters.ts`에서 re-export 유지하여 기존 import 호환.

### [Medium] [D2] 단위 테스트 부재

- 파일: `web/app/utils/` 디렉터리 전역
- 증거: `formatters.ts`/`models.ts` 대응 `.test.ts`/`.spec.ts` 없음.
- 설명: 10곳 이상의 `dangerouslySetInnerHTML` 경로, 모델 프로바이더 분류, SSR-safe 날짜 포맷이 모두 이 두 파일에 집중된다. 회귀가 즉시 UI/보안 문제로 번질 수 있는데 안전망이 없다.
- 수정 제안:
  - `web/app/utils/__tests__/formatters.spec.ts`에 `formatLargeText` 보안(`<script>`, `javascript:`, `on*=`) + 마크업 스냅샷, `escapeHtml`, `formatFileSize` 경계, `formatStable*` SSR 고정값.
  - `web/app/utils/__tests__/models.spec.ts`에 `ollama/*`/`opus-*`/`gpt-4o` 분류 표 테스트.
  - `vitest` 또는 Remix 기본 runner 도입 (FE-03 테스트 누락 이슈와 병합).

### [Low] [D1] `truncateText`/`createContentPreview`가 유사 로직 중복

- 파일: `web/app/utils/formatters.ts:111-114, 212-233`
- 증거:
  ```ts
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
  ```
  같은 `substring(0, n) + '...'` 패턴이 4회 등장.
- 수정 제안: `createContentPreview` 내부에서 `truncateText`를 호출하여 패턴 일원화 + `…`(ellipsis U+2026) 상수화.

### [Low] [D1] `formatValue`가 배열 처리 없이 `JSON.stringify` — 타입별 일관성

- 파일: `web/app/utils/formatters.ts:8-19`
- 증거:
  ```ts
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  ```
- 설명: 빈 객체 `{}`/빈 배열 `[]`도 `"{}"`, `"[]"`로 찍힌다. `isComplexObject`(L101)는 배열을 복합 객체에서 제외하므로 UI에서 기대하는 표기와 엇갈릴 수 있다.
- 수정 제안: `Array.isArray` 분기를 명시하거나 `isComplexObject`의 정의와 정렬.

### [Low] [D2] tailwind.css `@layer components` 내부에 다크 규칙만 존재 — 원래 components 용도와 불일치

- 파일: `web/app/tailwind.css:13-117`
- 설명: `@layer components`는 본래 재사용 컴포넌트 클래스를 위한 레이어. 다크 오버라이드는 `@layer base` 또는 전용 사용자 레이어(`@layer dark-overrides`)에 두는 편이 목적 표시가 명확.
- 수정 제안: Tailwind v3.4+에서 `@layer components` → `@layer base` 또는 ordering 명시.

### [Low] [D2] `code-block`, `scrollbar-custom` 클래스가 `@layer utilities`/`components` 밖의 최상위 CSS

- 파일: `web/app/tailwind.css:144-197`
- 설명: 두 커스텀 클래스가 layer 밖에 선언되어 있어 Tailwind의 purge/ordering과 상호작용이 예측 어렵다.
- 수정 제안: `@layer components { .code-block { ... } }` 로 감싸기.

---

## 긍정적 관찰

- `models.ts`는 31 LOC에 JSDoc + 명확한 union 반환 타입(`'OpenAI' | 'Anthropic'`) + 단일 책임으로 잘 설계됨 (프리픽스 룰 정확성 이슈만 제외하면 모범 사례).
- `formatStableDate/Time/DateTime` 3종이 `toValidDate` 공통 가드를 통해 SSR-safe하게 통일된 점이 좋음.
- `tailwind.css` 상단 주석(L4-12, L60-65)이 오버라이드 의도를 명시 — 유지보수 힌트 제공.
- `escapeHtml`을 `formatLargeText`가 최초 단계에서 호출하는 설계는 XSS 방어 관점에서 의도는 올바름.

---

## Cross-cutting 리뷰 시 참고 단서

- **CC-XSS(`formatLargeText` 파이프라인)**: 본 청크의 Critical 이슈가 FE-01(`MessageContent.tsx` 다수 `dangerouslySetInnerHTML`) 및 FE-02(`MessageFlow.tsx`)와 직결. CC 단계에서 soft-fail sanitizer 도입을 공통 조치로 묶을 것.
- **CC-타입 공용화**: `formatters.ts`의 `any` 5건은 FE-01 #62(`types/anthropic.ts` 도입)·FE-02 #77(`types/request.ts`)·FE-03 #96과 동일 root. 본 청크 수정은 그 타입 도입에 블록.
- **CC-프로바이더 판별**: `models.ts`의 `isOpenAIModel` prefix rule은 `proxy/internal/provider/*`의 백엔드 라우팅 로직(CHUNK-BE-01 리뷰 대상)과 일치해야 하나 현재 양측이 독립적. BE의 config 기반 라우팅을 UI가 직접 읽도록 한 소스로 통일 권장.
- **CC-날짜 표시 일관성**: `formatTimestamp`(로케일 의존) vs `formatStable*`(SSR-safe). FE 전반에서 어느 쪽이 쓰이는지 grep 교차 확인 필요 — hydration mismatch 경고 원인 추적 시 참조.
- **CC-다크모드 전략**: `tailwind.css`의 클래스-덮어쓰기 방식이 컴포넌트의 명시적 `dark:` 유틸리티와 충돌·중복할 수 있음. FE 전체에서 `dark:` 사용 빈도와 본 오버라이드 간 우선순위 검증.
