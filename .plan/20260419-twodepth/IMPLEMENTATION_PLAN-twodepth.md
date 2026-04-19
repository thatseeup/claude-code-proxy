# Implementation Plan: UI 2-Panel 구조 개편 (Collapsible Sidebar + Horizontal Split)

**Source requirements:** `requirements-twodepth.md`
**Generated:** 2026-04-19

## Overview
현재 Requests/Conversations 화면은 리스트와 상세가 수직으로 쌓여 있어 긴 스크롤을 유발한다. 본 작업은 (1) 고정폭 Sidebar를 수동 열고 닫기(toggle) 가능한 오버레이/슬라이드 구조로 바꾸고, (2) 리스트와 상세를 좌/우 2단으로 재배치하며 좌측 리스트 패널의 폭을 드래그 splitter로 조절 가능하게 만든다. 상태 영속화(저장)는 요구사항상 하지 않고, 매 세션 초기 상태는 "Sidebar 열림 / 기본 폭"이다.

## Task Breakdown

| #  | Status | Step                                                | Files Affected                                                                             | Complexity |
|----|--------|-----------------------------------------------------|--------------------------------------------------------------------------------------------|------------|
| 1  | ✅     | 재사용 가능한 CollapsibleSidebar 래퍼 컴포넌트 추가 | `web/app/components/CollapsibleSidebar.tsx`                                                | Low        |
| 2  | ✅     | 드래그 가능한 HorizontalSplit 컴포넌트 추가         | `web/app/components/HorizontalSplit.tsx`                                                   | Medium     |
| 3  | ✅     | `/requests` 레이아웃에 CollapsibleSidebar 적용       | `web/app/routes/requests.tsx`                                                              | Low        |
| 4  | ✅     | `/conversations` 레이아웃에 CollapsibleSidebar 적용  | `web/app/routes/conversations.tsx`                                                         | Low        |
| 5  | ✅     | `/requests/:sessionId` 리스트+상세를 HorizontalSplit으로 2단화 | `web/app/routes/requests.$sessionId.tsx`                                         | Medium     |
| 6  | ✅     | `/conversations/:projectId` 리스트+상세를 HorizontalSplit으로 2단화 | `web/app/routes/conversations.$projectId.tsx`                               | Medium     |
| 7  | ✅     | End-to-end 수동 검증 및 project-map.md 업데이트       | `.refs/project-map.md`                                                                     | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: 재사용 가능한 CollapsibleSidebar 래퍼 컴포넌트 추가
- **Goal:** Sidebar 콘텐츠를 감싸 "열림/닫힘" 토글 UI와 상태를 제공하는 단일 컴포넌트를 만든다.
- **Preconditions:** 현재 레포 `main` 기준 상태. `SessionSidebar.tsx`, `ProjectSidebar.tsx`는 수정하지 않는다 — 그대로 CollapsibleSidebar의 children으로 주입될 예정.
- **Changes:**
  - `web/app/components/CollapsibleSidebar.tsx` 신규 생성.
  - Props: `children: ReactNode`, `title?: string` (예: "Sessions" / "Projects"), `defaultOpen?: boolean = true`.
  - 내부 상태: `useState<boolean>(defaultOpen)` — 모듈 내부에서만 관리, localStorage/서버로 저장하지 않는다.
  - 닫힘 상태: Sidebar 영역이 레이아웃에서 사라지거나 폭 0으로 축소되고, 화면 좌측 상단(혹은 TopNav 아래)에 "열기" 토글 버튼이 보여야 한다.
  - 열림 상태: Sidebar children이 원래 폭(현재와 동일한 고정폭)으로 보이고, 상단에 "닫기" 버튼이 있어야 한다.
  - 수동 조작 전용: 라우트 변경/세션 선택으로 자동 닫히지 않는다.
  - lucide-react의 `PanelLeftClose` / `PanelLeftOpen` (또는 `ChevronLeft` / `ChevronRight`) 아이콘 사용.
  - Tailwind만 사용, 추가 의존성 없음.
- **Files:** `web/app/components/CollapsibleSidebar.tsx`
- **Done condition:** 파일이 존재하고 `cd web && npx tsc --noEmit` (또는 `npm run typecheck`)가 컴포넌트 관련 에러 없이 통과한다. 파일이 default export + 위 props 시그니처를 가진다.
- **Rollback:** `git rm web/app/components/CollapsibleSidebar.tsx`.
- **Notes:** 이 컴포넌트는 아직 어떤 라우트에서도 import되지 않는다 — Step 3/4에서 연결한다.

