# CHUNK-BE-03 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23T00:00:00Z
- Files reviewed: 4 (1,734 LOC)
- Sampling: none (전량 읽음)
- Reviewer: o-web-reviewer subagent

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수 LOC | 최대 중첩 | 최대 파라미터 | import | export(공개) |
|---|---|---|---|---|---|---|
| conversation.go | 574 ⚠️ | `parseConversationFile` ≈ 148 ⚠️ (L359-506) | 5 ⚠️ (L478-486 timestamp 루프) | 2 | 8 | `ConversationService`, `ProjectSummary`, `ConversationMessage`, `Conversation`, `NewConversationService` |
| model_router.go | 232 | `loadCustomAgents` ≈ 63 ⚠️ (L91-153), `DetermineRoute` ≈ 58 ⚠️ (L156-213) | 4 (L99-127) | 3 (`NewModelRouter`) | 7 | `RoutingDecision`, `ModelRouter`, `SubagentDefinition`, `NewModelRouter` |
| session_index.go | 346 ⚠️ | `Rebuild` ≈ 60 ⚠️ (L93-152), `Watch` ≈ 50 ⚠️ (L156-206) | 4 (L108-143) | 3 | 8 | `SessionIndexEntry`, `SessionIndex`, `NewSessionIndex` |
| storage_sqlite.go | 582 ⚠️ | `GetRequests` ≈ 87 ⚠️ (L102-188), `GetAllRequests` ≈ 85 ⚠️ (L313-397), `GetRequestsBySessionID` ≈ 91 ⚠️ (L403-493), `GetRequestByShortID` ≈ 69 ⚠️ (L239-307) | 3 | 2 | 9 | `NewSQLiteStorageService`, `parseStoredTimestamp` (package-internal) |

주요 임계값 초과:
- 파일 LOC>300: conversation.go, session_index.go, storage_sqlite.go (3/4)
- 함수 LOC>50: 최소 7개 함수
- 중첩 깊이>4: conversation.go::parseConversationFile

### D3 의존성

- 외부 import 모듈 수 (패키지 밖): `fsnotify`, `go-sqlite3`, 내부 `config`, `model`, `provider` (4 외부 + 3 내부)
- Fan-out 과다 파일(>25): 없음
- Fan-in (대상 함수 호출처) — 주요:
  - `NewConversationService`, `NewModelRouter`, `NewSessionIndex`, `NewSQLiteStorageService`: `proxy/cmd/proxy/main.go`, handlers.go
  - `parseConversationFile`, `extractSessionTitle`, `decodeProjectPath`, `projectDisplayName`: 같은 패키지 내/테스트
- 순환 의존 후보: 없음 (단방향: service → config/model/provider)
- 레이어 위반:
  - 없음 — service 레이어는 DB 드라이버(go-sqlite3)를 직접 import하는 것이 정상. handler가 SQL을 직접 사용하지 않음을 별도 확인 (handlers.go → storageService 인터페이스 경유).
- 응집도:
  - conversation.go: OK — 모두 jsonl 파싱 관련 (단, `decodeProjectPath`/`projectDisplayName`는 파일명 인코딩 주제로 conversation.go보다 `session_index.go`에서 더 많이 쓰이고 있어 추후 `project_path.go` 분리 여지 있음).
  - model_router.go: OK — 단일 주제(라우팅).
  - session_index.go: OK — 인덱스/watcher.
  - storage_sqlite.go: **중복성 높음** — `GetRequests/GetAllRequests/GetRequestByShortID/GetRequestsBySessionID` 4개 함수가 거의 동일한 SELECT 컬럼 + Scan + Unmarshal 블록을 반복 (총 ~280 LOC 중복). 응집도보다는 DRY 위반.

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 |
|---|---|---|
| 하드코딩 credential 유사 | 0 | D1, D4 |
| fmt.Println/printf 디버그 | 0 | D1 |
| SQL injection 의심 (문자열 결합) | 0 (모두 `?` 바인딩) | D4 |
| `LIKE '%' + input` 사용 | 3건 (L252, L322, L420) | D4 |
| `eval`/`exec.Command` | 0 | D4 |
| `interface{}` 사용 | 6건 | D1 |
| 쓰기/Close 에러 무시 (`_ =`/defer Close) | 2건 (L370 `defer file.Close()`, L539 동일) | D1 |
| 민감 정보 로깅 | 0 | D4 |
| CORS/네트워크 표면 | 0 (본 청크 범위 외) | D4 |
| 주석 TODO/FIXME | 0 | D1 |

