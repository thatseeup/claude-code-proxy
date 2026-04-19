# Implementation Plan: UI 2컬럼 레이아웃 재구성 (Sidebar 제거)

**Source requirements:** `requirements-layout.md`
**Generated:** 2026-04-20

## Overview

현재 `Requests` / `Conversations` 화면은 TopNav + 접이식 Sidebar + 좌측 목록 + 우측 상세의 3컬럼 구조다. 이를 GitHub 저장소 뷰와 같이 **좌(목록) / 우(상세)의 2컬럼** 구조로 단순화한다. 별도 `CollapsibleSidebar` 컬럼을 제거하고, 세션/프로젝트 "선택" 및 "세션 삭제" 기능을 좌측 목록 패널 상단에 흡수한다. 라우트 경로·쿼리 파라미터·폭 영속화 정책은 그대로 유지한다.

## Task Breakdown

| #  | Status | Step                                                            | Files Affected                                                                                          | Complexity |
|----|--------|-----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|------------|
| 1  | ✅     | SessionPicker 컴포넌트 추가 (세션 전환 + 삭제)                  | `web/app/components/SessionPicker.tsx` (new)                                                            | Medium     |
| 2  | ✅     | ProjectPicker 컴포넌트 추가 (프로젝트 전환)                     | `web/app/components/ProjectPicker.tsx` (new)                                                            | Low        |
| 3  | ✅     | `requests.tsx` parent 레이아웃을 2컬럼으로 전환                 | `web/app/routes/requests.tsx`                                                                           | Low        |
| 4  | ✅     | `conversations.tsx` parent 레이아웃을 2컬럼으로 전환            | `web/app/routes/conversations.tsx`                                                                      | Low        |
| 5  | ✅     | `requests.$sessionId.tsx` 좌측 패널에 SessionPicker 통합        | `web/app/routes/requests.$sessionId.tsx`                                                                | Medium     |
| 6  | ✅     | `conversations.$projectId.tsx` 좌측 패널에 ProjectPicker 통합   | `web/app/routes/conversations.$projectId.tsx`                                                           | Medium     |
| 7  | ✅     | 레거시 컴포넌트 / 미사용 import 정리 + project-map 업데이트     | `web/app/components/CollapsibleSidebar.tsx`, `SessionSidebar.tsx`, `ProjectSidebar.tsx`, `.refs/project-map.md` | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: SessionPicker 컴포넌트 추가 (세션 전환 + 삭제)
- **Goal:** 좌측 목록 패널 상단에 들어갈 "현재 세션 표시 + 세션 전환 + 세션 삭제" 책임을 가진 컴포넌트를 신설한다.
- **Preconditions:** 현행 repo 상태. `SessionSidebar.tsx` 가 보유한 삭제 로직(fetcher → `/api/sessions/:id`, 삭제 성공 시 active 였으면 `/requests` 로 navigate) 을 참고한다.
- **Changes:**
  - 새 파일 `web/app/components/SessionPicker.tsx` 를 추가한다.
  - Props: `sessions: SessionSummary[]`, `activeSessionId: string` (URL token; `"unknown"` 또는 실제 id).
  - UI: 현재 선택된 세션 라벨(짧은 id + Unknown 처리) + 전환 드롭다운/팝오버 + 현재 세션 삭제 버튼(휴지통 아이콘).
    - 드롭다운 옵션 행에는 SessionSummary 의 firstTimestamp / requestCount 정보를 표시한다 (기존 `SessionSidebar` 행 수준 정보).
    - 전환은 `Link` 또는 프로그램매틱 navigate(`/requests/:token`) 로 수행. 모델 필터 쿼리(`?model=`) 는 URL 의 현재 값을 그대로 보존한다.
    - 삭제는 `useFetcher` 로 `DELETE /api/sessions/:token` 제출. 제출 중 비활성화 표시. 현재 active 세션을 삭제한 경우 `/requests` 로 navigate (parent loader 가 최신 세션으로 redirect).
  - `SessionSummary` 타입은 기존 `SessionSidebar.tsx` 에서 export 된 것을 재사용한다 (해당 파일은 본 단계에서 제거하지 않는다).
  - Tailwind 스타일은 기존 좌측 패널 내부 헤더와 시각적으로 어울리도록 컴팩트하게 (패널 상단 바 수준 높이).