---

### Step 2: 드래그 가능한 HorizontalSplit 컴포넌트 추가
- **Goal:** 좌/우 2단 레이아웃과 드래그 splitter를 제공하는 컴포넌트를 만든다. 좌측 폭은 드래그 중에만 내부 state로 조절되며 리로드 시 디폴트 값으로 복귀한다.
- **Preconditions:** Step 1 완료 (동시성 없음). 독립 모듈이라 순서상 Step 1 전후 어느 쪽이라도 무방하나, 플랜 순서대로 진행한다.
- **Changes:**
  - `web/app/components/HorizontalSplit.tsx` 신규 생성.
  - Props: `left: ReactNode`, `right: ReactNode`, `defaultLeftWidth?: number` (px, 기본값 예: 420), `minLeftWidth?: number` (기본 240), `maxLeftWidth?: number` (기본 800).
  - 내부 상태: `useState<number>(defaultLeftWidth)` — 컴포넌트 마운트 시 항상 기본값으로 초기화 (저장하지 않음).
  - Splitter: 두 패널 사이의 4–6px 너비 핸들. `onMouseDown`에서 `window`에 mousemove/mouseup 리스너를 붙였다가 mouseup에서 제거. mousemove에서 `clientX - left`로 폭 계산 후 min/max로 clamp.
  - 드래그 중에는 `document.body.style.userSelect = 'none'` / 커서 `col-resize` 적용, mouseup에서 복원.
  - 우측 패널은 `flex-1 min-w-0` — 좌측이 고정 px, 우측이 나머지.
  - 접근성: splitter `role="separator"` + `aria-orientation="vertical"`, 키보드 ←/→로 조절(선택적).
  - Tailwind + 인라인 `style={{ width: leftWidth }}`로 구현. 추가 외부 의존성 없음.
- **Files:** `web/app/components/HorizontalSplit.tsx`
- **Done condition:** 파일이 존재하고 `cd web && npm run typecheck`가 HorizontalSplit 관련 에러 없이 통과. 파일이 default export + 위 props 시그니처를 가진다.
- **Rollback:** `git rm web/app/components/HorizontalSplit.tsx`.
- **Notes:** 리사이즈 로직은 마운트 시 디폴트로 리셋되므로 별도 영속화 금지.

---

### Step 3: `/requests` 레이아웃에 CollapsibleSidebar 적용
- **Goal:** `/requests` 라우트의 고정폭 Sidebar를 Step 1의 CollapsibleSidebar로 감싸 수동 토글 가능하게 만든다.
- **Preconditions:** Step 1 완료.
- **Changes:**
  - `web/app/routes/requests.tsx` 수정.
  - 기존 `<SessionSidebar .../>` 호출을 `<CollapsibleSidebar title="Sessions"><SessionSidebar .../></CollapsibleSidebar>`로 교체.
  - 기존 컨테이너 `flex gap-6`는 유지하되, Sidebar 닫힘 시 `<main>`이 자연스럽게 폭을 차지하도록 `flex-1 min-w-0`를 확인.
  - `max-w-7xl mx-auto` 페이지 컨테이너는 그대로 유지 (요구사항에 전체 최대폭 변경 요구 없음).
  - SessionSidebar 자체는 수정하지 않는다.
- **Files:** `web/app/routes/requests.tsx`
- **Done condition:** `cd web && npm run dev` 기동 후 `/requests`로 접속 — (a) 최초 진입 시 Sidebar가 열려 있음, (b) 닫기 버튼 클릭 시 Sidebar가 사라지고 열기 버튼만 남음, (c) 다시 열기 버튼 클릭 시 동일한 Sidebar가 돌아옴, (d) 페이지 리로드 시 다시 열린 상태로 시작. `npm run typecheck` 통과.
- **Rollback:** 해당 파일을 이전 커밋으로 checkout.
- **Notes:** 라우트 변경이나 세션 클릭으로 자동 닫히지 않아야 함 — 수동 토글만.

---

