# UI 레이아웃 재구성 (TopNav + 좌측 목록 + 우측 상세)

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도

현재 화면은 한 페이지에 사실상 3개 컬럼(접이식 Sidebar + 좌측 목록 패널 + 우측 상세 패널)이 공존한다. 결과적으로:

- 페이지 전체 폭을 충분히 활용하지 못한다.
- Sidebar(세션/프로젝트 선택)와 본문 좌측의 "목록" 역할이 겹쳐 시각적으로 혼란스럽다.
- 상세 패널이 좁아져서 긴 요청/응답 본문을 읽기 불편하다.

GitHub 저장소 화면(좌: 파일 트리, 우: 파일 내용)처럼 **2개 컬럼만** 남기는 것이 목표다.

목표 구조:
- TopNav: `Requests | Conversations` 탭 선택 (현재 유지)
- 본문: 좌(목록 패널) + 우(상세 패널) 의 단일 2단 구성
- 별도의 Sidebar 컬럼은 제거하고, 그 역할을 좌측 목록 패널에 흡수

## 제거: 별도 Sidebar 컬럼

현재 `CollapsibleSidebar` 가 감싸는 `SessionSidebar` / `ProjectSidebar` 를 본문과 별개의 컬럼으로 두는 구성을 폐기한다.

- `CollapsibleSidebar` 사용 중단 (구조에서 제거)
- 사이드바 열기/닫기 토글 UI 제거
- "Sessions" / "Projects" 선택 기능은 사라지지 않는다 — 좌측 목록 패널 내부로 통합된다 (아래 참조)

## Requests 화면 — 2단 구성

`/requests` 및 `/requests/:sessionId` 경로의 레이아웃:

좌측 패널 (목록):
- 상단: 세션 선택 영역
  - 현재 선택된 세션 표시
  - 세션 전환 UI (드롭다운/팝오버 또는 동급의 선택자)
  - 세션 단위 삭제 액션 유지 (현재 SessionSidebar 의 행별 휴지통 기능 유지)
- 하단: 선택된 세션의 요청 목록 (현재 `requests.$sessionId.tsx` 의 좌측 리스트 내용)
- 모델 필터 (`?model=`) 유지

우측 패널 (상세):
- 선택된 요청의 상세 (현재와 동일, `?rid=` 쿼리 유지)

공통:
- 좌/우 폭은 드래그 splitter 로 조절 가능 (기존 `HorizontalSplit` 재사용)
- 폭 조절값은 저장하지 않음. 리로드 시 디폴트
- TopNav 는 페이지 상단에 그대로 유지

## Conversations 화면 — 2단 구성

`/conversations` 및 `/conversations/:projectId` 경로의 레이아웃:

좌측 패널 (목록):
- 상단: 프로젝트 선택 영역
  - 현재 선택된 프로젝트 표시
  - 프로젝트 전환 UI (드롭다운/팝오버 또는 동급의 선택자)
  - 프로젝트 삭제 액션은 없음 (jsonl 보호 — 현행 정책 유지)
- 하단: 선택된 프로젝트의 대화 목록

우측 패널 (상세):
- 선택된 대화의 상세 (현재와 동일, `?sid=` 쿼리 유지)

공통 동작은 Requests 화면과 동일하다.

## 폭 활용

- 본문 컨테이너는 페이지 전체 폭을 사용한다 (현재 사이드바가 차지하던 폭 포함).
- 좌측 목록 패널의 디폴트 폭은 현행 `HorizontalSplit` 디폴트(420px) 를 출발점으로 한다. 필요 시 적정 값으로 조정.
- 좌측 패널 min/max 는 현행(min 240, max 800) 유지.

## 라우팅 / 데이터 로더

- 라우트 경로 자체는 변경하지 않는다 (`/requests`, `/requests/:sessionId`, `/conversations`, `/conversations/:projectId`).
- 기존 redirect 동작 유지: `/requests` → 최근 세션, `/conversations` → 최근 프로젝트.
- 부모 라우트(`requests.tsx`, `conversations.tsx`) 의 loader 가 제공하던 세션/프로젝트 목록 데이터는 좌측 목록 패널 내 "선택자" 가 사용한다.

## 비목표 (이번 작업 범위 아님)

- 요청/응답 상세 뷰 자체의 레이아웃 변경
- 대화 스레드 렌더링 변경
- 백엔드 API / 스키마 변경
- 폭/선택 상태의 영속화

## 산출물 검증 기준

- TopNav 외에 별도의 Sidebar 컬럼이 화면에 존재하지 않는다.
- Requests / Conversations 각 화면이 정확히 2개 컬럼(좌: 목록, 우: 상세)으로 구성된다.
- 세션/프로젝트 전환과 삭제(요청 화면) 기능이 좌측 목록 패널 내에서 모두 가능하다.
- 좌/우 splitter 드래그가 동작하고, 리로드 시 디폴트 폭으로 돌아간다.
- 기존 쿼리 파라미터(`?rid=`, `?sid=`, `?model=`) 동작이 유지된다.
