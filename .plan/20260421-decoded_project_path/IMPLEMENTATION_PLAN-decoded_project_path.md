# Implementation Plan: Decoded Project Path as Display Name

**Source requirements:** `requirements-decoded_project_path.md`
**Generated:** 2026-04-21

## Overview
Claude Code 가 project 디렉터리 이름을 encoding 할 때 path separator 를 `-` 로 치환해버려서, 경로 마지막 폴더 이름에 `-` 가 포함된 프로젝트(예: `claude-code-proxy`)는 현재 `projectDisplayName` 이 마지막 hyphen 토큰(`proxy`) 만 잘라 쓰는 한계가 있다. 본 작업은 encoded path 를 실제 파일 시스템 존재 여부로 점층 복원하여 정확한 프로젝트 이름(또는 남은 미확인 잔여 경로)을 UI 에 표시하도록 한다. 변경 범위는 Go 백엔드의 project summary 생성 로직과 Remix UI 의 project 목록 표시 두 레이어로 한정된다.

## Task Breakdown

| #  | Status | Step                                                            | Files Affected                                                                                                  | Complexity |
|----|--------|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|------------|
| 1  | ✅     | Encoded path 복원 함수 + 단위 테스트 추가                       | `proxy/internal/service/conversation.go`, `proxy/internal/service/conversation_test.go`                         | Medium     |
| 2  | ✅     | `projectDisplayName` 이 복원 함수 사용하도록 교체               | `proxy/internal/service/conversation.go`, `proxy/internal/service/conversation_test.go`                         | Low        |
| 3  | ✅     | Web UI 프로젝트 목록의 상단 라벨을 복원된 displayName 으로 교체 | `web/app/components/ProjectPicker.tsx` (검증만, 이미 displayName 사용), `.refs/project-map.md`                   | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

## Step Detail

### Step 1: Encoded path 복원 함수 + 단위 테스트 추가
- **Goal:** Encoded project path (예: `-Users-syoh-Development-thatseeup-claude-code-proxy`) 를 파일 시스템 존재 여부에 기반하여 `(확인된 디렉토리, 미확인된 나머지)` 로 점층 복원하는 순수 함수를 `service` 패키지에 도입하고, 실제 디스크 없이도 테스트 가능하도록 stat 함수를 주입 가능하게 한다.
- **Preconditions:** baseline repo state. `proxy/internal/service/conversation.go` 에 `projectDisplayName` 이 존재하고, Go 1.20 테스트 러너가 동작한다.
- **Changes:**
  - `conversation.go` 에 새 함수 `decodeProjectPath(encoded string, existsFn func(string) bool) (resolved string, remainder string)` 또는 동등한 구조체 반환 함수를 추가. 앞부분 `-` 제거 후 `-` 로 split → 앞에서부터 누적하면서 `existsFn` 이 true 인 가장 긴 prefix 를 `resolved` 에 담고, 이어지는 나머지 토큰은 `-` 로 다시 join 해 `remainder` 에 담는다 (요구서 알고리즘 그대로).
  - Edge case 처리: 빈 문자열, 선두 `-` 없는 경우, 어떤 prefix 도 존재하지 않는 경우(`resolved=""`, `remainder=` 원문 전체), 전부 존재해 `remainder=""` 인 경우.
  - 기본 `existsFn` 은 `func(p string) bool { info, err := os.Stat(p); return err == nil && info.IsDir() }` 를 래핑한 non-exported 헬퍼로 제공.
  - `conversation_test.go` 에 `decodeProjectPath` 테이블 테스트 추가: stub `existsFn` 으로 요구서 예시(`claude-code-proxy` 케이스), 단일 세그먼트, 전체 미존재, 부분 매칭 후 뒤쪽 전체 미존재, 빈 문자열을 커버.
- **Files:** `proxy/internal/service/conversation.go`, `proxy/internal/service/conversation_test.go`
- **Done condition:** `cd proxy && go test ./internal/service -run TestDecodeProjectPath -v` 가 모든 서브테스트 PASS 로 종료한다.
- **Rollback:** 추가된 함수와 테스트를 삭제하고 `conversation.go` 를 원상 복구 (purely additive 이므로 리그레션 위험 낮음).
- **Notes:** 순수 함수로 유지하고 `GetProjects` 변경은 Step 2 에서 수행. 이 단계에서는 `projectDisplayName` 호출부를 바꾸지 않는다.