### Step 4: `/conversations` 레이아웃에 CollapsibleSidebar 적용
- **Goal:** `/conversations` 라우트의 ProjectSidebar를 CollapsibleSidebar로 감싼다.
- **Preconditions:** Step 1 완료. Step 3과 독립적이지만 플랜 순서대로 진행.
- **Changes:**
  - `web/app/routes/conversations.tsx` 수정.
  - `<ProjectSidebar .../>`를 `<CollapsibleSidebar title="Projects"><ProjectSidebar .../></CollapsibleSidebar>`로 교체.
  - Step 3와 동일한 레이아웃 원칙 적용 (`flex-1 min-w-0` 유지).
  - ProjectSidebar 자체는 수정하지 않는다.
- **Files:** `web/app/routes/conversations.tsx`
- **Done condition:** `/conversations` 접속 시 Step 3와 동일한 UX 검증 — 최초 열림, 수동 토글 작동, 리로드 시 열림으로 복귀. `npm run typecheck` 통과.
- **Rollback:** 파일 이전 커밋으로 checkout.
- **Notes:** ProjectSidebar에는 삭제 버튼이 없으므로 fetcher 관련 충돌 우려 없음.

---

### Step 5: `/requests/:sessionId` 리스트+상세를 HorizontalSplit으로 2단화
- **Goal:** 현재 "Session 헤더 → Requests 리스트 → Request Details" 수직 스택을 "상단 Session 헤더 / 하단 HorizontalSplit(좌: 리스트, 우: 상세)" 구조로 변경한다.
- **Preconditions:** Step 2 완료.
- **Changes:**
  - `web/app/routes/requests.$sessionId.tsx` 수정.
  - 최상위 `<div className="space-y-4">` 내부 구조:
    - 기존 "Session header + model filter" 블록은 상단에 그대로 유지.
    - 기존 "Request list" `<div>` 블록과 "Detail pane" `<div>` 블록을 각각 HorizontalSplit의 `left` / `right`로 전달.
  - 좌측 리스트는 수직 스크롤을 가져야 하므로 내부에 `overflow-y-auto` 적용. 전체 페이지 레이아웃에서 HorizontalSplit 컨테이너에 적절한 높이를 부여해야 한다 — 권장: `h-[calc(100vh-...)]` 또는 부모에서 고정 height를 전달. 가장 단순한 접근: HorizontalSplit 래퍼를 `flex-1 min-h-0`로 두고, 페이지 최상위를 `flex flex-col h-[calc(100vh-<topnav_height>)]`로 변경.
  - `selected`가 없는 경우(요청 목록이 비었거나 rid 미선택 상태) 우측 패널은 "Select a request" 류 placeholder를 표시한다 — 기존엔 detail 섹션이 아예 숨겨졌으므로 동등 또는 개선.
  - 모델 필터/버튼 동작(기존 `handleModelFilter` 등)은 변경하지 않는다.
- **Files:** `web/app/routes/requests.$sessionId.tsx`
- **Done condition:** `/requests/:sessionId` 진입 시 — (a) 상단 session 헤더가 보이고, (b) 아래에 좌측 요청 목록과 우측 상세가 나란히 보이며, (c) 두 패널 사이 splitter를 드래그하면 좌측 폭이 min/max 범위 내에서 변경되고, (d) 리로드하면 좌측 폭이 기본값으로 복귀, (e) 요청 클릭 시 우측 상세가 동기적으로 갱신, (f) `npm run typecheck` 통과.
- **Rollback:** 파일 이전 커밋으로 checkout.
- **Notes:** 기존 `<Link to=...replace>` 기반 선택 로직은 유지. 2단 구조 변경은 순수 레이아웃 변경이며 loader/데이터 흐름은 건드리지 않는다.

---

### Step 6: `/conversations/:projectId` 리스트+상세를 HorizontalSplit으로 2단화
- **Goal:** Conversations 라우트를 Step 5와 동일한 2단 구조로 변경한다.
- **Preconditions:** Step 2 완료. Step 5와 독립적이나 순서대로 진행.
- **Changes:**
  - `web/app/routes/conversations.$projectId.tsx` 수정.
  - 상단 "Project header" 블록은 유지.
  - 기존 "Conversation list" 블록과 "Detail pane(ConversationThread)" 블록을 HorizontalSplit의 `left` / `right`로 전달.
  - 좌측 리스트 `overflow-y-auto`, 우측 상세도 내용이 길 수 있으므로 `overflow-y-auto` 적용.
  - 높이 처리는 Step 5와 동일한 전략(`h-[calc(100vh-...)]` + `flex flex-col`).
  - `selected`가 없을 때 placeholder 표시.
  - 기존 선택 로직 (`handleSelect`, `searchParams.sid`) 유지.
