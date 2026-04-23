# CHUNK-CC-03 — Cross-cutting 리뷰: 설정/비밀 관리

- Executed: 2026-04-23
- Files reviewed: 10 (1,887 LOC)
- Sampling: none
- Reviewer: o-web-reviewer subagent (CC mode)

## 범위

| # | 주제 |
|---|---|
| 1 | API 키 저장/로드/마스킹 경로 일관성 (SanitizeHeaders ↔ 로그 ↔ SQLite `headers` 컬럼) |
| 2 | `.env` / `config.yaml` / ENV 우선순위 정합성 |
| 3 | ENV 변수 이름 일관성 (`.env.example` vs `Dockerfile` vs `docker-entrypoint.sh` vs `run.sh`) |
| 4 | 기본값 안전성 (localhost 바인딩 default, 포트, TLS) |
| 5 | 비밀이 커밋된 파일에 등장하지 않는지 (`.env.example`의 placeholder만 존재) |
| 6 | Docker 배포 시 비밀 주입 방식 (ENV vs mount vs secrets) |
| 7 | `sanitize_headers=false` 옵션의 리스크 및 기본값 |
| 8 | `~/.claude/projects/*.jsonl` 파일 시스템 접근 권한 및 경로 escape 가능성 |

## 정량 지표 요약

### 설정 소스 × Key 매트릭스

> 셀 값: `○` = 정의/처리, `−` = 정의 없음, `default` = 해당 소스가 기본값 주입, `-s` = 단위 변경(초→duration)

| Key | `.env.example` | `Dockerfile` ENV | `docker-entrypoint.sh` | `run.sh` | `config.yaml.example` | `config.go` 기본값 | `config.go` ENV 오버라이드 |
|---|---|---|---|---|---|---|---|
| PORT | `3001` | `3001` | pass-through | − | `3001` | `"3001"` | ○ (L138) |
| READ_TIMEOUT | `500` (초?) | `600` | `${READ_TIMEOUT}s` | − | `read: 10m` | `600s` | ○ (L141) `getDuration` |
| WRITE_TIMEOUT | `500` | `600` | `${WRITE_TIMEOUT}s` | − | `write: 10m` | `600s` | ○ (L144) |
| IDLE_TIMEOUT | `500` | `600` | `${IDLE_TIMEOUT}s` | − | `idle: 10m` | `600s` | ○ (L147) |
| ANTHROPIC_FORWARD_URL | ○ | ○ | pass-through | − | `base_url` (다른 키) | default | ○ (L152) |
| ANTHROPIC_VERSION | ○ | ○ | pass-through | − | − (구조체만) | default | ○ (L155) |
| ANTHROPIC_MAX_RETRIES | ○ | ○ | pass-through | − | `max_retries` | default | ○ (L158) |
| OPENAI_API_KEY | − | − | − | − | 주석만 | `""` | ○ (L166) |
| OPENAI_BASE_URL | − | − | − | − | 주석만 | `https://api.openai.com` | ○ (L163) |
| DATABASE_PATH | ○ (L16) | − | − | − | − | − | − (config.go는 `DB_PATH`만 인식) |
| DB_PATH | − | `/app/data/requests.db` | pass-through | − | `db_path` | `requests.db` | ○ (L171) |
| WEB_PORT | − | `5173` | pass-through (web 프로세스에만) | 고정 `5173` | − | − | − |
| SUBAGENT_MAPPINGS | − | − | − | − | 주석(L99)에 사용법 언급 | − | **읽지 않음** (코드에 없음) |
| sanitize_headers | − | − | − | − | `true` (L48) | `nil` → true | − (ENV override 없음) |

> **굵게 표시된 불일치는 이슈로 전개.**

### 비밀 패턴 스캔