- **Files:** `web/app/components/SessionPicker.tsx` (new)
- **Done condition:** `pnpm --filter web typecheck` (또는 repo 의 기존 `npm run typecheck`) 이 통과한다. 컴포넌트가 export default 로 제공되며, 어디서도 아직 import 되지 않는다(독립 추가 단계이므로 사용처는 다음 단계에서 붙는다).
- **Rollback:** 새 파일 1개 삭제.
- **Notes:** 이 단계에서는 아직 `SessionSidebar.tsx` / `CollapsibleSidebar.tsx` 을 건드리지 않는다. 중간 상태에서 기존 화면 동작은 그대로여야 한다.

### Step 2: ProjectPicker 컴포넌트 추가 (프로젝트 전환)
- **Goal:** 좌측 목록 패널 상단에 들어갈 "현재 프로젝트 표시 + 프로젝트 전환" 컴포넌트를 신설한다. 삭제는 없다(요구사항 — jsonl 보호).
- **Preconditions:** Step 1 완료(파일만 존재, 미사용).
- **Changes:**
  - 새 파일 `web/app/components/ProjectPicker.tsx` 를 추가한다.
  - Props: `projects: ProjectSummary[]`, `activeProjectId: string`.
  - UI: 현재 프로젝트 라벨(displayName + projectPath truncate) + 전환 드롭다운/팝오버.
    - 전환은 `/conversations/:encoded(projectPath)` 로 이동. 쿼리(`?sid=`) 는 동일 프로젝트 안에서만 의미가 있으므로 프로젝트 전환 시 제거.
    - 드롭다운 옵션 행에는 `ProjectSummary` 의 displayName, projectPath, conversationCount, lastMTime 을 표시한다(기존 `ProjectSidebar` 행 정보).
  - `ProjectSummary` 타입은 기존 `ProjectSidebar.tsx` 에서 export 된 것을 재사용.
- **Files:** `web/app/components/ProjectPicker.tsx` (new)
- **Done condition:** typecheck 통과. 컴포넌트가 export default 로 제공되며, 아직 어디서도 import 되지 않는다.
- **Rollback:** 새 파일 1개 삭제.
- **Notes:** SessionPicker 와 시각적 형식을 맞출 것(동일 좌측 상단 블록 자리).

### Step 3: `requests.tsx` parent 레이아웃을 2컬럼으로 전환
- **Goal:** `/requests` parent 라우트에서 `CollapsibleSidebar` + `SessionSidebar` 기반 3컬럼 껍데기를 제거하고, TopNav + 전체 폭 `<Outlet/>` 만 남긴다. 세션 목록 데이터는 자식 라우트에서 쓸 수 있도록 loader 에서 계속 반환한다.
- **Preconditions:** Step 1 완료.
- **Changes:**
  - `web/app/routes/requests.tsx` 수정:
    - `CollapsibleSidebar`, `SessionSidebar` import 제거.
    - JSX 에서 사이드바 컬럼 삭제 — 최상위 컨테이너는 `TopNav` + 본문 래퍼(`<Outlet/>`) 구성만 남긴다.
    - 본문 래퍼는 **페이지 전체 폭을 사용**한다: 기존 `max-w-7xl mx-auto` 폭 제한을 제거하고, horizontal padding(예: `px-4` 정도) + 전체 폭 레이아웃으로 바꾼다 (요구사항 "본문 컨테이너는 페이지 전체 폭을 사용").
    - loader 는 그대로(세션 목록 fetch + 빈 경로일 때 최신 세션 redirect). `useLoaderData`/`useParams` 는 자식이 `useRouteLoaderData("routes/requests")` 로 가져가도 되고 현재처럼 parent 가 넘겨도 무관 — 단순화를 위해 loader 데이터는 그대로 return 하고 parent 컴포넌트에서는 더 이상 sessions 를 사용하지 않는다.