### AI 분석 친화성

- 타입 시그니처 완비도: **96%** — 대부분 exported 심볼에 doc comment 존재. 예외: `sqliteStorageService`의 메서드들은 대부분 주석 부재 (GetRequests, GetAllRequests 등). `hashString`, `getProviderNameForModel` 주석 없음.
- 명명 일관성: **OK** — 전체 camelCase (Go 관례). `extractStaticPrompt/extractSessionTitle/extractTitleFromLine`로 동사+명사 일관. 단, `conds`/`args` 같은 짧은 지역 변수 일부.
- 파일명 vs 주 export 일치: **OK** — `conversation.go` → `Conversation*`, `model_router.go` → `ModelRouter`, `session_index.go` → `SessionIndex*`, `storage_sqlite.go` → `sqliteStorageService`.
- 주석 밀도: conversation.go·session_index.go 양호 (함수 의도 설명 충실). model_router.go 양호. storage_sqlite.go **저조** (쿼리 문자열만 반복, 의도 주석 거의 없음).

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D4] `GetRequestByShortID`의 suffix-prefix LIKE 매칭이 requestID가 아닌 무관 id와 충돌할 수 있음

- 파일: `proxy/internal/service/storage_sqlite.go:239-270`
- 증거:
  ```go
  query := `
      SELECT id, timestamp, ...
      FROM requests
      WHERE id LIKE ?
      ORDER BY timestamp DESC
      LIMIT 1
  `
  ...
  err := s.db.QueryRow(query, "%"+shortID).Scan(...)
  ```
- 설명: 사용자 제공 `shortID` 문자열이 바인딩 인자로 넘어가기 때문에 SQL 인젝션은 아니지만, 다음 두 가지 이슈가 있다.
  1. **LIKE 메타문자 미이스케이프**: `shortID`에 `%` 또는 `_`가 포함되면 예상 외 id와 매칭된다. handler 경로(`/api/requests/{id}` 등) 어디선가 짧은 prefix를 그대로 받아 여기에 전달된다면 임의 행 열람이 가능해진다.
  2. **Suffix 매칭 의미**: `LIKE "%"+shortID`는 "끝이 일치"하는 모든 행 중 최신 1건을 반환한다. 8자 shortID라도 실수로 3-4자를 넘기면 **서로 다른 세션의 데이터가 반환**될 수 있다. `ORDER BY timestamp DESC LIMIT 1`이 이를 가려 버려 탐지가 어렵다.
- 수정 제안: `shortID` 길이 검증(예: ≥8자) + `%`/`_`/`\\` 이스케이프 + `LIKE ? ESCAPE '\\'` 사용. 가능하면 full UUID 정확 비교(`WHERE id = ?`)로 전환하고 shortID는 별도 인덱스 컬럼 도입.

### [High] [D2] `storage_sqlite.go` 4개 리스트 함수 ≈280 LOC 중복 (SELECT → Scan → Unmarshal)

- 파일: `proxy/internal/service/storage_sqlite.go:102-188, 239-307, 313-397, 403-493`
- 증거: 네 함수 모두 동일한 14개 컬럼 SELECT + 동일한 Scan 블록 + 동일한 `json.Unmarshal(headers/body/promptGrade/response)` 로직을 복붙.
  ```go
  // 동일 블록이 4번 반복:
  err := rows.Scan(&req.RequestID, &req.Timestamp, &req.Method, ... &sessionID)
  if sessionID.Valid { req.SessionID = sessionID.String }
  req.BodyRaw = bodyRaw
  if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil { continue }
  ```
- 설명: 컬럼 추가/변경 시 4곳 동기 수정 필요. `GetRequests`는 Scan 실패 시 `continue`(삼킴), `GetRequestByShortID`는 error 반환 — **일관성도 깨져 있음**.
- 수정 제안: `scanRequestRow(rows Scannable) (*model.RequestLog, error)` 헬퍼 추출 + `buildListQuery(filter) (string, []interface{})` 쿼리 빌더 추출.

### [High] [D1] 4개 리스트 함수 Scan/Unmarshal 에러 **무조건 `continue`** — 데이터 손실 은폐

