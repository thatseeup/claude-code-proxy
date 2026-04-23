# CHUNK-TS-01 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23
- Files reviewed: 3 (904 LOC)
  - proxy/internal/service/conversation_test.go (318 LOC)
  - proxy/internal/service/model_router_test.go (137 LOC)
  - proxy/internal/service/session_index_test.go (449 LOC)
- Sampling: none (전량 판독)
- Reviewer: o-web-reviewer subagent
- Scope: Go 단위 테스트 — 테이블 드리븐, fsnotify + polling 동시성 테스트, 파일 시스템 픽스처

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 | 최대 파라미터 / 리턴 | import | export (Test*/helper) |
|---|---|---|---|---|---|---|
| conversation_test.go | 318 | ~106 (`TestExtractSessionTitle`) | 3 | 4 | 3 | 4 |
| model_router_test.go | 137 | ~79 (`TestModelRouter_EdgeCases`) | 3 | 2 | 6 | 3 |
| session_index_test.go | 449 ⚠️ | ~45 | 4 | **리턴 6개 (`buildTestProjectsDir`)** ⚠️ | 7 | 11 |

*(테스트 파일이므로 LOC>300 초과는 지침에 따라 플래그만 달고 심각도 하향)*

### D3 의존성

- 외부 import: `context`, `fmt`, `os`, `path/filepath`, `sync`, `testing`, `time` + internal `config`, `model`, `provider`
- 패키지-프라이빗 접근: `newSessionIndexWithPollInterval`, `extractSessionTitle`, `decodeProjectPath`, `projectDisplayNameWith`, `ModelRouter.extractStaticPrompt` — 모두 `package service` 내부 접근 (적절)
- Fan-out 과다 파일: 없음
- 순환 의존: 없음 (`_test.go` → 같은 패키지만)

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 | 비고 |
|---|---|---|---|
| 비밀 패턴 | 0 | D1, D4 | 하드코딩 credential 없음 |
| 디버그 로그 잔존 | 0 | D1 | — |
| any 남용 | 0 | D1 | Go |
| SQL injection 의심 | 0 | D4 | DB 접근 없음 |
| XSS / eval / exec | 0 | D4 | — |
| CORS 와일드카드 | 0 | D4 | — |
| 민감정보 로깅 | 0 | D4 | — |
| `time.Sleep` (flaky 후보) | 5 | D1 | `session_index_test.go:299,323,367,412,438` |
| `go func()` + 테스트 종료 시 join 누락 | 4 | D1 | Watch 테스트 4곳 |
| 하드코딩 절대경로 | 1 | D1 | `/nonexistent-path-that-cannot-exist-xyz` (L130) |
| 커스텀 `contains` 대체 (strings.Contains 재구현) | 1 | D1 | `model_router_test.go:133-137` |

### 테스트 구조

- 테이블 드리븐 사용: `TestDecodeProjectPath`(8케이스), `TestProjectDisplayName`(6), `TestModelRouter_EdgeCases`(3), `TestModelRouter_ExtractStaticPrompt`(4)
- 서브테스트 사용: `TestExtractSessionTitle`(7), `TestSessionIndexRebuild`(4)
- `t.TempDir()` 사용: 10곳 (모두 Go 기본 cleanup 활용 — 적절)
- `t.Parallel()` 사용: **0곳** (순수 계산 테스트에도 미적용)
- `t.Helper()` 사용: 3곳 (`newExistsFn` 외, `writeTempJSONL`/`writeJSONLLines`/`waitForCondition`/`buildTestProjectsDir`)

### AI 분석 친화성
- 타입 시그니처 완비도: 100% (Go 표준)
- 명명 일관성: OK (`Test<Unit><Case>` 규약 준수)
- 파일명 ↔ 대상 소스 매칭: OK (`_test.go` 관행)

## 발견된 이슈 (심각도순, 통합)