- **Files:** `web/app/routes/requests.tsx`
- **Done condition:** `npm run -w web typecheck`(또는 repo 컨벤션 기준 typecheck) 통과. dev 서버(`npm run -w web dev`) 기동 후 `/requests` 접근 시 (a) 화면에 사이드바 컬럼이 보이지 않고 (b) 본문이 뷰포트 전체 폭을 차지하며 (c) 자식 경로로의 redirect 동작은 유지된다. 자식 화면 기능은 Step 5 전이라 일시적으로 세션 전환 UI 가 없음 — 이는 중간 상태로 허용된다.
- **Rollback:** `requests.tsx` 를 이전 커밋으로 되돌린다.
- **Notes:** 레거시 `SessionSidebar.tsx` 파일 자체는 아직 삭제하지 않는다(Step 7).

### Step 4: `conversations.tsx` parent 레이아웃을 2컬럼으로 전환
- **Goal:** Step 3 와 대칭. `/conversations` parent 에서 `CollapsibleSidebar` + `ProjectSidebar` 제거, 전체 폭 본문.
- **Preconditions:** Step 2 완료. Step 3 는 독립적이지만, 동일한 폭/패딩 규칙을 맞추기 위해 Step 3 와 같은 방식으로 처리한다.
- **Changes:**
  - `web/app/routes/conversations.tsx` 수정:
    - `CollapsibleSidebar`, `ProjectSidebar` import 제거.
    - JSX 사이드바 컬럼 삭제, `max-w-7xl` 제한 제거, 전체 폭 본문.
    - loader 는 그대로(프로젝트 목록 + 최신 프로젝트 redirect).
- **Files:** `web/app/routes/conversations.tsx`
- **Done condition:** typecheck 통과. dev 서버에서 `/conversations` 접근 시 사이드바 컬럼이 없고 본문이 전체 폭을 차지한다. parent → 최신 프로젝트 redirect 동작 유지.
- **Rollback:** `conversations.tsx` 파일만 되돌린다.
- **Notes:** 자식(`conversations.$projectId.tsx`) 이 Step 6 전까지는 프로젝트 전환 UI 없이 단순 상세만 보이는 중간 상태를 허용.

### Step 5: `requests.$sessionId.tsx` 좌측 패널에 SessionPicker 통합
- **Goal:** Requests 자식 화면의 좌측 목록 패널 상단에 `SessionPicker` 를 붙여 세션 전환/삭제 기능을 **목록 패널 내부**에서 제공한다. 기존 `HorizontalSplit` 기반 좌/우 2단 상세 뷰는 그대로 유지한다.
- **Preconditions:** Step 1, Step 3 완료.
- **Changes:**
  - parent loader 에서 내려주는 `sessions` 목록에 접근하도록 `useRouteLoaderData("routes/requests")` 로 세션 요약 배열을 획득 (또는 parent 가 Outlet `context` 로 넘기는 방식 — 프로젝트 기존 방식에 맞게 선택, 다만 parent JSX 에는 sessions prop 전달 대상이 없으므로 `useRouteLoaderData` 권장).
  - `listPane` JSX 에서 현재의 "Requests" 섹션 헤더 위치에 `SessionPicker` 블록을 삽입한다. 순서는: (1) SessionPicker (세션 선택 + 삭제), (2) 모델 필터 토글(기존 화면 상단에 있던 것을 좌측 패널 내부 상단으로 이동), (3) 요청 목록.
    - 기존 최상단 "Session header + model filter" 블록은 제거한다(요구사항: 좌/우 2컬럼만 남김; 별도 header bar 는 좌측 패널 내부로 흡수).
    - `displaySessionLabel`, `requests.length` 등의 정보는 SessionPicker 내부에서 자체적으로 표현하거나 목록 상단 메타에 포함.
  - 모델 필터의 UI/동작(URL `?model=` 갱신, `rid` reset) 은 그대로. 위치만 좌측 패널 내부 상단으로 이동.
  - 우측 상세 패널은 변경하지 않는다 (`?rid=` 동작 유지).
  - 최상위 컨테이너 높이(`h-[calc(100vh-9rem)]`) 는 parent 폭 변경에 맞춰 재확인. TopNav 높이만 반영하도록 조정이 필요하면 `h-[calc(100vh-<TopNav>rem)]` 수준으로 맞춘다.