### Step 2: `projectDisplayName` 이 복원 함수 사용하도록 교체
- **Goal:** `GetProjects` 가 각 entry 의 display name 을 생성할 때 Step 1 의 복원 함수를 사용하여, 남은 잔여(remainder) 가 있으면 remainder 를, 없으면 확인된 디렉토리의 마지막 path 세그먼트(`filepath.Base`) 를 displayName 으로 반환하도록 한다.
- **Preconditions:** Step 1 의 `decodeProjectPath` 함수와 테스트가 머지되어 있다.
- **Changes:**
  - `projectDisplayName(projectPath string) string` 내부를 재작성: `decodeProjectPath` 호출 → `remainder != ""` 이면 remainder 반환, 아니면 `filepath.Base(resolved)` 반환, 둘 다 공백이면 원본 `projectPath` 로 폴백.
  - 기존 hyphen-split fallback 로직 제거 (더 이상 불필요).
  - `GetProjects` 의 호출부는 그대로 두되, 호출 시점마다 디스크 stat 이 수행되므로(프로젝트 수만큼) 성능은 `entries` 루프 안에서만 영향. 별도 캐시 도입하지 않는다.
  - `conversation_test.go` 에 `TestProjectDisplayName` 업데이트/추가: `existsFn` 주입 버전의 내부 호출을 테스트하거나, 실제 파일 시스템에서 `t.TempDir()` 로 `Users/<user>/...` 구조를 흉내내 end-to-end 로 검증.
- **Files:** `proxy/internal/service/conversation.go`, `proxy/internal/service/conversation_test.go`
- **Done condition:** `cd proxy && go test ./internal/service -v` 가 전부 PASS. 추가로 `cd proxy && go build ./...` 성공.
- **Rollback:** `projectDisplayName` 을 Step 1 이전 구현(단순 last-hyphen-token)으로 되돌린다. `decodeProjectPath` 는 남겨두어도 무방(미사용).
- **Notes:** 요구서의 "미확인된 나머지가 없는 경우 = 확인된 디렉토리의 마지막 pathname" 규칙은 `filepath.Base` 로 구현. 파일 시스템에 삭제된 프로젝트도 remainder 그대로 노출되므로 Step 3 에서 UX 변화가 의도대로 드러나는지 확인한다.

### Step 3: Web UI 프로젝트 목록 상단 라벨을 복원된 displayName 으로 교체 + project-map 갱신
- **Goal:** `ProjectPicker` 드롭다운의 각 항목 상단 라벨이 Step 2 결과의 displayName(복원된 실제 폴더 이름) 으로 표시되며, `-` 가 포함된 프로젝트(`claude-code-proxy`)가 올바르게 전체 이름으로 보이는지 end-to-end 로 확인한다. 구조 변경을 `.refs/project-map.md` 에 반영한다.
- **Preconditions:** Step 2 완료. `/api/projects` 응답의 `displayName` 필드가 이미 새 로직으로 생성된다.
- **Changes:**
  - `ProjectPicker.tsx` 는 현재 이미 `p.displayName` 을 라벨로 사용하므로 코드 변경 없음이 원칙 (요구서의 "상단의 'endeded-cwd의 마지막'을 프로젝트 이름으로 대체" 는 백엔드 변경만으로 충족). 변경이 필요하다면 아래 검증에서 드러난 gap 만 수정한다.
  - 수동 검증: `./run.sh` 로 proxy+web 기동 → 브라우저에서 `/conversations` 접속 → `ProjectPicker` 드롭다운에서 현재 리포지토리의 프로젝트 항목 라벨이 `claude-code-proxy` (전체) 로 보이는지 확인. 삭제된/이동된 프로젝트 디렉토리가 있다면 remainder 가 표시되는지도 확인.
  - `.refs/project-map.md` 의 `service.conversation.go` 설명 줄과 "수정 금지 / 주의 영역" 섹션(필요 시) 을 업데이트: `projectDisplayName` 이 파일 시스템 stat 에 의존한다는 점, 신규 `decodeProjectPath` 함수의 역할을 한 줄씩 추가.
- **Files:** `web/app/components/ProjectPicker.tsx` (코드 수정이 필요한 경우에만), `.refs/project-map.md`
- **Done condition:** 아래 두 가지를 모두 만족.
  1. `curl -s http://localhost:3001/api/projects | jq '.[] | select(.projectPath=="-Users-syoh-Development-thatseeup-claude-code-proxy") | .displayName'` 가 `"claude-code-proxy"` (따옴표 포함) 를 출력.
  2. `.refs/project-map.md` 의 diff 에 `decodeProjectPath` 또는 "파일 시스템 복원" 언급이 추가되어 있다 (`grep -n 'decodeProjectPath\|복원' .refs/project-map.md` 로 확인).