### [High] [D1] `TestModelRouter_EdgeCases` 테이블 필드 3개가 assertion에 사용되지 않음 — 실질적으로 무효 테스트
- 파일: `proxy/internal/service/model_router_test.go:30-90`
- 증거:
  ```go
  tests := []struct {
      name          string
      request       *model.AnthropicRequest
      expectedRoute string   // ← 선언만 되고
      expectedModel string   // ← 선언만 되고
      description   string
  }{ /* 3 cases */ }

  for _, tt := range tests {
      t.Run(tt.name, func(t *testing.T) {
          if len(tt.request.System) == 2 {
              fullPrompt := tt.request.System[1].Text
              staticPrompt := router.extractStaticPrompt(fullPrompt)
              if contains(staticPrompt, "Notes:") { t.Errorf(...) }
          }
          t.Logf("Test case: %s", tt.description)   // ← 나머지는 로그만
      })
  }
  ```
- 설명: `expectedRoute`/`expectedModel` 필드는 선언되나 실제 `router.DetermineRoute(tt.request)` 호출 및 비교가 없음. 2-system-message 케이스의 `Notes:` 미포함만 부분 검증. 1개/0개 케이스는 `t.Logf`뿐이어서 `PASS`가 보장된다.
- 수정 제안: `router.DetermineRoute(tt.request)` 호출하여 `expectedRoute`/`expectedModel` 비교 어서션 추가. 또는 사용하지 않을 필드는 구조체에서 제거.

### [High] [D1] `model_router_test.go:133-137` — `strings.Contains`를 재구현한 커스텀 `contains` (버그 가능성 + dead code 대체)
- 파일: `proxy/internal/service/model_router_test.go:133-137`
- 증거:
  ```go
  func contains(s, substr string) bool {
      return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
          (len(s) > 0 && len(substr) > 0 && s[0:len(substr)] == substr) ||
          (len(s) > len(substr) && contains(s[1:], substr)))
  }
  ```
- 설명: 표준 라이브러리 `strings.Contains`를 재귀로 재구현. 동등 조건/빈 문자열 에지 케이스가 꼬여 있어 유지보수 리스크가 높고, 성능도 O(n*m) 재귀 호출 스택. 이 테스트 파일에서만 사용되며, `strings` 패키지 import 한 줄로 대체 가능.
- 수정 제안: `import "strings"` 후 `strings.Contains(s, substr)` 사용, 커스텀 함수 삭제.

### [High] [D1] Watch 테스트 4곳이 `go func() { idx.Watch(ctx) }()`를 띄우고 종료 대기 없이 return — goroutine leak & 에러 은폐
- 파일: `proxy/internal/service/session_index_test.go:320, 364, 409, 435`
- 증거 (대표):
  ```go
  ctx, cancel := context.WithCancel(context.Background())
  defer cancel()
  go func() { _ = idx.Watch(ctx) }()   // ← 반환 에러 버림 + 종료 대기 없음
  // ... 테스트 본문 ...
  // 테스트 함수 return 시점에 Watch 고루틴이 아직 살아 있을 수 있음
  ```
- 설명: `defer cancel()`로 ctx는 취소되지만, Watch 고루틴이 실제 종료되기 전에 테스트 함수가 반환한다. 다음 테스트로 넘어가면서 파일 시스템 이벤트/rebuild 로그가 섞이거나, 이전 고루틴의 panic이 다른 테스트에서 잡혀 flaky 원인이 될 수 있다. 또한 Watch 반환 에러(`ctx.Err()` 외 예외)는 `_`로 버려져 flaky 진단이 불가능하다.
- 수정 제안:
  ```go
  done := make(chan error, 1)
  go func() { done <- idx.Watch(ctx) }()
  t.Cleanup(func() {
      cancel()
      select {
      case err := <-done:
          if err != nil && err != context.Canceled { t.Errorf("Watch: %v", err) }
      case <-time.After(2 * time.Second):
          t.Error("Watch did not exit")
      }
  })
  ```
  (이미 `TestSessionIndexWatchContextCancel`이 이 패턴을 쓰므로 helper로 승격.)

### [High] [D1] 커버리지 공백 — fsnotify happy-path 테스트 부재 (polling fallback만 테스트됨)
- 파일: `proxy/internal/service/session_index_test.go:284-424` (섹션 헤더)
- 증거:
  ```go
  // ---------------------------------------------------------------------------
  // Watch tests (polling mode forced via newSessionIndexWithPollInterval)
  // ---------------------------------------------------------------------------
  ```
  모든 Watch 테스트가 `newSessionIndexWithPollInterval` 경유 → Watch 함수 L156–206의 fsnotify 분기(event 디스패치, `handleFSEvent` 315 L208+, watcher.Add 재귀)는 **미커버**.