- 파일: `proxy/internal/service/storage_sqlite.go:147-150, 158-161, 164-167, 356-358, 367-370, 373-376, 456-458, 465-467, 469-472`
- 증거:
  ```go
  if err != nil {
      // Error scanning row - skip
      continue
  }
  ...
  if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
      // Error unmarshaling headers
      continue
  }
  ```
- 설명: 에러가 발생하면 주석만 남기고 조용히 행을 드롭한다. 스키마 불일치/손상된 JSON이 있으면 UI에서 목록이 임의로 누락되지만 운영자는 감지할 수 없다. `GetRequestByShortID`(단건)는 에러를 반환하는 것과 일관성도 없다.
- 수정 제안: 최소한 `logger.Printf`로 에러 로깅. 가능하면 집계 카운터(`skipped int`)를 반환값에 포함하거나 `sqliteStorageService`에 logger 필드 추가.

### [High] [D2] `conversation.go::parseConversationFile` 148 LOC · 단일 책임 위반

- 파일: `proxy/internal/service/conversation.go:359-506`
- 증거: 한 함수가 (1) 파일 stat, (2) 버퍼 설정, (3) line scan loop, (4) title 분기, (5) timestamp 파싱 (2중 format 시도), (6) 빈 conversation edge-case 조기 리턴 (450-462), (7) 정렬, (8) 시작/종료 timestamp 계산, (9) Conversation 조립을 모두 수행.
- 설명: 중첩이 깊고(L478-486: for/if/if/if = 4단), 빈 메시지 케이스와 정상 케이스가 별도 리턴 경로로 분기해 유지보수가 어렵다. 로그 드롭 주석(L398, L421, L434)이 "스킵했음"만 남기고 실제 로깅 없음.
- 수정 제안: `scanMessages(reader) ([]*ConversationMessage, string, int, error)`, `computeTimeRange(msgs) (start, end time.Time)` 분리. parseErrors를 반환 튜플 또는 구조체 필드로.

### [High] [D2] `storage_sqlite.go::createTables` — ALTER ADD COLUMN idempotent 처리 **없음**

- 파일: `proxy/internal/service/storage_sqlite.go:39-67`
- 증거:
  ```go
  schema := `
  CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      ...
      session_id TEXT,
      ...
  );
  CREATE INDEX IF NOT EXISTS idx_session_id ON requests(session_id);
  `
  _, err := s.db.Exec(schema)
  ```
- 설명: orchestrator 컨텍스트 노트에는 "idempotent ALTER ADD COLUMN 패턴"이 포함되어 있다고 기재되어 있으나, 실제 코드에는 ALTER 경로가 없다. 기존 DB에 `session_id` 컬럼이 없는 설치본에서 `CREATE TABLE IF NOT EXISTS`는 no-op이 되므로 **컬럼이 추가되지 않고** 이후 INSERT/SELECT가 `no such column: session_id`로 실패한다.
- 수정 제안: `session_id`(및 향후 컬럼)에 대해 `PRAGMA table_info(requests)`로 존재 여부 확인 후 없으면 `ALTER TABLE requests ADD COLUMN session_id TEXT` 실행. 에러 무시 대신 `"duplicate column"` 메시지만 허용.

### [High] [D1] `storage_sqlite.go` CREATE TABLE에 `session_id` 컬럼 이미 있으나, **`prompt_grade`와 `response`는 schema에 정의** vs 리스트 SELECT는 두 nullable만 별도 처리 — 최초 설치/마이그레이션 경로 불일치

- 파일: `proxy/internal/service/storage_sqlite.go:39-67, 113, 241, 315, 405`
- 증거: `CREATE TABLE`에 `prompt_grade TEXT`, `response TEXT`, `original_model`, `routed_model`, `session_id`가 모두 `NULL` 허용으로 정의되어 있음. 리스트 SELECT는 `prompt_grade`, `response`, `session_id`만 `sql.NullString`으로 스캔하고 `original_model`, `routed_model`은 일반 `string`으로 스캔 — NULL 값이 있으면 **`converting NULL to string is unsupported`** 런타임 에러로 전체 행이 `continue`됨.
  ```go
  // L143-145:
  &req.OriginalModel,  // *string, NOT NullString — NULL이면 Scan 에러
  &req.RoutedModel,    // 동일
  &sessionID,          // NullString — OK
  ```
- 설명: `model.RequestLog`의 `OriginalModel`/`RoutedModel` 필드가 plain `string`이고 Scan에 NullString 래퍼가 없다. 기존 레코드(라우팅 이전)들이 조용히 drop될 수 있음.
- 수정 제안: `sql.NullString`으로 스캔 후 `.Valid` 체크. 또는 `CREATE TABLE`에 `DEFAULT ''` 추가 + 마이그레이션으로 기존 NULL → ''.