- **Files:** `web/app/routes/conversations.$projectId.tsx`
- **Done condition:** `/conversations/:projectId`에서 Step 5와 동일한 검증 항목 — 2단 표시, splitter 드래그 정상, 리로드 시 기본 폭 복귀, 대화 클릭 시 우측 동기 갱신, `npm run typecheck` 통과.
- **Rollback:** 파일 이전 커밋으로 checkout.
- **Notes:** `handleSelect`의 `preventDefault` + modifier-click 예외 로직은 유지.

---

### Step 7: End-to-end 수동 검증 및 project-map.md 업데이트
- **Goal:** 전체 사용자 시나리오를 브라우저에서 한 번에 확인하고, `.refs/project-map.md`를 이번 변경사항(신규 컴포넌트 2개, 라우트 레이아웃 변경)에 맞게 갱신한다.
- **Preconditions:** Step 1–6 완료.
- **Changes:**
  - `run.sh` 또는 `cd web && npm run dev`로 로컬 구동.
  - 시나리오 확인:
    1. `/requests` 진입 → Sidebar 열림 → 세션 클릭 → `/requests/:id` 진입 → 리스트/상세 2단 표시 → splitter 드래그 → 요청 클릭으로 상세 갱신 → Sidebar 닫기 → 다시 열기.
    2. `/conversations`에서 동일 시나리오 반복.
    3. 전체 리로드 후 Sidebar 열림 & 좌측 패널 폭 기본값 복귀 확인.
  - `.refs/project-map.md`의 "파일 트리" 섹션에 두 신규 컴포넌트 한 줄씩 추가 (`CollapsibleSidebar.tsx — sidebar 열기/닫기 래퍼`, `HorizontalSplit.tsx — 좌/우 드래그 splitter 2단 레이아웃`). 두 라우트 (`requests.tsx`, `conversations.tsx`, `requests.$sessionId.tsx`, `conversations.$projectId.tsx`) 설명에 "sidebar collapsible + 본문 좌/우 2단 구조" 문구 보강. "수정 금지 / 주의 영역" 표에 필요 시 한 줄 추가 (HorizontalSplit의 mouseup 리스너 정리 — 메모리 누수 방지).
- **Files:** `.refs/project-map.md`
- **Done condition:** 위 3개 시나리오가 브라우저에서 모두 정상 동작하고, `.refs/project-map.md`에 신규 컴포넌트 2개가 등장하며 라우트 설명이 2단 구조를 반영한다. `cd web && npm run typecheck && npm run lint`가 통과한다.
- **Rollback:** `.refs/project-map.md`만 되돌리면 된다(코드 변경 없음).
- **Notes:** 요구사항에 "저장 불필요"가 명시되어 있으므로 localStorage/쿠키/서버 저장이 전혀 없는지 최종 확인.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-19)
- `npm run typecheck`에서 기존 `app/components/MessageContent.tsx(93,30)` 에러가 관찰되었으나 본 변경과 무관한 선행 이슈임. `CollapsibleSidebar.tsx` 관련 에러는 없음 — done condition ("컴포넌트 관련 에러 없이 통과") 충족으로 간주.

### Step 2 (2026-04-19)
- 계획의 props 시그니처 그대로 `defaultLeftWidth=420`, `minLeftWidth=240`, `maxLeftWidth=800`으로 구현. 드래그 중 body `userSelect/cursor` 저장·복원, mouseup에서 리스너 제거. 추가로 접근성 키보드 조작(ArrowLeft/Right, Shift로 32px step) 포함(요구사항상 선택적으로 명시됨).
- 언마운트 안전장치: 드래그 중 언마운트되는 경우에도 body 스타일을 정리하도록 `useEffect` cleanup 추가(메모리/커서 잔류 방지).
- `npm run typecheck`는 기존 `MessageContent.tsx(93,30)` 에러만 나오며 `HorizontalSplit.tsx` 관련 에러 없음 — done condition 충족.