- 설명: 프로덕션 `Watch`는 먼저 fsnotify를 시도하고 실패 시에만 polling으로 폴백한다. 리눅스/macOS 정상 환경에서는 fsnotify 경로가 primary — 이 경로가 테스트되지 않으면 회귀를 감지할 수 없다.
- 수정 제안: `TestSessionIndexWatchFSNotify{Create,Modify,Delete,NewSubdir}` 추가. polling 테스트보다 짧은 deadline(예: 500ms)으로 `handleFSEvent`까지 검증. CI가 fsnotify를 지원하지 않는 환경이면 `t.Skip` 가드.

### [High] [D1] `TestSessionIndexConcurrency`가 **어서션 없음** — `-race` 전용 테스트
- 파일: `proxy/internal/service/session_index_test.go:178-205`
- 증거:
  ```go
  for i := 0; i < goroutines; i++ {
      i := i
      go func() {
          defer wg.Done()
          if i%3 == 0 { _ = idx.Rebuild() }
          else { for _, sid := range [...] { _, _ = idx.Lookup(sid) } }
      }()
  }
  wg.Wait()
  // ← 여기서 아무것도 검증하지 않음
  ```
- 설명: `-race` 빌드에서만 의미가 있는 테스트. 평상시 `go test`는 항상 PASS. race detector 없이는 "존재만" 하는 테스트가 된다. 또한 Rebuild 중간에 Lookup이 일관된 스냅샷을 반환하는지(atomic swap 보장)도 검증하지 못함.
- 수정 제안: Lookup 결과가 `ok==true`인 경우 Title이 `"Alpha Session One"` 또는 `"Alpha Custom Two"` 중 하나와 일치해야 함을 assert. 패키지 테스트 매뉴얼에 `-race` 필수임을 주석으로 명시.

### [Medium] [D1] `TestSessionIndexRootMissing`이 호스트 파일 시스템에 가정을 둠 (`/nonexistent-path-that-cannot-exist-xyz`)
- 파일: `proxy/internal/service/session_index_test.go:129-138`
- 증거:
  ```go
  idx := NewSessionIndex("/nonexistent-path-that-cannot-exist-xyz", nil)
  ```
- 설명: 호스트에 우연히 해당 경로가 존재하면 테스트가 실패 또는 flaky. `t.TempDir()`로 unique path를 생성해 `filepath.Join`으로 서브경로 지정하면 항상 재현 가능.
- 수정 제안:
  ```go
  missing := filepath.Join(t.TempDir(), "missing-xyz")
  idx := NewSessionIndex(missing, nil)
  ```

### [Medium] [D1] Watch 테스트의 startup-sleep 패턴이 flaky 가능성 있음
- 파일: `proxy/internal/service/session_index_test.go:323, 367, 412, 438`
- 증거:
  ```go
  go func() { _ = idx.Watch(ctx) }()
  time.Sleep(watchTestPollInterval)   // 50ms
  // 이후 파일 생성/수정
  ```
- 설명: 느린 CI/컨테이너에서 `Watch` 고루틴이 50ms 내에 `watcher.Add`를 완료하지 못하면, 이후 파일 mutation이 첫 poll 시점 이전에 발생해도 감지되긴 하지만, 타이밍 경계에서 `waitForCondition(2s)`의 여유분까지 소진할 수 있다. 보다 결정적으로는 Watch 내부가 "준비 완료" 시그널을 제공하는 편이 이상적.
- 수정 제안: Watch에 optional ready 채널 주입 (production API 변경이 부담되면 테스트 전용 `readyCh`를 `newSessionIndexWithPollInterval`에 파라미터 추가) 또는 `waitForCondition`만으로 모든 상태를 대기하도록 리팩토링하여 명시적 sleep 제거.