### [High] [D2] `model_router.go::loadCustomAgents` 63 LOC + 4단 중첩

- 파일: `proxy/internal/service/model_router.go:91-153`
- 증거: `for agentName, targetModel := range …` → `for _, path := range paths` → `if err != nil continue` → `if len(parts) >= 2` 내부 로직. 로딩/해싱/provider 결정/로그 출력이 한 함수에 혼재.
- 수정 제안: `findAgentFile(name) (content []byte, path string, err error)`, `buildAgentDefinition(name, target, content) (SubagentDefinition, error)` 추출. 출력 로그는 별도 `printLoadedAgents` 메서드.

### [High] [D4] `NewSQLiteStorageService`가 `cfg.DBPath`를 그대로 `sql.Open`에 전달 — 경로 traversal/권한 확인 없음

- 파일: `proxy/internal/service/storage_sqlite.go:21-37`
- 증거:
  ```go
  db, err := sql.Open("sqlite3", cfg.DBPath)
  ```
- 설명: `DBPath`가 외부 입력(env/yaml)으로 설정 가능하다. 기본값이 있더라도 심볼릭 링크를 통해 예상치 못한 위치에 DB를 만들거나 기존 파일을 덮어쓸 가능성이 있다. 디렉토리 권한(0700)/파일 권한(0600)도 설정되지 않는다.
- 수정 제안: (1) `filepath.Clean` + allow-list 디렉토리 prefix 체크, (2) SQLite 파일 생성 후 `os.Chmod(path, 0600)`, 부모 디렉토리 `0700`, (3) `sql.Open` 후 `db.Ping()`으로 실제 연결 검증(현재는 lazy라 에러가 첫 Exec에서야 드러남).

### [High] [D2] storage_sqlite.go 전역 파일 LOC 582, 13개 public 메서드 — 책임 분해 필요

- 파일: `proxy/internal/service/storage_sqlite.go` (전체)
- 증거: CRUD + 세션 집계 + timestamp 파싱 유틸 + 스키마 생성이 단일 파일에 모여 있음.
- 수정 제안: `storage_sqlite_schema.go`(createTables + future migrations), `storage_sqlite_request.go`(Save/Update/Get by id), `storage_sqlite_list.go`(GetRequests/GetAll/BySession + 공통 scanRow), `storage_sqlite_session.go`(GetSessionSummaries + DeleteBySessionID), `storage_sqlite_timestamp.go`(parseStoredTimestamp).

### [Medium] [D1] `decodeProjectPath` 알고리즘 복잡도 O(n²) — 긴 path(>50 tokens)에서 stat 호출 폭발

- 파일: `proxy/internal/service/conversation.go:263-331`
- 증거:
  ```go
  for i < len(tokens) {
      for j := i + 1; j <= len(tokens); j++ {
          segment := strings.Join(tokens[i:j], "-")
          ...
          if existsFn(candidate) { bestJ = j }
      }
  }
  ```
- 설명: 각 기점 i에서 전 범위 j를 돌며 stat 호출. `GetProjects`가 N개 프로젝트마다 이를 호출하면 최악 N·M² stat. 일반 path는 짧지만 공격자/사고로 매우 긴 encoded name이 들어오면 IO 폭증.
- 수정 제안: `bestJ`가 확정되면 inner loop break할 필요는 없지만, (a) `existsFn` 결과 캐시, (b) 동일 parent 내 `os.ReadDir` 1회 후 in-memory 매칭으로 전환.

### [Medium] [D1] `parseConversationFile` 타임스탬프 파싱 실패 시 조용히 zero time 사용

- 파일: `proxy/internal/service/conversation.go:414-424`
- 증거:
  ```go
  parsedTime, err := time.Parse(time.RFC3339, msg.Timestamp)
  if err != nil {
      parsedTime, err = time.Parse(time.RFC3339Nano, msg.Timestamp)
      if err != nil {
          // Skip message with invalid timestamp
      }
  }
  msg.ParsedTime = parsedTime  // err 무시 — 실패 시 zero time
  ```