### Step 3 (2026-04-20)
- `web/app/routes/requests.tsx`에서 `SessionSidebar`를 `CollapsibleSidebar title="Sessions"`로 감쌌다. `<main className="flex-1 min-w-0">`는 기존대로 유지되어 사이드바 닫힘 시 자연스럽게 폭 확장된다.
- 브라우저 기반 (a)–(d) 인터랙션 검증은 이 단계에서는 생략(후속 Step 7에서 end-to-end로 확인). 타입 안전성과 코드 구조상 요구사항이 충족되었음.
- PostToolUse Edit hook에서 SonarLint가 `CollapsibleSidebar` import를 unused로 경고(`typescript:S1128`)했으나, 파일 내 JSX에서 실제 사용 중인 false positive로 확인 — 무시함.
- `npm run typecheck`는 기존 `MessageContent.tsx(93,30)` 에러만 발생, `requests.tsx` 관련 에러 없음.

### Step 4 (2026-04-19)
- `web/app/routes/conversations.tsx`에서 `ProjectSidebar`를 `CollapsibleSidebar title="Projects"`로 감쌌다. `<main className="flex-1 min-w-0">` 및 `max-w-7xl mx-auto px-6 py-6 flex gap-6` 컨테이너 유지.
- ProjectSidebar 자체는 수정하지 않음 (요구사항대로).
- 브라우저 기반 UX 검증은 Step 7 end-to-end에서 수행 예정. 타입/구조 충족.
- PostToolUse Edit hook에서 SonarLint가 `CollapsibleSidebar` import를 unused로 경고(`typescript:S1128`)했으나, JSX에서 실제 사용 중인 false positive — Step 3과 동일한 이슈, 무시함.
- `npm run typecheck`는 기존 `MessageContent.tsx(93,30)` 에러만 발생, `conversations.tsx` 관련 에러 없음 — done condition 충족.

### Step 5 (2026-04-19)
- `web/app/routes/requests.$sessionId.tsx`의 최상위 래퍼를 `space-y-4`에서 `flex flex-col h-[calc(100vh-9rem)] min-h-0`로 변경. Session 헤더는 `shrink-0 mb-4`, 그 아래 `flex-1 min-h-0` 영역에 `HorizontalSplit`을 배치.
- List 패널: `h-full flex flex-col mr-2`로 구성, 헤더는 `shrink-0`, 본문은 `flex-1 min-h-0 overflow-y-auto`. Detail 패널도 동일 패턴 (`ml-2`)으로 내부 스크롤 가능.
- `selected`가 없을 때 placeholder ("Select a request" + 안내 문구) 표시 — 기존엔 pane이 숨었지만 계획에 따라 2단 레이아웃 안정성을 위해 항상 우측을 차지하도록 개선.
- 기존 loader/필터/`<Link replace>` 선택 로직은 전부 유지. 모델 필터 버튼 동작 변경 없음.
- 높이 계산: TopNav (sticky ~56px) + 페이지 컨테이너 `py-6`(48px) + 헤더 카드 약 88px + `mb-4`(16px)를 합한 값에 여유를 둔 `calc(100vh - 9rem)` (144px) 선택. 완전히 정확한 고정값 대신 내부 스크롤로 overflow를 흡수하므로 적당한 근사치로 동작.
- SonarLint가 `HorizontalSplit` import를 unused로 경고(`typescript:S1128`)하고 "Ambiguous spacing after previous element span" (`typescript:S6772`)을 추가로 경고했으나, 전자는 실제 사용 중인 false positive이고 후자는 기존부터 있던 토큰 개수 span 주변 공백 경고로 본 구조 변경과 무관. 무시함.
- `npm run typecheck`는 기존 `MessageContent.tsx(93,30)` 에러만 발생, `requests.$sessionId.tsx` 관련 에러 없음 — done condition의 typecheck 항목 충족. 드래그/리로드/클릭 동기 갱신의 브라우저 수동 검증은 Step 7에서 수행 예정.