- **Rollback:** `.refs/project-map.md` 의 해당 섹션을 원복. `ProjectPicker.tsx` 를 수정했다면 그 diff 도 되돌린다.
- **Notes:** Step 2 에서 백엔드가 올바른 displayName 을 내보내면 UI 쪽 수정 없이도 라벨이 갱신된다. UI 수정이 불필요함을 확인한 경우 "코드 변경 없음 + project-map 갱신" 만으로 본 단계를 마감한다.

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-21)
- 플랜에는 "앞에서부터 누적하면서 existsFn 이 true 인 가장 긴 prefix" 알고리즘으로 서술되어 있으나, 다중 하이픈을 포함한 중간 디렉토리(`claude-code-proxy` 같은 최종 세그먼트 및 `my-app` 같은 중간 세그먼트)까지 복원하려면 각 위치에서 단일 토큰이 아니라 "i 부터 j 까지 토큰들을 `-` 로 join 한 세그먼트" 중 가장 긴 매칭을 찾는 O(n²) lookahead 가 필요했다. 구현은 요구서의 의도(가장 긴 존재 prefix)를 따르되 세그먼트 단위 lookahead 로 확장됨.
- 테이블 테스트에 요구서 예시 외에도 단일 세그먼트, 전체 미존재, 부분 매칭, 빈 문자열, 선두 `-` 없음, 하이픈 포함 중간 디렉토리, 더 긴 merged form 이 없을 때 shorter match 선호 — 총 8개 서브테스트를 포함.

### Step 2 (2026-04-21)
- `projectDisplayName` 의 테스트 가능성을 위해 내부 헬퍼 `projectDisplayNameWith(projectPath, existsFn)` 를 추가. 공개 시그니처(`projectDisplayName(projectPath string) string`)는 유지하고, 내부에서 `projectDisplayNameWith(projectPath, nil)` 로 위임한다. 이로써 `GetProjects` 호출부는 변경 없이 기존 시그니처를 그대로 사용하며, 테스트는 `existsFn` 스텁을 주입해 디스크 없이 검증 가능.
- 계획대로 기존 hyphen-split fallback 로직은 제거됨. 폴백 순서: remainder 가 있으면 remainder → resolved 가 있으면 `filepath.Base(resolved)` → 둘 다 없으면 원본 `projectPath` 반환 (빈 문자열 포함).
- `TestProjectDisplayName` 서브테스트 6개 추가: hyphenated final dir 보존, simple path last segment, unresolved tail, 전체 미해결, 빈 문자열, 하이픈 포함 중간 디렉토리. `go test ./internal/service -v` 와 `go build ./...` 모두 통과.
- IDE 린터가 테스트 테이블 내 문자열 리터럴 중복(`"/Users"` 등)에 대해 `go:S1192` 경고를 냈으나, 테스트 테이블의 가독성을 해치지 않기 위해 상수 추출은 하지 않음 (경고만 무시).

### Step 3 (2026-04-21)
- 계획대로 `ProjectPicker.tsx` 는 이미 `p.displayName` 을 상단 라벨로 사용 중 — 코드 수정 없음.
- Done condition #1 검증: 사용자의 기존 `./run.sh` 프로세스(구 바이너리 기동 중)를 중단하지 않기 위해, 신규 빌드 바이너리를 `/tmp/proxy-test` 에 만들고 `PORT=3099` 로 일시 기동해 `curl -s http://localhost:3099/api/projects | jq '.[] | select(.projectPath=="-Users-syoh-Development-thatseeup-claude-code-proxy") | .displayName'` 이 `"claude-code-proxy"` 를 리턴함을 확인한 뒤 즉시 종료. 다음 번 `./run.sh` 재기동부터 체감 반영되도록 `bin/proxy` 도 함께 리빌드.
- Done condition #2 검증: `.refs/project-map.md` 에 두 곳 추가 — 파일 트리의 `conversation.go` 라인, 그리고 "수정 금지 / 주의 영역" 표의 신규 행(`decodeProjectPath` / `projectDisplayName`). `grep -n 'decodeProjectPath\|복원' .refs/project-map.md` 으로 확인됨.