- 설명: 주석이 "Skip message"라 적혀 있으나 실제로는 skip하지 않고 zero time 메시지를 그대로 추가. L478-486의 start/end 계산에서 `msg.ParsedTime.IsZero()` 체크로 가려져 있긴 하지만, **정렬(L465-467)에서는 zero time이 맨 앞으로 몰려** 메시지 순서가 꼬인다.
- 수정 제안: 타임스탬프 파싱 실패 메시지는 `fileInfo.ModTime()`으로 폴백하거나 해당 메시지를 별도 리스트로 분리. 최소한 logger에 count 남기기.

### [Medium] [D1] `RFC3339` 시도 후 `RFC3339Nano` 순서가 거꾸로 됨 (Nano가 엄격히 상위집합 아님)

- 파일: `proxy/internal/service/conversation.go:415-419`
- 증거: Go의 `time.Parse(RFC3339, "...Z")` 문자열에 nanosecond(`2026-04-23T00:00:00.123Z`)가 있으면 실패한다. 실제로는 `RFC3339Nano`를 먼저 시도해야 소수 유무 모두 커버 가능.
- 수정 제안: 순서 교체 또는 한 번에 layout 슬라이스 순회 (storage_sqlite.go의 `parseStoredTimestamp` 스타일 차용).

### [Medium] [D2] `session_index.go::Rebuild` vs `indexProjectDir` 중복 로직

- 파일: `proxy/internal/service/session_index.go:93-152, 253-280`
- 증거: 두 함수 모두 `ReadDir` → jsonl 필터 → `strings.TrimSuffix(".jsonl")` → `extractSessionTitle` → `entries[sessionID] = SessionIndexEntry{...}` 수행. 차이는 전자가 newMap 빌드 후 원자 교체, 후자는 기존 map에 직접 upsert.
- 수정 제안: `(idx) scanProjectDir(projDir, target map) error` 공통 헬퍼 추출.

### [Medium] [D3] `decodeProjectPath`/`projectDisplayName`이 `conversation.go`에 위치 — session_index.go에서도 사용

- 파일: `proxy/internal/service/conversation.go:235-356`, 사용처: `proxy/internal/service/session_index.go:114, 255, 286`
- 설명: 인코딩된 프로젝트 path ↔ 표시명 변환은 conversation 파싱과 직교 주제. 현재 session_index가 conversation.go의 세 함수(`decodeProjectPath`, `projectDisplayName`, `extractSessionTitle`)에 의존하고 있어 파일간 응집도가 약하다.
- 수정 제안: `service/project_path.go` (decodeProjectPath, projectDisplayName, dirExistsOnDisk), `service/session_title.go` (extractSessionTitle, extractTitleFromLine)로 분리.

### [Medium] [D4] `model_router.go::loadCustomAgents`가 `os.Getenv("HOME")` 기반 경로로 파일 읽음 — HOME 오염 위험

- 파일: `proxy/internal/service/model_router.go:94-97`
- 증거:
  ```go
  paths := []string{
      fmt.Sprintf(".claude/agents/%s.md", agentName),
      fmt.Sprintf("%s/.claude/agents/%s.md", os.Getenv("HOME"), agentName),
  }
  ```
- 설명: `agentName`은 `config.yaml`의 키로 신뢰된 입력이지만 파일 경로 조립 시 이스케이프/검증이 없다. `agentName = "../../etc/passwd"` 같은 값이 설정된다면 임의 파일 읽기 가능. 또 `HOME`이 빈 문자열이면 상대 경로 `"/.claude/agents/..."`가 된다. `os.UserHomeDir()`을 사용하고 `agentName`에 `filepath.Base` 적용 권장.
- 수정 제안: `safeName := filepath.Base(filepath.Clean(agentName))`로 sanitize, `os.UserHomeDir()` 사용, 최종 경로가 `~/.claude/agents/` 밖으로 나가지 않음을 `filepath.Rel` 검증.

### [Medium] [D1] `model_router.go::DetermineRoute`가 `req.System` nil/index out-of-bounds 방어 부족

- 파일: `proxy/internal/service/model_router.go:174-177`
- 증거:
  ```go
  if len(req.System) == 2 {
      if strings.Contains(req.System[0].Text, "You are Claude Code") {
          ...
          fullPrompt := req.System[1].Text
  ```
- 설명: 길이 체크는 있으나 `req.System[i].Text`가 포인터/옵셔널이라면 nil deref 가능. 현재 모델 구조체에 따라 다름. Also `req.Model`이 비어있으면 `hashString("")` + provider 조회 모두 기본 fallback으로 빠진다 — 명시적 에러가 없다.
- 수정 제안: `req.Model == ""`일 때 명시적 에러 반환. `req.System` 요소의 Text trim 후 비교.