- **Files:** `web/app/routes/requests.$sessionId.tsx`
- **Done condition:** typecheck 통과. dev 서버에서 `/requests/:sid` 접근 시:
  - 좌측 패널 상단에 현재 세션이 표시되고, 전환 UI 로 다른 세션 선택이 동작한다(URL 이 `/requests/:otherSid` 로 이동).
  - 좌측 패널 상단에서 세션 삭제 버튼이 노출되며, 클릭 시 `DELETE /api/sessions/:id` 가 날아가고 삭제 후 `/requests` 로 redirect → 최신 세션으로 자동 이동한다.
  - 모델 필터 토글이 좌측 패널 내부에 있고 `?model=` 쿼리를 그대로 갱신한다.
  - `?rid=` 로 요청 상세 선택이 유지된다.
  - 좌/우 splitter 드래그가 동작하고 리로드 시 기본 폭(420px) 으로 복귀한다.
- **Rollback:** 이 파일 한 개만 이전 상태로 되돌린다.
- **Notes:** `SessionPicker` 의 삭제 플로우는 기존 `SessionSidebar` 의 동작(“active 세션 삭제 → `/requests` navigate”)과 1:1로 맞출 것. 드롭다운 내부 엔터/포커스 트랩 등은 간단한 구현으로 충분하며, 접근성은 `aria-expanded`, `aria-label` 수준만 만족해도 된다.

### Step 6: `conversations.$projectId.tsx` 좌측 패널에 ProjectPicker 통합
- **Goal:** Conversations 자식 화면의 좌측 목록 패널 상단에 `ProjectPicker` 를 붙여 프로젝트 전환 기능을 목록 패널 내부에서 제공한다.
- **Preconditions:** Step 2, Step 4 완료.
- **Changes:**
  - parent loader 의 `projects` 배열을 `useRouteLoaderData("routes/conversations")` 로 접근.
  - `listPane` JSX 에서 기존 "Conversations" 섹션 헤더 위치에 `ProjectPicker` 블록을 삽입. 순서: (1) ProjectPicker, (2) 대화 목록.
  - 기존 최상단 "Project header" 블록은 제거 — 프로젝트 라벨/대화 수는 ProjectPicker 내부 또는 목록 상단 메타로 흡수.
  - 우측 상세 패널과 `?sid=` 동작은 변경하지 않는다.
  - 컨테이너 높이 보정은 Step 5 와 동일 기준.
- **Files:** `web/app/routes/conversations.$projectId.tsx`
- **Done condition:** typecheck 통과. dev 서버에서 `/conversations/:pid` 접근 시:
  - 좌측 패널 상단에서 프로젝트 전환 UI 로 다른 프로젝트 선택이 동작한다(URL 이 `/conversations/:otherPid` 로 이동하고, `?sid=` 쿼리는 제거된다).
  - 프로젝트 삭제 UI 는 노출되지 않는다.
  - `?sid=` 로 대화 상세 선택 유지. splitter 드래그/리셋 동작 유지.
- **Rollback:** 이 파일 한 개만 되돌린다.
- **Notes:** Step 5 와 같은 UI 형식(좌측 상단 picker 블록의 높이/여백) 을 맞춰 두 화면의 시각적 통일성을 유지한다.

