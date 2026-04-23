# CHUNK-CF-01 — 통합 리뷰 (D1+D2+D3+D4)

- Executed: 2026-04-23T22:20:00+09:00
- Files reviewed: 14 (792 LOC)
- Sampling: none (전량 리뷰)
- Reviewer: o-web-reviewer subagent
- Scope: 빌드/배포/설정/환경 — `.dockerignore`, `.env.example`, `.gitignore`, `Dockerfile`, `Makefile`, `config.yaml.example`, `docker-entrypoint.sh`, `run.sh`, `web/.eslintrc.cjs`, `web/package.json`, `web/postcss.config.js`, `web/tailwind.config.ts`, `web/tsconfig.json`, `web/vite.config.ts`

---

## 정량 지표 요약

### D2 파일별 메트릭

| 파일 | LOC | 최대 함수/스테이지 LOC | 최대 중첩 | 최대 파라미터 | import | export/타겟 |
|---|---|---|---|---|---|---|
| .dockerignore | 82 | n/a | n/a | n/a | n/a | n/a |
| .env.example | 15 | n/a | n/a | n/a | n/a | 7 keys |
| .gitignore | 44 | n/a | n/a | n/a | n/a | n/a |
| Dockerfile | 88 | Stage1 go-builder: 18 / Stage2 node-builder: 13 / Stage3 runtime: 34 | 0 | n/a | n/a | 8 ENV + 2 EXPOSE |
| Makefile | 74 | 최장 타겟: clean(7) | 0 | n/a | n/a | 10 targets (.PHONY=8, 미선언 2) |
| config.yaml.example | 99 | n/a | n/a | n/a | n/a | 5 sections |
| docker-entrypoint.sh | 62 | cleanup()=6 | 1 | 0 | n/a | 1 script |
| run.sh | 90 | cleanup()=5 | 1 | 0 | n/a | 1 script |
| web/.eslintrc.cjs | 84 | n/a | 4 (overrides→settings→import/resolver→typescript) | n/a | 0 | 1 (module.exports) |
| web/package.json | 44 | n/a | n/a | n/a | 17 deps/devDeps | 5 scripts |
| web/postcss.config.js | 6 | n/a | 2 | n/a | 0 | 1 default |
| web/tailwind.config.ts | 32 | n/a | 4 (theme→extend→keyframes→spin) | n/a | 1 | 1 default |
| web/tsconfig.json | 32 | n/a | 3 (compilerOptions→paths→~/*) | n/a | n/a | 1 config |
| web/vite.config.ts | 40 | `bypass` 함수 = 5 | 4 (server→proxy→/api→bypass) | 1 | 3 | 1 default |

임계값 초과 셀: 없음 (LOC·함수·파라미터·중첩·import 모두 여유).

### D3 의존성

- 외부 import 모듈 수 (빌드/설정 스크립트 한정):
  - `vite.config.ts`: 3 (`@remix-run/dev`, `vite`, `vite-tsconfig-paths`)
  - `tailwind.config.ts`: 1 (`tailwindcss` — type-only)
- Fan-out 과다 파일 (>25): 없음.
- Fan-in 추정: 빌드 구성 파일 특성상 런타임 코드가 `import` 하지 않음 (toolchain 진입점). 해당 없음.
- 순환 의존 후보: 없음.
- 레이어 위반 (배포/설정 관점):
  - Dockerfile이 `docker-entrypoint.sh` 만 `chmod +x` 처리하지만 런타임에서 `./bin/proxy` 를 배치 단계(L52-53)에서 이미 `chmod +x` 수행 — 중복 아님 (소스는 이미 실행권한일 수 있어도 방어적). OK.
  - `run.sh`는 Go/Node 체크 이후 `cd proxy` → `cd web`로 이동하며 `cd ..` 누락 시 후속 경로 어긋남. 현재는 모두 `cd ..` 대응.

### D1/D4 패턴 스캔 히트 수

| 패턴 | 히트 | 차원 | 비고 |
|---|---|---|---|
| 하드코딩된 크리덴셜 문자열 | 0 | D1,D4 | `config.yaml.example:35`의 `api_key: "..."` 는 주석 처리된 placeholder — FP |
| 디버그 로그 잔존 | n/a | D1 | 셸은 의도된 echo, JS 설정 파일에는 console 없음 |
| any 남용 | 0 | D1 | `vite.config.ts`/`tailwind.config.ts` 타입 시그니처 완비 |
| SQL injection 의심 | 0 | D4 | 해당 없음 |
| XSS 의심 | 0 | D4 | 해당 없음 |
| eval/exec | 0 | D4 | 해당 없음 |
| CORS 와일드카드 | 0 | D4 | CF 영역에서는 미정의 (BE config에서 다룸) |
| 민감정보 로깅 | 0 | D4 | `docker-entrypoint.sh:26`에서 URL만 echo — 민감 정보 아님 |
| 하드코딩 URL/포트 | 9 | D4,D1 | `localhost:3001`·`0.0.0.0` 등. 대부분 의도된 로컬 바인딩 — 단, `vite.config.ts:27` 프록시 타겟이 환경변수화 미적용 |
| `set -u`/`set -o pipefail` 미설정 셸 | 2 | D1,D4 | `docker-entrypoint.sh`(POSIX sh)·`run.sh`는 `set -e`만 설정 |
| 미검증 변수 보간 | 10+ | D1 | `docker-entrypoint.sh`의 `${PORT}` 등 기본값/미설정 시 빈 문자열로 확산 |

### AI 분석 친화성
- 타입 시그니처 완비도: 해당 TS 설정 파일 (`vite.config.ts`, `tailwind.config.ts`) 모두 `Config`/`defineConfig`로 완전 타입화 — 100%.
- 명명 일관성: `PORT`/`WEB_PORT`/`DB_PATH`/`DATABASE_PATH` 혼용 주의. `.env.example:16` = `DATABASE_PATH=requests.db` 이나 `Dockerfile:76`·`docker-entrypoint.sh:25,38` = `DB_PATH`. **키 이름 불일치**.
- 파일명 vs 주 export 일치: 모든 설정 파일 표준 명명 준수.
- 주석 밀도: `config.yaml.example`(99 LOC) 주석 밀도 매우 높음(설명 ≥ 60%), `Dockerfile`·`.env.example`도 섹션 주석 양호.

---

## 발견된 이슈 (심각도순, 통합)

### [Critical] [D4] `.env.example`의 `DATABASE_PATH` vs 런타임 `DB_PATH` 키 불일치 — 운영 환경에서 의도하지 않은 DB 경로 사용 가능
- 파일: `.env.example:16`, `Dockerfile:76`, `docker-entrypoint.sh:25,38`, `config.yaml.example:96`
- 증거:
  ```
  # .env.example
  DATABASE_PATH=requests.db
  # Dockerfile
  ENV DB_PATH=/app/data/requests.db
  # docker-entrypoint.sh
  echo "   - Database: ${DB_PATH}"
  DB_PATH=${DB_PATH} ./bin/proxy &
  # config.yaml.example 주석 L96
  #   DB_PATH                  - Database file path
  ```
- 설명: 사용자가 `.env`를 복사해 `DATABASE_PATH`를 설정하면 proxy는 이를 인식하지 못하고 `DB_PATH` (미설정 시 기본값 또는 CWD의 `requests.db`)로 동작. 운영자가 "다른 경로로 설정했다"고 믿고 실제로는 예상치 못한 위치에 DB가 생성되어 **데이터 유실·중복·권한 문제**의 원인이 될 수 있다. 실제 `requests.db`가 리포 루트 994MB 로 커진 흔적도 존재.
- 수정 제안: `.env.example`의 키를 `DB_PATH=requests.db`로 통일하거나, proxy config가 `DATABASE_PATH`도 대체 인식하도록 이중 키 지원 + README/주석에 마이그레이션 노트.

### [Critical] [D4] `docker-entrypoint.sh` 환경변수 보간이 미설정 시 공백으로 전파 — 기동 실패/의도치 않은 기본값 라우팅
- 파일: `docker-entrypoint.sh:6,31-39`
- 증거:
  ```sh
  #!/bin/sh
  set -e
  ...
  PORT=${PORT} \
  READ_TIMEOUT=${READ_TIMEOUT}s \
  ...
  ANTHROPIC_FORWARD_URL=${ANTHROPIC_FORWARD_URL} \
  ./bin/proxy &
  ```
- 설명: `Dockerfile`에서 `ENV`로 기본값을 지정하고 있으나, 운영 배포에서 `docker run --env-file` 누락 시에도 최소 기동은 되도록 의도된 설계로 보인다. 그러나 `set -u` 미설정이고 변수가 비어 있으면 `READ_TIMEOUT=s`(s 접미사만) 같은 **malformed duration**이 proxy에 전달되어 파싱 에러. 특히 로컬 `docker run ... -it image sh -c ./docker-entrypoint.sh`처럼 컨테이너 밖에서 실행 시 위험. 또한 `${ANTHROPIC_FORWARD_URL}`이 비면 proxy가 **빈 업스트림**으로 포워드하여 모든 요청 실패.
- 수정 제안: 스크립트 상단에 `: "${PORT:=3001}"`, `: "${READ_TIMEOUT:=600}"`, `: "${ANTHROPIC_FORWARD_URL:=https://api.anthropic.com}"` 등 기본값 가드 + `set -eu` 적용 (또는 `[ -z "${VAR}" ] && echo "error" && exit 1` 확인).

### [High] [D4] Dockerfile 3-stage 빌드에서 `node-builder` 단계가 dev → prod 재설치로 `node_modules` 더티 — 이미지에 빌드 시크릿/소스 유출 가능
- 파일: `Dockerfile:22-37, 55-58`
- 증거:
  ```dockerfile
  # Stage 2
  COPY web/ ./
  RUN npm run build
  # Clean up dev dependencies after build
  RUN npm ci --only=production && npm cache clean --force
  ...
  # Stage 3
  COPY --from=node-builder /app/web/build ./web/build
  COPY --from=node-builder /app/web/package*.json ./web/
  COPY --from=node-builder /app/web/node_modules ./web/node_modules
  ```
- 설명: (a) `COPY web/ ./` 가 `.env`, `.env.local`, 소스 주석, 테스트 등을 stage 2에 복사 → build 아티팩트로 번들링될 가능성. `.dockerignore`에서 `.env*`를 제외하고 있으나 `web/.env*`는 별도로 명시되지 않음(루트 `.env*`만 매치). (b) `node_modules` 전체(프로덕션만 설치됐어도 수백 MB + 인덱싱된 소스)가 런타임 이미지에 복사 → 이미지 크기 + 공격 표면 증가. Remix는 `build/server/index.js`를 번들링하므로 `node_modules`는 `@remix-run/serve`만 필요.
- 수정 제안: `.dockerignore`에 `**/.env`·`**/.env.*` 패턴(이미 `.env*`있으나 재귀 확인) + stage 3에서 `node_modules` 대신 `npm install --omit=dev --prefix web @remix-run/serve isbot`만 설치하거나, 별도 production stage에서 `npm ci --omit=dev` 후 복사.

### [High] [D4] `docker-entrypoint.sh` 프로세스 관리 — proxy 또는 web 중 하나만 죽어도 컨테이너가 계속 살아있음 (zombie/HEALTHCHECK 오탐)
- 파일: `docker-entrypoint.sh:39-49, 62-63`
- 증거:
  ```sh
  ./bin/proxy &
  PROXY_PID=$!
  sleep 3
  ...
  npx remix-serve build/server/index.js &
  WEB_PID=$!
  cd ..
  ...
  # Wait for processes to finish
  wait
  ```
- 설명: `wait`는 모든 백그라운드 작업이 끝날 때까지 대기한다. proxy만 크래시해도 remix-serve가 살아 있으면 컨테이너는 "정상"으로 보여 Kubernetes/ECS liveness가 감지하지 못한다. HEALTHCHECK가 `http://localhost:3001/health`을 체크(L86)하므로 proxy 크래시는 결국 감지되지만, **web 크래시는 감지 경로가 없다**. 또한 `sleep 3`은 proxy 부팅이 느리면 web이 `/api` 호출 실패로 시작할 수 있어 **race condition**.
- 수정 제안: `wait -n` 사용해 어느 하나 종료 시 즉시 exit 코드 전파, 또는 `supervisord`/`dumb-init` 같은 PID 1 관리자 도입. web 기동 전 `wget --retry-connrefused --tries=10 http://localhost:${PORT}/health`로 준비 대기.

### [High] [D4] Dockerfile HEALTHCHECK가 proxy만 확인 — web 레이어는 무방어
- 파일: `Dockerfile:85-86`
- 증거:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
      CMD wget -qO- http://localhost:3001/health > /dev/null || exit 1
  ```
- 설명: 위 이슈와 중복 증거. `WEB_PORT=5173` healthcheck 누락. (분리 이슈로 추적 가치 있음 — 수정은 compound check로 병합)
- 수정 제안: `CMD wget -q http://localhost:${PORT}/health && wget -q http://localhost:${WEB_PORT}/ || exit 1`.

### [High] [D4] `run.sh`의 `set -e` + `cleanup trap EXIT` 조합으로 일반 종료 시 `kill` 2번 호출 — 에러 은폐
- 파일: `run.sh:6,41-47`
- 증거:
  ```bash
  set -e
  ...
  cleanup() {
      echo -e "\n${YELLOW}Shutting down services...${NC}"
      kill $PROXY_PID $WEB_PID 2>/dev/null || true
      exit
  }
  trap cleanup EXIT INT TERM
  ```
- 설명: `trap cleanup EXIT` 는 `wait`가 정상 종료해도 호출되며, 이미 종료된 PID에 `kill`을 보낸다 (`|| true`로 silent). 문제는 `exit` 에 exit code를 전달하지 않아 부모 쉘은 항상 0을 받는다 → **CI/스크립트 체인에서 실패를 감지 못함**. 또한 `PROXY_PID`/`WEB_PID`가 설정되기 전에 `exit` 되면 `kill: arguments required` 가능.
- 수정 제안: `cleanup() { local ec=$?; kill "${PROXY_PID:-}" "${WEB_PID:-}" 2>/dev/null || true; exit "$ec"; }` 로 exit code 보존 + 변수 기본값 가드.

### [High] [D4] `vite.config.ts` 프록시 대상이 `http://localhost:3001` 하드코딩 — 원격 컨테이너/도커 개발 환경에서 프록시 실패
- 파일: `web/vite.config.ts:25-37`
- 증거:
  ```ts
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ...
      },
    },
  },
  ```
- 설명: Docker Compose 또는 devcontainer 시나리오에서 proxy 서비스가 별도 호스트에 있을 수 있다. 현재 설정은 환경변수 기반 오버라이드가 불가. 또한 `Dockerfile`은 dev 모드가 아닌 `remix-serve`로 기동하므로 vite proxy는 dev 전용이지만, 팀 협업이나 원격 dev 시 실패.
- 수정 제안: `target: process.env.PROXY_TARGET || "http://localhost:3001"`. `.env.example`에 `PROXY_TARGET=http://localhost:3001` 추가.

### [High] [D4] `.dockerignore`가 `requests.db`/`requests/`를 제외하나 `**/requests.db` 재귀 패턴이 아님 — 서브디렉터리 DB 유출 위험
- 파일: `.dockerignore:57-61`
- 증거:
  ```
  # Database files (will be created in container)
  *.db
  *.sqlite
  *.sqlite3
  requests/
  ```
- 설명: `*.db`는 루트의 `requests.db`(994MB)는 제외하지만, 하위 디렉터리의 `proxy/test/fixtures/x.db` 같은 테스트 DB까지 커버되는지 docker 버전에 따라 모호. `*.db`는 Docker BuildKit에서 일반적으로 재귀 매치되지만, 일부 ignore 파서는 `**/*.db` 명시가 필요. 또한 `.env.local` 외 `*.env.*` 패턴 미커버.
- 수정 제안: `**/*.db`, `**/*.sqlite`, `**/.env`, `**/.env.*` 명시.

### [High] [D2] `.env.example` 기본 timeout `500`과 Dockerfile `ENV ...TIMEOUT=600`, `config.yaml.example` `10m` 값이 3파일 모두 다름 — 구성 문서 신뢰성 저하
- 파일: `.env.example:5-7`, `Dockerfile:70-72`, `config.yaml.example:13-19`
- 증거:
  ```
  # .env.example
  READ_TIMEOUT=500
  WRITE_TIMEOUT=500
  IDLE_TIMEOUT=500
  # Dockerfile
  ENV READ_TIMEOUT=600
  ENV WRITE_TIMEOUT=600
  ENV IDLE_TIMEOUT=600
  # config.yaml.example
  read: 10m (=600s)
  write: 10m
  idle: 10m
  ```
- 설명: 셋 다 단위 모호. `500`이 초인지 ms인지 주석 없음. Dockerfile 주석은 "defaults"만 표기. `docker-entrypoint.sh:32-34`에서 `${READ_TIMEOUT}s`로 `s` 접미사를 붙이므로 값은 초. 따라서 `.env.example`의 500초(=8분) vs Dockerfile 600초(=10분) vs config 10m 간 불일치로 개발자 혼란.
- 수정 제안: 세 파일을 600(=10m) 또는 합의된 값으로 통일 + 단위 주석 `# seconds`.

### [Medium] [D4] `config.yaml.example`에 `security.sanitize_headers: true` 기본값 권고는 좋으나 **OpenAI API key** 를 YAML 평문으로 주석화 — 실제 `config.yaml` 커밋 사고 유도
- 파일: `config.yaml.example:32-39`
- 증거:
  ```yaml
  openai:
    # API key for OpenAI
    # Can also be set via OPENAI_API_KEY environment variable
    # api_key: "..."
    ...
    # base_url: "https://api.openai.com"
  ```
- 설명: `.gitignore:45`에 `config.yaml` 은 이미 제외되어 있어 커밋 방어는 되나, `config.yaml.example`에 `api_key` 필드를 제시하는 것이 사용자가 실제 값을 넣은 뒤 **다른 이름으로 템플릿화**하여 누출될 위험. 또한 환경변수 전용 권장을 먼저 두는 편이 OWASP 권고.
- 수정 제안: `api_key:` 주석 라인 제거하고 "API 키는 **반드시** 환경변수 `OPENAI_API_KEY`로 설정하세요. 설정 파일에 넣지 마십시오." 로 대체.

### [Medium] [D2] `Makefile`이 `.PHONY`에 `build-proxy build-web run-proxy run-web db-reset help` 미포함 — 동명 파일 생성 시 타겟 미실행
- 파일: `Makefile:1`
- 증거:
  ```makefile
  .PHONY: all build run clean clean-web-cache dev-clean install dev
  ```
- 설명: `make help`, `make run-proxy`, `make build-proxy` 등은 `.PHONY` 명단에 없다. `help`라는 파일이 리포에 생기면 `make help` 가 "Nothing to be done" 처리됨. `run`은 타겟 자체가 선언돼 있지 않음에도 `.PHONY`에 명시된 유령 항목.
- 수정 제안: `.PHONY: all install build build-proxy build-web dev dev-clean clean-web-cache run-proxy run-web clean db-reset help` 로 정렬 + 존재하지 않는 `run` 제거.

### [Medium] [D2] `Makefile`이 이모지 포함 echo 사용 — Windows/CI 로그에서 문자 깨짐
- 파일: `Makefile:8-72`
- 증거:
  ```makefile
  @echo "📦 Installing Go dependencies..."
  @echo "🔨 Building proxy server..."
  ```
- 설명: CI 로그, Windows cmd, non-UTF-8 환경에서 `?` 로 표시되거나 raw 바이트가 출력되어 로그 grep 실패. 기능적으로 문제 없으나 팀 정책 기준 필요.
- 수정 제안: 팀 정책이 ASCII-only 로그라면 `[INSTALL]`, `[BUILD]` 접두사로 교체.

### [Medium] [D2] `web/package.json` 스크립트에 `test` 누락 — 테스트 누락 구조적 증거
- 파일: `web/package.json:6-12`
- 증거:
  ```json
  "scripts": {
    "build": "remix vite:build",
    "dev": "remix vite:dev",
    "lint": "eslint --ignore-path .gitignore --cache --cache-location ./node_modules/.cache/eslint .",
    "start": "remix-serve ./build/server/index.js",
    "typecheck": "tsc"
  }
  ```
- 설명: CHUNK-FE-03/SH-01 리뷰에서 FE 테스트 부재가 반복 지적됨. `package.json`에 `test` 스크립트가 없어 CI가 기본 `npm test`로 호출해도 Error: no test command 로 빠진다. Vitest/Jest 미도입.
- 수정 제안: `"test": "vitest run"` 추가 + `vitest` devDependency 도입 (FIXES.md 기존 테스트 항목과 병합).

### [Medium] [D4] `Dockerfile`의 `RUN apk add --no-cache` 계열 패키지 고정 버전 미사용 — 재현 불가능 빌드
- 파일: `Dockerfile:10,45`
- 증거:
  ```dockerfile
  RUN apk add --no-cache git gcc musl-dev sqlite-dev
  ...
  RUN apk add --no-cache sqlite wget
  ```
- 설명: Alpine 패키지가 버전 고정 없이 설치되어 재빌드 시 다른 버전이 들어올 수 있다. 특히 `sqlite-dev`는 CGO 바인딩 ABI 영향. `golang:1.21-alpine` → 1.21.x 패치 롤오버 시 go-sqlite3 의존성 재컴파일 필요.
- 수정 제안: `git=2.43.x-r0` 같이 버전 고정 또는 `--digest` 로 베이스 이미지 SHA 고정 + `apk` lock 사용.

### [Medium] [D2] `Dockerfile` baseimage 태그가 major.minor만 지정 (`golang:1.21-alpine`, `node:20-alpine`) — SHA256 디제스트 미고정
- 파일: `Dockerfile:5,23,40`
- 증거:
  ```dockerfile
  FROM golang:1.21-alpine AS go-builder
  FROM node:20-alpine AS node-builder
  FROM node:20-alpine
  ```
- 설명: 동일 태그가 주기적으로 새 이미지로 덮어써지는 floating tag. 공급망 보안 관점에서 pinning 권장 (SLSA Level 2+).
- 수정 제안: `FROM golang:1.21-alpine@sha256:...` 형태. renovate-bot/dependabot 자동 업데이트 연동.

### [Medium] [D4] `run.sh:29-38`에서 `.env` 자동 생성 — 개발자가 placeholder 값으로 운영 기동 위험
- 파일: `run.sh:29-38`
- 증거:
  ```bash
  if [ ! -f .env ]; then
      echo -e "${YELLOW}⚠️  No .env file found. Creating from .env.example...${NC}"
      if [ -f .env.example ]; then
          cp .env.example .env
          echo -e "${GREEN}✅ Created .env file.${NC}"
      else
          echo "❌ No .env.example file found."
          exit 1
      fi
  fi
  ```
- 설명: `.env.example`에는 비밀이 없어 큰 위험은 아니지만, 향후 비밀 필드가 추가되면 placeholder로 기동되는 흐름이 그대로 유지됨. 또한 이미 `.env`가 있어도 `.env.example`과 동기화 확인 없이 계속 사용 → 새 키가 추가되면 누락 감지 불가.
- 수정 제안: 자동 복사 대신 경고 후 종료 + `./scripts/check-env.sh`로 `.env`/`.env.example` key 비교 후 누락 키 리포트.

### [Medium] [D2] `docker-entrypoint.sh`가 `#!/bin/sh`로 선언됐으나 `SIGTERM SIGINT` 사용 — POSIX sh 비호환 구문
- 파일: `docker-entrypoint.sh:1,20`
- 증거:
  ```sh
  #!/bin/sh
  ...
  trap cleanup SIGTERM SIGINT
  ```
- 설명: POSIX sh는 `trap cleanup TERM INT` (SIG 접두사 없이) 가 표준. Alpine의 `ash`는 관대하지만, `dash` 등 엄격 sh에서는 `trap: SIGTERM: bad signal` 에러.
- 수정 제안: `trap cleanup TERM INT` 로 변경 또는 `#!/bin/bash` (alpine는 bash 미설치 → busybox ash가 받도록 `TERM INT` 가 안전).

### [Medium] [D2] `web/.eslintrc.cjs`이 legacy `.eslintrc` 포맷 — eslint 8 deprecation + 9.x 호환성 위험
- 파일: `web/.eslintrc.cjs:1-84`, `web/package.json:29`
- 증거:
  ```js
  // package.json
  "eslint": "^8.38.0"
  ```
- 설명: eslint 9는 flat config (`eslint.config.js`) 필수. 8.x LTS 지원 종료 일정 존재. 마이그레이션 필요.
- 수정 제안: 단기: 8.x 고정(`~8.57.0`). 중기: flat config 전환.

### [Medium] [D1] `run.sh`의 `GREEN`/`BLUE`/`YELLOW` ANSI 색상 변수를 선언했으나 `RED`는 없음 — 실패 메시지 L18/L24/L36에서 ❌ 이모지로만 표시
- 파일: `run.sh:11-14,18,24,36`
- 증거:
  ```bash
  GREEN='\033[0;32m'
  BLUE='\033[0;34m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
  ...
  echo "❌ Go is not installed. Please install Go 1.20 or higher."
  ```
- 설명: 일관성 부재 + 터미널 파이프·로그 수집기에서 이모지만으로 에러 구분 어려움.
- 수정 제안: `RED='\033[0;31m'` 추가 + 실패 메시지에 사용.

### [Medium] [D2] `run.sh:17`가 Go 1.20+ 요구로 안내하나 `Dockerfile`은 Go 1.21 — 메시지 불일치
- 파일: `run.sh:18`, `Dockerfile:5`, `web/package.json:42`(node>=20)
- 증거:
  ```bash
  echo "❌ Go is not installed. Please install Go 1.20 or higher."
  ```
  vs Dockerfile `FROM golang:1.21-alpine`
- 설명: 실제 빌드는 1.21이 필요할 수 있고 `proxy/go.mod` 기준이 명확. 문서/안내 메시지 불일치.
- 수정 제안: `proxy/go.mod` 버전을 읽어 동적으로 표시하거나 `Go 1.21+`로 통일.

### [Medium] [D1] `.gitignore:32`에 `CLAUDE.md` 제외 — 프로젝트 가이드 파일이 공유되지 않음
- 파일: `.gitignore:30-32`
- 증거:
  ```
  # Claude-specific files
  .claude/
  CLAUDE.md
  ```
- 설명: 본 리포의 루트에는 `CLAUDE.md`가 존재(커밋됨). `.gitignore`가 추가된 시점 기준 tracked 파일은 제외되지 않지만, 새 기여자가 `CLAUDE.md` 를 수정하면 git이 추적 가능성 애매. 팀 공유 가이드라면 예외 처리 필요.
- 수정 제안: 팀이 CLAUDE.md 공유를 원하면 `.gitignore`에서 제거 + `!CLAUDE.md` 로 명시. 개인 설정이면 `.claude/` 만 유지.

### [Medium] [D3] `.dockerignore`가 `README.md`, `*.md` 제외 → `CLAUDE.md`, `glossary.md` 는 제외되나 정상. 다만 `.refs/` 디렉터리 미제외로 빌드 컨텍스트 불필요 포함
- 파일: `.dockerignore`, 리포 루트 `.refs/`
- 증거: 리포 루트에 `.refs/` 존재(`CLAUDE.md`에서 참조). `.dockerignore`에 미포함.
- 설명: 빌드 컨텍스트가 커지면 전송 시간·캐시 무효화 증가.
- 수정 제안: `.refs/`, `.plan/`, `glossary.md`, `.vscode/` 등 빌드에 불필요한 경로 추가.

### [Medium] [D2] `web/tsconfig.json`이 `"include"`에 `**/*.ts` 를 사용하나 `types: ["@remix-run/node", "vite/client"]`만 지정 — Node 글로벌 / 외부 타입 누락 가능
- 파일: `web/tsconfig.json:12`
- 증거:
  ```json
  "types": ["@remix-run/node", "vite/client"]
  ```
- 설명: `types`를 명시하면 그 외 `@types/*`가 자동 포함되지 않는다. `@types/react`·`@types/react-dom`가 devDependency로 있지만 `types`에 없어 명시적으로는 제외. React JSX transform이 `"jsx": "react-jsx"`로 동작해 문제는 없으나 의도와 어긋남.
- 수정 제안: `types` 필드 제거해 `@types/*` 자동 수집 허용, 또는 `["@remix-run/node", "vite/client", "react", "react-dom"]`.

### [Low] [D1] `.env.example`과 주석이 `Claude Code Monitor`로 명명되나 프로젝트 실제 이름은 `claude-code-proxy`
- 파일: `.env.example:1`, `Makefile:8`, `run.sh:3`, `config.yaml.example:1` (LLM Proxy)
- 설명: 프로젝트 rebranding 누락. 기능 없음.
- 수정 제안: 명명 통일 (예: `Claude Code Proxy`).

### [Low] [D1] `Dockerfile:49`의 UID/GID 1001이 호스트 볼륨 마운트 시 호스트 사용자와 충돌
- 파일: `Dockerfile:48-49,61`
- 증거:
  ```dockerfile
  RUN addgroup -g 1001 -S appgroup && \
      adduser -S appuser -u 1001 -G appgroup
  ...
  RUN mkdir -p /app/data && chown -R appuser:appgroup /app
  ```
- 설명: 볼륨 마운트로 DB를 호스트에 저장할 때 UID 1001 ≠ 호스트 유저(일반 1000) 시 권한 문제. 운영 의존.
- 수정 제안: `ARG UID=1001` / `ARG GID=1001` 로 빌드 타임 오버라이드 가능케.

### [Low] [D1] `web/tailwind.config.ts`의 `spin` keyframe은 Tailwind v3 기본 제공 — 중복 선언
- 파일: `web/tailwind.config.ts:20-28`
- 증거:
  ```ts
  animation: {
    spin: 'spin 1s linear infinite',
  },
  keyframes: {
    spin: { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
  },
  ```
- 설명: Tailwind 기본 `animate-spin` 이 이미 존재. 커스텀 선언이 기본을 덮어쓰지만 차이 없음.
- 수정 제안: 커스텀 애니메이션이 필요 없다면 `extend.animation`/`keyframes` 제거.

### [Low] [D1] `web/postcss.config.js`가 `.js` 확장자 사용 — 프로젝트 전반이 `.ts` 설정 (`tailwind.config.ts`, `vite.config.ts`)
- 파일: `web/postcss.config.js`
- 설명: 일관성 경미 이슈. postcss는 TS config 지원이 플러그인 의존이라 유지 가능.

### [Low] [D1] `config.yaml.example`의 `requests_dir` 기능이 주석으로만 존재 ("if needed in future")
- 파일: `config.yaml.example:55-56`
- 설명: dead option placeholder → 혼란 유발.
- 수정 제안: 구현될 때까지 제거.

---

## 긍정적 관찰

- **다단계 빌드 구조**가 명확하게 분리됨 (`go-builder` → `node-builder` → runtime). 스테이지별 주석도 상세.
- `config.yaml.example`·`Dockerfile`·`.env.example` 주석 밀도가 높아 신규 기여자 온보딩 친화적.
- `web/tsconfig.json`의 `strict: true` + `forceConsistentCasingInFileNames: true` 기본 안전 설정.
- 컨테이너에서 non-root 유저(`appuser:1001`)로 강등 (`Dockerfile:48-49,82`).
- `.gitignore`/`.dockerignore`가 `.env*`, `requests.db`, `.claude/`, `config.yaml` 등 대부분의 비밀/대용량 파일을 제외.
- `vite.config.ts`의 `.data` bypass 주석이 Remix v3 single-fetch 동작을 명시적으로 설명.
- Remix future flags 전부 활성 (`v3_fetcherPersist`, `v3_relativeSplatPath`, `v3_throwAbortReason`, `v3_singleFetch`, `v3_lazyRouteDiscovery`) — 마이그레이션 대비 선제적.

---

## Cross-cutting 리뷰 시 참고 단서

- **CC-04 설정/비밀 관리**:
  - `.env.example` 키 집합: `PORT, READ_TIMEOUT, WRITE_TIMEOUT, IDLE_TIMEOUT, ANTHROPIC_FORWARD_URL, ANTHROPIC_VERSION, ANTHROPIC_MAX_RETRIES, DATABASE_PATH` (8개)
  - Dockerfile ENV 집합: `PORT, WEB_PORT, READ_TIMEOUT, WRITE_TIMEOUT, IDLE_TIMEOUT, ANTHROPIC_FORWARD_URL, ANTHROPIC_VERSION, ANTHROPIC_MAX_RETRIES, DB_PATH` (9개, `WEB_PORT` 추가, `DATABASE_PATH`→`DB_PATH` 개명)
  - config.yaml.example 언급 env (L78-100): `PORT, READ_TIMEOUT, WRITE_TIMEOUT, IDLE_TIMEOUT, ANTHROPIC_*, OPENAI_API_KEY, OPENAI_BASE_URL, DB_PATH, SUBAGENT_MAPPINGS`
  - **CC에서 BE config 로더(예: `proxy/internal/config/*.go`)가 실제 읽는 키 집합과 대조 필요**. `DATABASE_PATH` 키가 BE에 있는지 확인 필수.
- **CC-01 인증 플로우**: `config.yaml.example:48`의 `sanitize_headers: true`가 BE 로깅 파이프라인에서 실제로 적용되는지, 또 UI에서 `sha256:<hex>` 노출 처리 일관성 확인 필요 (BE-01/BE-02 리뷰 참조).
- **CC-02 API 계약 정합성**: `vite.config.ts:27`의 프록시 타겟 `http://localhost:3001` 이 `Dockerfile:68`의 `ENV PORT=3001` 과 암묵적 결합. FE 기대 URL이 하드코딩됨 — FE 환경변수 전환 필요 시 CC에서 재확인.
- **CC-03 에러 처리**: `docker-entrypoint.sh`의 프로세스 관리가 단일 지점. BE가 fatal log를 찍고 죽으면 컨테이너 전체 재시작 정책이 없다면 HEALTHCHECK가 유일한 복구 경로 — 오케스트레이터 수준 확인 필요.