### [Medium] [D2] `session_index.go::Watch`가 **rootDir 하위만 1단계 watcher.Add** — 더 깊은 변경 누락

- 파일: `proxy/internal/service/session_index.go:175-183`
- 증거:
  ```go
  subdirs, _ := os.ReadDir(idx.rootDir)
  for _, d := range subdirs {
      if d.IsDir() {
          path := filepath.Join(idx.rootDir, d.Name())
          watcher.Add(path)  // 한 단계만 watch
      }
  }
  ```
- 설명: fsnotify는 비재귀이므로 서브디렉토리 하위에 또 디렉토리가 생기면 이벤트를 받지 못한다. 현재 `~/.claude/projects/<project>/*.jsonl` 2단계 구조 전제라 문제없지만, 가정이 주석으로만 명시되어 있어 취약. 또한 `os.ReadDir` 에러를 **조용히 무시**(`_`) — 권한 문제 등 탐지 불가.
- 수정 제안: ReadDir 에러 로깅 추가. 향후 스키마 변경 대비 재귀 추가 함수 또는 명시적 주석/가드 강화.

### [Medium] [D1] `session_index.go::Watch` 에러 발생 시 **폴백 전환 후 복구 불가**

- 파일: `proxy/internal/service/session_index.go:156-173`
- 증거: fsnotify 생성 실패나 Add 실패 시 `watchPoll`로 한 번 넘어가면 전체 프로세스 생명주기 동안 폴링만 사용. fsnotify가 일시적 실패(rootDir 부재 등) 후 복구되어도 이를 감지해 돌아오지 않음.
- 수정 제안: polling 루프 안에서 주기적으로 fsnotify 재시도, 성공 시 원래 루프 재진입. 또는 최초 1회 한계 명시 주석 강화.

### [Medium] [D2] `storage_sqlite.go::parseStoredTimestamp` 의 6개 layout — conversation.go와 **이중 관리**

- 파일: `proxy/internal/service/storage_sqlite.go:539-556`, 비교: `conversation.go:415-419`
- 설명: 시간 포맷 파싱 로직이 두 파일에 각각 다른 방식으로 존재. 향후 포맷 변경 시 한쪽만 수정할 위험.
- 수정 제안: `service/timeparse.go`로 추출하여 `ParseAnyTimestamp(s string) (time.Time, error)` 공유.

### [Medium] [D1] `storage_sqlite.go::GetRequests`의 `COUNT(*)` + `SELECT` **2회 쿼리 + 비원자** 페이지네이션

- 파일: `proxy/internal/service/storage_sqlite.go:105, 119`
- 증거:
  ```go
  err := s.db.QueryRow("SELECT COUNT(*) FROM requests").Scan(&total)
  ...
  rows, err := s.db.Query(query, limit, offset)
  ```
- 설명: COUNT과 페이지 SELECT 사이 INSERT/DELETE가 들어가면 `total`과 실제 반환 행이 불일치. 트랜잭션 미사용. 또한 `COUNT(*)`에 model 필터가 없어 다른 리스트 함수와 달리 필터링 없이 전체를 센다 — UI에서 **"해당 모델 23건 중 12건 표시 중"** 같은 잘못된 요약이 나올 수 있음.
- 수정 제안: 필요 시 `BEGIN DEFERRED` 트랜잭션, 또는 UI 요구사항에 맞게 COUNT에도 동일 WHERE 적용.

### [Medium] [D2] `conversation.go::parseConversationFile` 빈 메시지 경로(L438-462)가 정상 경로와 **중복 조립**

- 파일: `proxy/internal/service/conversation.go:438-505`
- 증거: 빈 메시지 리턴과 정상 리턴이 동일한 `Conversation{...}` 초기화 블록을 거의 그대로 반복. 특히 L446-449는 조건문이 되어 있으나 양 분기 모두 `projectName = projectPath`를 설정 → 사실상 dead branch.
  ```go
  if strings.Contains(projectPath, "-") {
      projectName = projectPath  // 이미 위에서 projectName := projectPath 로 동일 값
  }
  ```
- 수정 제안: 공통 builder 함수 추출 + dead branch 제거.

### [Low] [D1] `extractSessionTitle`에서 `json.Unmarshal`을 **두 번** 수행 (typeOnly → extractTitleFromLine)