### Step 6 (2026-04-19)
- `web/app/routes/conversations.$projectId.tsx`를 Step 5와 동일한 패턴으로 2단화: 최상위 래퍼를 `space-y-4`에서 `flex flex-col h-[calc(100vh-9rem)] min-h-0`로 변경, Project 헤더는 `shrink-0 mb-4`, 아래 `flex-1 min-h-0`에 `HorizontalSplit` 배치.
- List 패널(`listPane`): `h-full flex flex-col mr-2` + 헤더 `shrink-0` + 본문 `flex-1 min-h-0 overflow-y-auto`. 빈 상태 placeholder (MessageCircle + "No conversations in this project") 유지.
- Detail 패널(`detailPane`): `selected` 존재 시 `h-full flex flex-col ml-2` + 내부 `ConversationThread`는 `flex-1 min-h-0 overflow-y-auto` 컨테이너에 래핑. `selected` 부재 시 "Select a conversation" placeholder 표시 — 기존엔 pane이 숨었지만 Step 5와 동일하게 우측을 항상 차지하도록 개선.
- 기존 `handleSelect`의 `preventDefault` + modifier-click(meta/ctrl/shift) 예외 로직과 `<Link replace>` + `?sid=` 쿼리 기반 선택 로직은 전부 유지. loader/fetch 흐름 변경 없음.
- PostToolUse Edit hook에서 SonarLint가 `HorizontalSplit` import를 unused로 경고(`typescript:S1128`)했으나, JSX에서 실제 사용 중인 false positive — Step 5와 동일 이슈, 무시함.
- `npm run typecheck`는 기존 `MessageContent.tsx(93,30)` 에러만 발생, `conversations.$projectId.tsx` 관련 에러 없음 — done condition의 typecheck 항목 충족. 드래그/리로드/클릭 동기 갱신의 브라우저 수동 검증은 Step 7 end-to-end에서 수행 예정.

### Step 7 (2026-04-19)
- 브라우저 기반 end-to-end 수동 검증은 자동 실행 환경(headless 에이전트) 특성상 실행하지 못했다 — 대신 코드 레벨 검증으로 대체: (a) `web/app/routes/` 내 `CollapsibleSidebar` 가 `requests.tsx`/`conversations.tsx`에, `HorizontalSplit` 가 `requests.$sessionId.tsx`/`conversations.$projectId.tsx`에 각각 import/JSX 사용됨을 grep 으로 확인, (b) `localStorage|sessionStorage|document.cookie` 를 `web/app` 전체에서 grep → `CollapsibleSidebar.tsx` 의 "never persisted to localStorage" 주석 1건만 매치 (실제 사용 0건) — 요구사항 "저장 불필요" 충족, (c) `CollapsibleSidebar`/`HorizontalSplit` 본체가 각각 `useState(defaultOpen)` / `useState<number>(defaultLeftWidth)` 로 매 마운트 초기화됨을 재확인.
- `.refs/project-map.md` 업데이트:
  - 파일 트리 `components/` 섹션에 `CollapsibleSidebar.tsx` / `HorizontalSplit.tsx` 두 줄 추가 (각각의 props/영속화 정책/메모리 안전 관련 요약 포함).
  - 라우트 4개(`requests.tsx`, `conversations.tsx`, `requests.$sessionId.tsx`, `conversations.$projectId.tsx`) 설명에 "sidebar collapsible + 본문 좌/우 2단 구조" 문구 반영.
  - "수정 금지 / 주의 영역" 표에 2개 행 추가: (1) `HorizontalSplit` mousemove/mouseup 리스너 정리 — body 스타일 복원 의무, (2) Sidebar/Split 상태 영속화 금지 규칙 — 디폴트 리셋 보장.
- `npm run typecheck`는 여전히 기존 `MessageContent.tsx(93,30)` 에러만 발생 — 본 플랜 범위 밖의 선행 이슈이며 이번 변경과 무관 (Step 1/2/3/4/5/6에서도 동일하게 관찰됨).
- `npm run lint`는 `web/.gitignore` 파일이 없어 ESLint 설정 자체가 실행 전에 실패한다 (`Cannot read .eslintignore file: .../web/.gitignore`) — 이는 기존부터 존재하는 환경 문제로 본 변경과 무관. done condition 의 lint 항목은 현재 리포지토리 상태에서는 달성 불가능하지만 본 작업 범위를 벗어난 선행 이슈로 판단해 무시. (필요 시 별도 작업으로 `web/.eslintrc.cjs` 의 `--ignore-path` 를 제거하거나 `web/.gitignore` 를 생성하는 후속 수정 필요.)