### Step 7: 레거시 컴포넌트 / 미사용 import 정리 + project-map 업데이트
- **Goal:** 구조 변경 후 참조되지 않는 레거시 파일을 제거하고, `.refs/project-map.md` 에 신규/제거 컴포넌트와 새 레이아웃을 반영한다.
- **Preconditions:** Step 1–6 완료. 수정된 라우트 파일에서 `CollapsibleSidebar`, `SessionSidebar`, `ProjectSidebar` import 가 모두 사라진 상태여야 한다.
- **Changes:**
  - 레거시 파일 삭제:
    - `web/app/components/CollapsibleSidebar.tsx`
    - `web/app/components/SessionSidebar.tsx`
    - `web/app/components/ProjectSidebar.tsx`
  - 삭제 전, 이 세 파일에 대한 import 가 repo 어디에도 남아있지 않은지 grep 으로 확인한다 (`SessionPicker`/`ProjectPicker` 는 `SessionSummary`/`ProjectSummary` 타입을 재사용하므로, 삭제 전에 해당 타입을 `SessionPicker.tsx` / `ProjectPicker.tsx` 내부 또는 별도 타입 파일로 이관해야 한다 — 필요 시 이 단계에서 이관 작업 포함).
  - `.refs/project-map.md` 업데이트:
    - `requests.tsx` / `conversations.tsx` 설명을 "TopNav + `<Outlet/>` 의 parent layout. 사이드바 컬럼 없음" 으로 교체.
    - `requests.$sessionId.tsx` / `conversations.$projectId.tsx` 설명에 "좌측 패널 상단에 Session/Project Picker 를 포함한 2컬럼 구조" 를 반영.
    - 컴포넌트 목록에서 `CollapsibleSidebar`, `SessionSidebar`, `ProjectSidebar` 제거, `SessionPicker`, `ProjectPicker` 추가.
    - "수정 금지 / 주의 영역" 의 `Sidebar/Split 상태 영속화 금지` 항목에서 `CollapsibleSidebar` 관련 기술을 제거(또는 좌측 picker/Split 영속화 금지 문구로 갱신). `HorizontalSplit` 관련 기술은 그대로 유지.
- **Files:** `web/app/components/CollapsibleSidebar.tsx` (delete), `web/app/components/SessionSidebar.tsx` (delete), `web/app/components/ProjectSidebar.tsx` (delete), `web/app/components/SessionPicker.tsx` (편집 가능), `web/app/components/ProjectPicker.tsx` (편집 가능), `.refs/project-map.md`
- **Done condition:**
  - `rg -n "CollapsibleSidebar|SessionSidebar|ProjectSidebar" web/app` 결과 0 건.
  - `npm run -w web typecheck` 통과, `npm run -w web lint` 통과(기존 lint 설정 기준).
  - dev 서버에서 `/requests/:sid`, `/conversations/:pid` 모두 기능 회귀 없음(아래 요구사항 검증 기준과 동일).
  - `.refs/project-map.md` 에 신규 구조가 반영되어 있다.
- **Rollback:** 삭제한 3개 파일을 git 으로 복원하고 `project-map.md` 를 되돌린다.
- **Notes:** 타입 이관(SessionSummary / ProjectSummary) 을 Step 1/2 에서 미리 Picker 파일 내부로 선언해 두었다면 이 단계 이관 작업은 생략 가능하다. 계획 수립자가 어느 쪽이든 선택해도 되지만, 단일 세션 안에서 컴파일이 끊기지 않도록 삭제 직전에 반드시 타입 정의가 사용처에서 접근 가능해야 한다.

## 요구사항 → 검증 매핑

Step 7 완료 후 아래 요구사항 검증 기준을 모두 충족해야 한다:

- TopNav 외에 별도의 Sidebar 컬럼이 없다 → Step 3, 4 결과.
- 각 화면이 2컬럼(좌: 목록, 우: 상세) 이다 → Step 5, 6 결과.
- 세션/프로젝트 전환·세션 삭제 가 좌측 목록 패널 내에서 가능 → Step 5, 6.
- 좌/우 splitter 드래그 동작 + 리로드 시 디폴트 폭 → 기존 `HorizontalSplit` 재사용(미변경).
- 쿼리 파라미터 `?rid=`, `?sid=`, `?model=` 동작 유지 → Step 5, 6 에서 보존.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-20)
- `npm run typecheck` 는 `app/components/MessageContent.tsx(93,30)` 의 **기존 에러** 1건을 보고함. 이 에러는 본 단계 변경 전부터 main 에 존재하는 것으로 보이며 `SessionPicker.tsx` 와는 무관. `SessionPicker.tsx` 자체에는 타입 에러 없음. 후속 단계에서 동일 에러가 계속 노출될 수 있으나 layout 작업 범위 밖이므로 건드리지 않음.
- `SessionSummary` 타입은 기존 `SessionSidebar.tsx` 에서 re-export 하는 방식으로 import 하여 재사용 (별도 타입 파일 신설 없이). Step 7 에서 `SessionSidebar.tsx` 삭제 시 타입을 `SessionPicker.tsx` 내부로 인라인 이관 필요.

### Step 2 (2026-04-20)
- `ProjectSummary` 타입은 Step 1 과 동일한 패턴으로 기존 `ProjectSidebar.tsx` 에서 import 하여 재사용 (별도 타입 파일 신설 없음). Step 7 에서 `ProjectSidebar.tsx` 삭제 시 타입을 `ProjectPicker.tsx` 내부로 인라인 이관 필요.
- `npm run typecheck` 통과 (기존 `MessageContent.tsx(93,30)` 1건 외 에러 없음; `ProjectPicker.tsx` 자체에는 타입 에러 없음).
- ProjectPicker 는 삭제 기능이 없으므로 `useFetcher` 미사용. `useSearchParams` 도 불필요 (프로젝트 전환 시 `?sid=` 는 요구사항대로 제거해야 하므로 쿼리 보존 로직 없음).

### Step 3 (2026-04-20)
- `requests.tsx` 에서 `CollapsibleSidebar`, `SessionSidebar` import 제거, `useLoaderData`/`useParams` import 도 parent 에서 더 이상 사용하지 않아 제거. `SessionSummary` 타입은 loader 반환 타입 추론에 필요하므로 `SessionSidebar.tsx` 에서 type-only import 로 유지 (Step 7 에서 이관 예정).
- 본문 래퍼는 `w-full px-4 py-6` 으로 변경 (기존 `max-w-7xl mx-auto px-6 py-6 flex gap-6` 제거). Step 5 에서 세션 선택/삭제 UI 가 자식에 붙기 전까지 `/requests/:sid` 화면에서 세션 전환이 불가능한 중간 상태 — 계획 허용.
- `npm run typecheck` 결과 사전 존재하던 `MessageContent.tsx(93,30)` 1건 외 에러 없음.

### Step 4 (2026-04-20)
- `conversations.tsx` 에서 `CollapsibleSidebar`, `ProjectSidebar` default import 제거. `useLoaderData`/`useParams` 도 parent 에서 더 이상 사용하지 않아 제거. `ProjectSummary` 는 loader 반환 타입 추론에 필요하므로 `ProjectSidebar.tsx` 에서 type-only import 로 유지 (Step 7 에서 이관 예정).
- 본문 래퍼는 `w-full px-4 py-6` 으로 변경 (기존 `max-w-7xl mx-auto px-6 py-6 flex gap-6` 제거). Step 3 와 동일 규칙.
- `npm run typecheck` 결과 사전 존재하던 `MessageContent.tsx(93,30)` 1건 외 에러 없음.

### Step 5 (2026-04-20)
- `requests.$sessionId.tsx` 에서 parent sessions 를 `useRouteLoaderData("routes/requests")` 로 획득 (parent 가 Outlet context 를 넘기지 않으므로 route loader data 접근 방식 선택).
- `listPane` 최상단에 `SessionPicker` 삽입. 기존 "Requests" 섹션 헤더는 제거하고, 같은 자리에 "요청 개수 + 모델 필터 토글" 을 한 줄로 묶은 컴팩트 메타 바로 대체 (모델 필터 UI 는 기존 상단 블록에서 좌측 패널 내부 상단으로 이동, px-2 py-1 text-[11px] 로 축소).
- 최상위 컨테이너 높이는 `h-[calc(100vh-9rem)]` → `h-[calc(100vh-7rem)]` 로 조정 (외부 Session/Model 헤더 블록 mb-4 가 사라져 TopNav + `main py-6` 만 감안).
- `displaySessionLabel` 로컬 변수는 더 이상 필요 없어 제거하고, `activeSessionToken` (UNKNOWN 보정) 만 남겨 SessionPicker 에 전달.
- `npm run typecheck` 결과 사전 존재하던 `MessageContent.tsx(93,30)` 1건 외 에러 없음.