- 파일: `proxy/internal/service/conversation.go:547-566`
- 설명: 성능 이슈는 크지 않지만 한 줄에 2회 unmarshal. `typeOnly`와 `raw`를 합친 단일 구조체로 1회에 끝낼 수 있다.

### [Low] [D1] `conversation.go` L74-80, L97-99: 파싱 오류를 `parseErrors` 슬라이스에 append 하지만 **어디서도 반환/로깅하지 않음**

- 파일: `proxy/internal/service/conversation.go:73, 78, 98, 114`
- 증거: `parseErrors` 슬라이스가 채워지기만 하고 소비처가 없음 — dead data.
- 수정 제안: 로거 주입 후 함수 종료 시 요약 로그, 또는 완전히 제거.

### [Low] [D1] `model_router.go::NewModelRouter` — Subagents 비활성 분기에서 빈 줄 출력(L66-70)

- 파일: `proxy/internal/service/model_router.go:66-70`
- 설명: 비활성 안내에 `logger.Println("")` 빈 줄이 stdout 로그를 어지럽힘. 로그 라인 포맷이 서비스 전반에 비일관(일부는 이모지, 일부는 표준).

### [Low] [D1] `storage_sqlite.go::GetSessionSummaries` — 반환 슬라이스 길이 선언 시 `make([]SessionSummary, 0)` vs 다른 함수는 `var requests []...` — 스타일 비일관

- 파일: `proxy/internal/service/storage_sqlite.go:514` vs `125, 334, 434`

### [Low] [D4] `storage_sqlite.go`의 `fmt.Errorf("failed to delete requests for session %q: %w", sessionID, err)` — sessionID 원문을 에러 메시지에 포함

- 파일: `proxy/internal/service/storage_sqlite.go:570`
- 설명: sessionID 자체는 민감도 낮지만, 에러 문자열이 로그/UI로 흘러갈 경우 사용자 세션 ID가 노출되는 surface가 된다. Low로 분류.

## 긍정적 관찰

- `decodeProjectPath`에 `existsFn` 테스트 주입 포인트를 제공 — 테스트 용이성 우수.
- `SessionIndex` 인터페이스 + 폴링 폴백 + fsnotify 이원 구현은 플랫폼별 이식성을 고려한 설계.
- `extractSessionTitle`이 full-parse 대신 type-only unmarshal로 경량화된 점은 좋음 (단, 이중 unmarshal은 개선 여지, Low 이슈 참조).
- `GetRequestsBySessionID`가 `""` 빈 세션ID를 **"Unknown" 버킷**으로 일관 처리 — NULL/빈 동시 매칭 규칙을 `GetSessionSummaries`, `DeleteRequestsBySessionID`와도 일관되게 유지.
- 대부분의 SQL이 파라미터 바인딩 사용 (SQL injection 없음).

## Cross-cutting 리뷰 시 참고 단서

- **데이터 레이어 계약 일관성**: `sqliteStorageService`가 인터페이스 `StorageService`(`proxy/internal/service/storage.go`)를 구현. handler 쪽에서 에러 무시 패턴(`continue`)을 알고 UI에 skipped 카운트를 노출하는지 CC-03(에러 처리 일관성)에서 대조 필요.
- **시간 포맷 일관성 CC 주제**: `conversation.go`의 타임스탬프 파싱과 `storage_sqlite.go::parseStoredTimestamp`가 이중 관리됨. CC-04(설정/형식 일관성) 또는 별도 CC에서 전역 time util 도입 검토.
- **파일 경로 신뢰 모델**: `model_router.go`의 `os.Getenv("HOME")` 기반 경로 조립 + `conversation.go`의 `claudeProjectsPath` 조립은 공통 config 헬퍼 부재. CC-04 secrets/config 주제에서 함께 다룸.
- **스키마 마이그레이션 전략**: `storage_sqlite.go::createTables`에 ALTER 경로 부재. orchestrator 문서(`idempotent ALTER ADD COLUMN 패턴`)와 실제 코드의 괴리 → 구현 누락이거나 문서 오류. 상위 리뷰에서 실제 요구사항 확인 필요.
- **SessionIndex vs ConversationService 중복**: 두 서비스 모두 `~/.claude/projects/**/*.jsonl`을 스캔. 통합 또는 캐시 공유 가능성. FE/BE 데이터 흐름 CC에서 확인.