### [Medium] [D2] `writeTempJSONL` / `writeJSONLLines` — 두 테스트 파일 간 헬퍼 중복
- 파일: `proxy/internal/service/conversation_test.go:200-211` + `proxy/internal/service/session_index_test.go:62-71`
- 증거: 로직이 사실상 동일 (`content += l + "\n"` + `os.WriteFile(path, []byte(content), 0o644)`).
- 설명: 두 헬퍼가 DRY 위반. 테스트 픽스처 관리 관점에서 공용 `testhelpers_test.go` 또는 같은 패키지 내부 공용 헬퍼로 승격해야 유지보수 1곳.
- 수정 제안: 같은 package 내 `internal_test_fixtures.go` (build tag `test` 또는 `_test.go` 공통 헬퍼)로 추출. Go 관례상 `testutils_test.go` 파일명 사용.

### [Medium] [D2] `buildTestProjectsDir` 리턴 6개 — 호출 시 `_` 3개 필요 (임계값 초과)
- 파일: `proxy/internal/service/session_index_test.go:22, 76, 179`
- 증거:
  ```go
  func buildTestProjectsDir(t *testing.T) (rootDir string, encodedProjA, encodedProjB, sid1, sid2, sid3 string) { ... }
  // 호출부
  rootDir, _, _, sid1, sid2, _ := buildTestProjectsDir(t)
  ```
- 설명: 6개 리턴 → 호출부마다 `_` 블랭크로 버림. 임계값(파라미터>5) 초과. 픽스처 구조체로 묶으면 호출부 가독성↑.
- 수정 제안:
  ```go
  type testProjectsFixture struct {
      rootDir                 string
      encodedProjA, encodedProjB string
      sid1, sid2, sid3        string
  }
  func buildTestProjectsDir(t *testing.T) testProjectsFixture { ... }
  ```

### [Medium] [D1] `ProjectPath != ""`만 검증 — weak assertion
- 파일: `proxy/internal/service/session_index_test.go:94-96`
- 증거:
  ```go
  if e.ProjectPath == "" {
      t.Error("ProjectPath is empty")
  }
  ```
- 설명: ProjectPath가 `"/"`, `"foo"`, 기대와 다른 디렉토리여도 PASS. `decodeProjectPath`가 실제 호출되는 경로임에도 값 정확성 미검증.
- 수정 제안: `expected := filepath.Join(rootDir, encodedProjA)` 와 `e.ProjectPath` 비교, 또는 displayName까지 검증.