### Step 6 (2026-04-20)
- `conversations.$projectId.tsx` 에서 parent projects 를 `useRouteLoaderData("routes/conversations")` 로 획득 (Step 5 와 동일 패턴). `ProjectSummary` 타입은 `ProjectSidebar.tsx` 에서 type-only import — Step 7 에서 이관 예정.
- `listPane` 최상단에 `ProjectPicker` 삽입. 기존 "Conversations" 섹션 헤더는 제거하고, 같은 자리에 "대화 수" 만 표시하는 컴팩트 메타 바로 대체 (Step 5 의 모델 필터 토글 자리에 해당하는 Conversations 측 대응 요소는 없으므로 카운트만 노출).
- 외부 "Project header" 블록(projectPath / conversation 수) 은 제거 — Project 정보는 ProjectPicker 내부 라벨에서 표현. conversation 수는 위 메타 바로 이관.
- 최상위 컨테이너 높이는 `h-[calc(100vh-9rem)]` → `h-[calc(100vh-7rem)]` 로 조정 (Step 5 와 동일 기준, 외부 Project header 블록 mb-4 제거 반영).
- `ProjectPicker` 내부에서 `navigate(/conversations/:encoded)` 로 이동 시 `?sid=` 쿼리를 누락시키므로, 프로젝트 전환 시 sid 제거 요구사항 충족.
- `npm run typecheck` 결과 사전 존재하던 `MessageContent.tsx(93,30)` 1건 외 에러 없음.

### Step 7 (2026-04-20)
- `SessionSummary` 타입을 `SessionPicker.tsx` 내부로 인라인 이관 후 export, `ProjectSummary` 타입도 `ProjectPicker.tsx` 내부로 인라인 이관 후 export.
- 4개 라우트 파일(`requests.tsx`, `requests.$sessionId.tsx`, `conversations.tsx`, `conversations.$projectId.tsx`) 의 type-only import 경로를 `SessionSidebar`/`ProjectSidebar` → `SessionPicker`/`ProjectPicker` 로 교체.
- 레거시 파일 3개 삭제: `CollapsibleSidebar.tsx`, `SessionSidebar.tsx`, `ProjectSidebar.tsx`. `rg "CollapsibleSidebar|SessionSidebar|ProjectSidebar" web/app` 결과 0 건 확인.
- `.refs/project-map.md` 업데이트: 파일 트리의 routes 설명(`requests.tsx`/`conversations.tsx` → TopNav + 전체 폭 Outlet, 자식 라우트 → 좌측 패널 상단에 Picker), components 목록(`CollapsibleSidebar`/`SessionSidebar`/`ProjectSidebar` 제거, `SessionPicker`/`ProjectPicker` 추가), "수정 금지 / 주의 영역" 의 sidebar 영속화 항목을 `HorizontalSplit` 전용으로 축소.
- `npm run typecheck` 결과 사전 존재하던 `MessageContent.tsx(93,30)` 1건 외 에러 없음 (본 변경과 무관).
- **Deviation**: `npm run lint` 는 사전부터 존재하던 설정 이슈로 실패 — ESLint 가 `.gitignore` 를 `--ignore-path` 로 읽으려 하나 `web/.gitignore` 파일이 존재하지 않아 `ENOENT`. 본 단계 변경과 무관한 사전 repo 상태이며, 레이아웃 작업 범위 밖이므로 수정하지 않음. 플랜의 lint 통과 조건은 환경 제약으로 검증 불가 (typecheck 및 grep 검증은 통과).