| 파일 | 하드코딩 secret | 결과 |
|---|---|---|
| `.env.example` | `PORT`, `DATABASE_PATH=requests.db` 등 **설정만**, secret 없음 | ○ Pass |
| `config.yaml.example` | `api_key: "..."` **주석 처리**되어 있음 (L35) | ○ Pass (단, 주석 유도 사용은 D4 주의 — BE-CF-01 #47로 이미 등록) |
| `Dockerfile` | `ENV ANTHROPIC_FORWARD_URL=...` 등 공개 정보만 | ○ Pass |
| `docker-entrypoint.sh` | 하드코딩 없음 (환경변수 pass-through) | ○ Pass |
| `run.sh` | 하드코딩 없음 | ○ Pass |
| `.gitignore` | `.env`, `.env.*`, `!.env.example` — 비밀 파일 커밋 방지 | ○ Pass |

### SanitizeHeaders 파이프라인 (keyword `x-api-key`)

| 단계 | 위치 | 평문/해시 |
|---|---|---|
| 수신 (클라 → 프록시) | `handler/handlers.go:88` `SanitizeHeaders(r.Header, h.sanitizeHeaders)` | 해시(기본) 또는 평문(opt-in) |
| 업스트림 forward | `service/anthropic.go:61` (주석 "headers intact"), `provider/anthropic.go:62` removeHopByHopHeaders | **항상 평문** (업스트림 전송 목적상 필수) |
| 응답 저장 | `handler/handlers.go:476,662,745` `SanitizeHeaders(resp.Header, ...)` | 해시(기본) — **응답에 보통 민감 키 없음** |
| DB 저장 | `service/storage_sqlite.go:70-85` (`headers TEXT NOT NULL`) | 위 단계의 결과가 JSON 직렬화 저장 |
| UI 렌더 | (FE-03 참조) `sha256:<hex>` 또는 평문 | 저장된 값 그대로 노출 |

**일관성 결론**: 요청(request) 저장 시에만 민감 키가 유의미하며, 그 지점은 sanitize 플래그로 통제 가능. 업스트림 forward는 비밀이 당연히 평문이라 통제 밖 — 단 `config.yaml`의 `base_url`을 `http://`로 지정하면 평문 네트워크 송신되는데, CC-03 범위의 이슈로 태깅 (BE-01 #7과 중복이므로 교차만 확인).

## CC-03 특화 이슈

### [Critical] `DATABASE_PATH` (.env.example) vs `DB_PATH` (Dockerfile/config.go) ENV 이름 불일치

- 위치:
  - `.env.example:16` — `DATABASE_PATH=requests.db`
  - `Dockerfile:76` — `ENV DB_PATH=/app/data/requests.db`
  - `docker-entrypoint.sh:38` — `DB_PATH=${DB_PATH}`
  - `config.go:171` — `if envPath := os.Getenv("DB_PATH"); envPath != "" { ... }`
- 증거:
  ```env
  # .env.example L16
  DATABASE_PATH=requests.db
  ```
  ```go
  // config.go L171
  if envPath := os.Getenv("DB_PATH"); envPath != "" {
      cfg.Storage.DBPath = envPath
  }
  ```
- 설명: 사용자가 `.env.example`에 적힌 이름(`DATABASE_PATH`)대로 `.env`를 작성하면, `run.sh`가 `.env`를 로드(`godotenv`)한 뒤에도 코드는 `DB_PATH`만 읽기 때문에 **설정이 조용히 무시**되고 기본값(`requests.db`)이 사용된다. 결과: 사용자가 지정한 DB 경로가 아닌 다른 위치에 SQLite가 생성되어, "데이터가 사라졌다"는 착각을 유발. Critical 등급인 이유는 **데이터 위치를 바꾸려는 명시적 사용자 의도를 배신**하기 때문.
- 수정 제안:
  1. `.env.example`을 `DB_PATH=./requests.db`로 통일,
  2. 또는 `config.go`에서 두 이름 모두 수용 (`DB_PATH` 우선, fallback `DATABASE_PATH` + deprecation warning).

### [High] `sanitize_headers`에 대응하는 ENV override 부재 — Docker 배포 시 유일한 보안 플래그를 컨테이너 이미지 밖에서 제어 불가

- 위치:
  - `config.yaml.example:48` `sanitize_headers: true`
  - `config.go:116, 211-216` — `*bool` 포인터 + getter
  - `Dockerfile`: `config.yaml`을 마운트/복사하는 단계 없음 (`COPY config.yaml` 없음)
- 증거:
  ```go
  // config.go L115-118
  Security: SecurityConfig{
      SanitizeHeaders: nil,   // default → true via getter
  },
  ```
  ```dockerfile
  # Dockerfile — no COPY of config.yaml, and no SANITIZE_HEADERS env
  ENV DB_PATH=/app/data/requests.db
  ```
- 설명: 컨테이너에서 기본값(true)은 안전하지만, 운영자가 `sanitize_headers: false`로 **디버깅 중 잠깐 전환**하려면 이미지를 재빌드하거나 `config.yaml` 볼륨 마운트를 해야 한다. ENV 오버라이드가 있다면 `docker run -e SANITIZE_HEADERS=false`만으로 가능. 반대로 **기본값 true를 강제 고정**하고 싶은 조직도 ENV로 막을 방법이 없다.
- 수정 제안: `config.go` env override 블록에 `if v := os.Getenv("SANITIZE_HEADERS"); v != "" { b := v=="true"; cfg.Security.SanitizeHeaders = &b }` 추가. `.env.example` / `Dockerfile` / `docker-entrypoint.sh` 세 곳에 동시 반영.

### [High] `SUBAGENT_MAPPINGS` ENV 변수는 `config.yaml.example` 문서에만 존재하고 코드에는 구현 없음 — 사용자 혼동

- 위치:
  - `config.yaml.example:99` `# SUBAGENT_MAPPINGS - Comma-separated subagent:model pairs`
  - `config.go` — **해당 문자열이 전혀 등장하지 않음**
- 증거:
  ```yaml
  # config.yaml.example L98-100
  # Subagents:
  #   SUBAGENT_MAPPINGS        - Comma-separated subagent:model pairs
  #                              Example: "code-reviewer:claude-3-5-sonnet"
  ```
  grep 결과: `proxy/` 전체에서 `SUBAGENT_MAPPINGS` 매치 0건.
- 설명: 문서상 ENV로 subagent 매핑을 주입할 수 있다고 약속하지만 파싱 코드가 없다. 사용자가 `.env`나 `docker run -e`로 설정해도 무시된다 — 추적 어려운 미동작. Docker 환경에서는 `config.yaml` 미탑재 시 subagent 라우팅을 ENV만으로는 불가능.
- 수정 제안: (a) 기능 구현: `strings.Split(os.Getenv("SUBAGENT_MAPPINGS"), ",")` 파싱 후 `map[string]string` 주입, 또는 (b) 문서에서 해당 ENV 언급 제거.

### [High] `READ_TIMEOUT` 단위 불일치 — `.env.example` 500 (의도 불명) vs `Dockerfile` 600 + entrypoint `${VAR}s` 접미사

- 위치:
  - `.env.example:5-7` `READ_TIMEOUT=500` (단위 없음, 주석 없음)
  - `Dockerfile:70-72` `ENV READ_TIMEOUT=600`
  - `docker-entrypoint.sh:32-34` `READ_TIMEOUT=${READ_TIMEOUT}s` — 초 접미사 강제
  - `config.go:234-245` `getDuration` → `time.ParseDuration`은 접미사 필수 (`"500"` 단독은 **invalid**)
  - `config.yaml.example:13` `read: 10m`
- 증거:
  ```
  # .env.example
  READ_TIMEOUT=500
  ```
  ```go
  // config.go L240-243
  duration, err := time.ParseDuration(value)
  if err != nil {
      return defaultValue
  }
  ```
- 설명: `.env` 경로로 `READ_TIMEOUT=500` 로드 시 `time.ParseDuration("500")`은 에러 → 기본값(600s) 적용. 사용자 의도(500초? 500ms?) 중 어느 쪽도 반영되지 않고 **조용히 기본값**으로 되돌아간다. Docker 경로는 entrypoint가 `s`를 붙여주지만 `run.sh`/로컬은 그런 래퍼 없음. 단위 불일치 + 단위 누락 + 세 경로의 값 상이(500/600/10m) → 운영 예측 불가.
- 수정 제안: `.env.example`의 값을 `READ_TIMEOUT=600s` 형식으로 통일(명시적 단위). Dockerfile도 `600s`로 맞추거나 entrypoint wrap 제거.

### [High] `.env` 탐색 경로가 `proxy/` 이진 기준 상대경로 — Docker/다른 CWD에서 로드 실패

- 위치: `config.go:79-87`
- 증거:
  ```go
  envPath := filepath.Join("..", ".env")
  if err := godotenv.Load(envPath); err != nil {
      if err := godotenv.Load(".env"); err != nil {
          // silently continue
      }
  }
  ```
- 설명: `run.sh`는 `./bin/proxy`를 프로젝트 루트에서 실행 → `..`의 `.env`는 **상위 디렉토리의 `.env`** (대개 사용자 홈 근처)를 노리게 되어 의도와 다름. 폴백 `".env"`는 CWD의 `.env`. Docker 컨테이너에서는 `.env`를 전혀 복사하지 않기 때문에 godotenv 로드 자체가 no-op. 경로 가정은 "proxy binary는 proxy/ 안에서 실행" → 현재 `run.sh`/Docker 어느 쪽도 그 가정을 만족하지 않는다.
- 수정 제안: 로드 순서를 `[CWD/.env, <binaryDir>/.env, <binaryDir>/../.env]`로 정리하고, 각 단계 성공/실패를 logger로 명시 (nil logger 문제는 별도).

### [High] `config.yaml.example`의 ENV 문서 섹션에 `DATABASE_PATH` 이름과 `DB_PATH` 혼용 — 사용자 문서 기반 설정 실패 유도

- 위치: `config.yaml.example:96` `#   DB_PATH`, `.env.example:16` `DATABASE_PATH`
- 증거:
  ```
  # config.yaml.example L95-96
  # Storage:
  #   DB_PATH                  - Database file path
  ```
  ```
  # .env.example L16
  DATABASE_PATH=requests.db
  ```
- 설명: 두 example 파일이 **서로 다른 ENV 이름**을 지시한다. 운영자가 어느 문서를 믿든 반대 소스에서는 틀림. 상기 Critical 이슈의 문서적 뿌리.
- 수정 제안: 위 Critical 이슈와 함께 일괄 정리. 두 파일 모두 `DB_PATH`로 통일.

### [Medium] `godotenv.Load` 에러(잘못된 형식 `.env` 등) 로그 없이 폐기

- 위치: `config.go:81-87`
- 증거:
  ```go
  if err := godotenv.Load(envPath); err != nil {
      if err := godotenv.Load(".env"); err != nil {
          // .env file is optional, so we just log and continue
      }
  }
  ```
- 설명: 주석은 "log and continue"지만 실제로는 log 조차 하지 않음(`config.Load`는 logger를 받지 않는다). `.env` 파일이 **존재하지만 구문 오류**인 경우도 동일하게 삼키므로, 사용자가 의도한 ENV가 로드되지 않았다는 사실을 알 방법이 없다.
- 수정 제안: `Load(logger *log.Logger)` 시그니처로 변경해 `os.IsNotExist(err)` 이외 오류는 로그에 남긴다. (BE-01 #2와 동일 근본원인 — `loadFromFile` 에러 무시 — 의 ENV판. 중복이므로 FIXES.md append는 생략하고 BE-01 #2에서 함께 해결 권장.)

### [Medium] Docker 빌드에 `config.yaml` 복사 단계 없음 — `sanitize_headers` 외 `subagents` 설정 등 YAML 전용 옵션을 사용하려면 별도 볼륨 마운트 필요

- 위치: `Dockerfile`(전체) — `COPY config.yaml` 또는 `COPY config.yaml.example` 없음
- 증거: Dockerfile L42-80에서 `COPY` 대상은 binary, web/build, docker-entrypoint.sh 뿐.
- 설명: 기본 이미지는 `config.yaml` 없이 기동 → `loadFromFile` 실패 → 기본값만 사용 + **ENV override만 효과**. `subagents.mappings`나 `security.sanitize_headers=false`(디버깅용) 같은 YAML-전용 옵션이 사실상 봉인된다. 이는 **의도된 설계일 수 있으나** 문서화돼 있지 않다.
- 수정 제안: (a) `COPY config.yaml.example ./config.yaml`로 "안전한 기본 YAML"을 동봉, 또는 (b) README/Dockerfile 주석에 "config.yaml은 `-v ./config.yaml:/app/config.yaml`로 마운트" 명시.

### [Medium] `docker-entrypoint.sh`/`run.sh`의 `kill $PROXY_PID $WEB_PID` — 비정상 종료 시 좀비/포트 점유 잔류 가능

- 위치: `docker-entrypoint.sh:15`, `run.sh:43`
- 증거:
  ```sh
  kill $PROXY_PID $WEB_PID 2>/dev/null || true
  ```
- 설명: SIGTERM만 보내고 확인 없이 종료. proxy가 30초 graceful shutdown 진행 중인데 sh script가 `exit 0`하면 컨테이너가 죽는다. 일관성 관점 — "서버는 SIGTERM 후 30초 대기"(main.go L125,L133)하는데 래퍼는 그 규약을 모른다. Docker 레벨에서는 보통 PID 1이 먼저 죽으면 즉시 정리되므로, 장시간 요청 처리 중 컨테이너 재시작 시 데이터 일관성(미기록 request) 우려.
- 수정 제안: sh script에서 `wait $PROXY_PID`를 cleanup 내에서 수행하거나, entrypoint 대신 `tini`/`dumb-init` 도입.

### [Medium] `READ_TIMEOUT` 기본값 `600s`(main) vs `500` (.env.example) vs `600` (Dockerfile) vs `10m` (yaml) — 세 소스에서 값 상이

- 위치: 전 섹션 매트릭스 참조.
- 설명: 위 High(단위 불일치)와 겹치지만 "기본값 숫자 자체도 다르다"는 별도 결함. 10m = 600s는 같지만 500은 다름.
- 수정 제안: 프로젝트 표준값 1개 결정 후 모든 소스 동기화.

### [Medium] `~/.claude/projects/*.jsonl` 경로 접근 — 호스트 권한 노출 (Docker)

- 위치: `cmd/proxy/main.go:51-56`
- 증거:
  ```go
  homeDir, _ := os.UserHomeDir()
  sessionIndexRootDir := filepath.Join(homeDir, ".claude", "projects")
  sessionIdx := service.NewSessionIndex(sessionIndexRootDir, logger)
  if err := sessionIdx.Rebuild(); err != nil {
      logger.Fatalf(...)
  }
  ```
- 설명: Docker 이미지는 `appuser`(uid 1001)로 실행되며 `$HOME`은 `/home/appuser` 또는 `/` 기본값 — `.claude/projects`가 없으면 `Rebuild`가 에러 반환 → **fatal + 컨테이너 기동 실패**. 호스트 `.claude` 디렉토리 마운트 문서/옵션이 제공되지 않는다. 또한 해당 디렉토리가 없을 때 fatal 처리인 것은 CC-04 관점에서 과도 — "세션 인덱스 없이도 proxy 동작"이 합리적이다.
- 수정 제안: `Rebuild` 실패 시 warn 로그 후 빈 인덱스로 기동. Docker 문서에 `-v ~/.claude:/home/appuser/.claude:ro` 예시 추가.
- 교차 확인: CC-02 `CHUNK-CC-02-cc.md:90`에서 이미 "encoded path 로깅으로 HOME 노출" 지적됨. CC-03에서는 "경로 자체 기동 의존성"으로 보완.

### [Low] `.env.example`에 OpenAI 관련 키(`OPENAI_API_KEY`, `OPENAI_BASE_URL`) 누락

- 위치: `.env.example` 전체, L15 이후 없음. `config.yaml.example:92-93`에는 존재.
- 설명: OpenAI 라우팅을 쓰려는 사용자가 `.env.example`만 보면 키 주입 방법을 발견하지 못한다. Docker ENV에도 없음.
- 수정 제안: `.env.example`에 `# OPENAI_API_KEY=sk-...` 주석 추가. Dockerfile는 secret을 이미지에 굽는 것이 아니므로 ENV 기본값은 넣지 않는 것이 맞음.

### [Low] Dockerfile의 `USER appuser` 이전 단계에서 `chown -R appuser:appgroup /app` 이후 `COPY docker-entrypoint.sh ./` + chmod — 순서상 파일 소유권 검증 불명

- 위치: `Dockerfile:61-65`
- 설명: 기본 동작은 문제없으나 `docker-entrypoint.sh`가 `root` 소유로 COPY되고 `chmod +x` 후에도 소유권은 root — `appuser`가 실행 시 exec 권한은 있으나 편집 불가. 운영상 문제는 아니지만 의도성 명시 권장.

### [Low] `run.sh`가 `.env`를 자동 복사(L29-38) — 실수로 추적 누락 유도

- 위치: `run.sh:29-38`
- 설명: 최초 실행 시 `.env.example` → `.env` 자동 복사. `.gitignore`에 `.env`가 있어 유출 위험은 없으나, 사용자가 `.env`가 생긴 줄 모르고 CI 등 이기종 환경에서도 같은 script 실행 시 예기치 않은 파일 생성. 안내 메시지는 노란색으로 출력되나 `-y` 프롬프트 없이 바로 진행.

## 교차 확인 (기 등록 이슈와 중복 — 재append 생략)

| 중복 | 원 출처 | CC-03에서의 관련성 |
|---|---|---|
| `sanitize_headers=false` 평문 저장 | FIXES #4 (BE-01) | 본 CC에서 "유일한 보안 플래그에 ENV override 없음" (별도 이슈로 append) |
| CORS `*` 허용 | FIXES #1 (BE-01) | 설정 기본값 안전성 — 재확인만 |
| `loadFromFile` 에러 무시 | FIXES #2 (BE-01) | `godotenv.Load` 무시와 동일 패턴 — 본 CC는 Medium으로만 언급 |
| `base_url` scheme 미검증 | FIXES #7 (BE-01) | Default 안전성과 연결 |
| `config.yaml.example`의 `api_key: "..."` 주석 | FIXES #47 (CF-01) | "비밀이 커밋된 파일에 등장" 주제로 재확인, 재등록 X |
| `model_router.go` `HOME` 기반 경로 | FIXES #48 (BE-03) | `~/.claude` 경로 신뢰 모델과 연결 — 재등록 X |

## 긍정적 관찰

- `.gitignore`가 `.env`, `.env.*`를 차단하고 `!.env.example`만 허용 — 의도 명확.
- `config.yaml.example`에 `OPENAI_API_KEY`를 **주석 처리**해 사용자 복붙 시 비밀 커밋을 줄이는 배려.
- Dockerfile이 non-root user(uid 1001)로 실행 — 최소권한 원칙 준수.
- `SanitizeHeaders`의 기본값이 안전 쪽(true)이고, 비활성 시 startup 경고 출력(`main.go:59-61`).
- `*bool` 포인터로 "사용자가 명시적으로 false로 설정"과 "설정 없음"을 구분 — 세심한 구현.

## Cross-cutting 단서 (다른 CC/FINAL 참고)

- **CC-01 (인증 플로우)**: 본 CC에서 "sanitize 저장만 해시, upstream forward는 평문"을 다시 확인. OpenAI provider의 `Authorization: Bearer` 재작성은 업스트림 전용이며 저장 경로에는 영향 없음.
- **CC-02 (파일 경로/HOME 노출)**: `~/.claude/projects` 의존성과 Docker 환경에서의 기동 실패 조건은 CC-02의 path-escape 우려와 같은 subsystem을 공유.
- **FINAL**: CC-03의 5개 High 이슈는 모두 "사용자 설정 명세 ↔ 실행 시 동작"의 간극. FINAL 요약에서 "설정 일관성 리팩토링"을 별도 항목으로 제안 권장.