### [Medium] [D1] 커버리지 공백 — `extractSessionTitle`의 대용량/긴 라인 에지 케이스 미검증
- 파일: `proxy/internal/service/conversation_test.go:213-318`
- 설명: 프로덕션 코드는 4MB scanner buffer (FIXES #26 참조)를 사용하지만, 이 테스트는 짧은 라인만 검증. `bufio.Scanner` 기본 한도(64KB) 초과 라인/4MB 이상 라인에서의 동작은 미검증. 이전 리뷰에서 매직넘버로 지적된 값이므로 테스트도 같이 고정하는 편이 회귀 방지.
- 수정 제안: 100KB/5MB 두 경계 라인 테스트 추가.

### [Medium] [D1] `TestModelRouter_EdgeCases`가 `nil` Provider로 `NewModelRouter`만 생성 — routing behavior 미커버
- 파일: `proxy/internal/service/model_router_test.go:23-28`
- 증거:
  ```go
  providers := make(map[string]provider.Provider)
  providers["anthropic"] = nil
  providers["openai"] = nil
  ```
- 설명: `DetermineRoute`/`loadCustomAgents` 같은 핵심 경로 테스트 부재. 주 관심사인 "Claude Code 프롬프트 감지 → subagent 매핑" 경로의 실제 동작을 검증하지 않음.
- 수정 제안: `DetermineRoute`에 대한 별도 테이블 드리븐 테스트 추가 (system 프롬프트의 "Notes:" 블록 존재 시 original route 유지 vs subagent 매핑 적용).

### [Low] [D1] 순수 계산 테스트에 `t.Parallel()` 미사용
- 파일: `conversation_test.go:22-123, 125-197`, `model_router_test.go:93-131`
- 설명: `TestDecodeProjectPath`, `TestProjectDisplayName`, `TestModelRouter_ExtractStaticPrompt`는 외부 상태 없음. `t.Parallel()` 추가 시 테스트 스위트 총 시간 단축 가능.
- 수정 제안: 서브테스트 `t.Run` 직후 `t.Parallel()` 추가.

### [Low] [D2] Watch polling 테스트 3개(`Create`/`Modify`/`Delete`)가 구조적으로 유사 — 테이블 드리븐 대상
- 파일: `proxy/internal/service/session_index_test.go:304-424`
- 설명: 동일한 setup→Watch→mutation→waitForCondition 골격이 3회 반복. 픽스처/액션을 테이블화하면 중복 제거 및 새 케이스 추가 용이.
- 수정 제안:
  ```go
  tests := []struct {
      name    string
      setup   func(t *testing.T, dir string) string // returns sid
      action  func(t *testing.T, dir, sid string)
      verify  func(*sessionIndexImpl, string) bool
  }{...}
  ```

### [Low] [D4] 테스트 파일 권한 `0o644` — 표준 관행이지만 명시적 주석 권장
- 파일: 모든 `os.WriteFile(..., 0o644)` / `os.MkdirAll(..., 0o755)` 호출부
- 설명: 실제 credential 없고 `t.TempDir()` 하위에 작성되어 cleanup 되므로 실제 위험 없음. 다만 팀 관행상 테스트 fixture 권한 `0o600`/`0o700`으로 통일하는 정책이 있다면 리뷰 대상.

## 긍정적 관찰

- `t.Helper()` 일관 적용 (`writeTempJSONL`, `writeJSONLLines`, `waitForCondition`, `buildTestProjectsDir`) — 에러 리포트가 호출부 라인을 가리킴. 모범적.
- `t.TempDir()` 사용 10곳 — 모두 자동 cleanup. 수동 `os.RemoveAll` 누락 없음.
- `newExistsFn` (conversation_test.go:11) — 실제 파일 시스템 의존 없이 `decodeProjectPath` 단위 테스트를 가능하게 한 DI 디자인. 프로덕션 코드의 `existsFn func(string) bool` seam과 잘 결합.
- 패키지-프라이빗 `newSessionIndexWithPollInterval` 사용 (session_index_test.go:313 등) — 프로덕션 API는 10초 고정이지만 테스트는 50ms로 가속. 테스트 전용 생성자 패턴이 적절히 분리됨.
- `TestSessionIndexWatchContextCancel` — `done` 채널 + `select { case err := <-done: ... case <-time.After: ... }` 패턴으로 Watch 종료를 **명시적으로 기다림**. 다른 Watch 테스트도 이 패턴을 따라야 함(High 이슈 참조).
- `TestSessionIndexRebuildAtomicSwap` — 첫 번째 Rebuild 후 파일을 덮어쓰고 두 번째 Rebuild가 이전 상태를 완전히 대체하는지 검증. 원자적 교체(atomic swap) 시맨틱의 명시적 테스트로 우수.
- 테이블 드리븐 테스트의 `tc := tc` 변수 재캡처 패턴(conversation_test.go:112, 189) — subtest 병렬화 대비 안전장치. (Go 1.22+에서는 자동이지만 호환 유지 좋음.)

## Cross-cutting 리뷰 시 참고 단서

- **CC-FSNotify-Coverage**: polling fallback만 테스트되고 fsnotify happy-path 미테스트. CC 단계에서 `session_index.go:156-206` 분기 전체가 실제로 실행되는지 통합 테스트 고려.
- **CC-TestHelper-Duplication**: `writeTempJSONL` vs `writeJSONLLines` 중복. 백엔드 여러 테스트 파일에서 JSONL 픽스처를 쓴다면 공용 헬퍼 패키지(`internal/testutil`)로 승격 검토.
- **CC-ModelRouter-TestGap**: `DetermineRoute`/`loadCustomAgents` 테스트 완전 부재. FIXES #40, #48, #49(CHUNK-BE-03)가 지적한 프로덕션 취약점들이 테스트로 고정되어 있지 않음 — 리팩토링 시 회귀 위험 높음.
- **CC-Goroutine-Hygiene**: Watch 테스트 4곳의 goroutine join 누락은 `-race`가 보완해주지만, CI에 race 없이 빌드하는 파이프라인이 있다면 주의.
- **CC-Flaky**: `time.Sleep(50ms)` 스타트업 패드 5곳. 추후 CI에서 flaky가 목격되면 이 지점부터 제거 검토.
