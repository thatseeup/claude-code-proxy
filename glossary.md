# Glossary — claude-code-proxy

Claude와 대화할 때 공통 용어로 활용하는 파일입니다.

---

## 아키텍처 / 구성 요소

| 용어 | 설명 |
|------|------|
| **proxy** | Go 백엔드 서비스 (`:3001`). Claude Code의 `/v1/messages` 요청을 가로채 저장·변환·라우팅 |
| **web** | Remix 프론트엔드 (`:5173`). 요청 목록·대화 모니터링 대시보드 |
| **provider** | 실제 LLM API 호출 담당 인터페이스. 현재 `anthropic` / `openai` 두 가지 |
| **subagent** | Claude Code의 커스텀 agent (`.claude/agents/<name>.md`). system prompt 해시로 식별해 다른 모델/프로바이더로 라우팅 |
| **model router** | `service/model_router.go`. provider prefix 패턴 매칭 + subagent 해시 매칭으로 라우팅 결정 |
| **session** | Claude Code 실행 단위. `X-Claude-Code-Session-Id` 헤더로 식별. 빈 값 → `unknown` 버킷 |
| **unknown 버킷** | session_id가 없는 요청 묶음. `sessionId=unknown` 파라미터로 조회 |
| **conversation** | `~/.claude/projects/<encoded-cwd>/<sessionID>.jsonl` 파일 하나 = 하나의 대화 |
| **project** | `~/.claude/projects/<encoded-cwd>/` 디렉터리 단위. 여러 conversation 포함 |

---

## 라우팅

| 용어 | 설명 |
|------|------|
| **RoutingDecision** | `DetermineRoute()` 반환값. `{Provider, OriginalModel, TargetModel}` |
| **providerPatterns** | prefix 매칭 배열. `gpt-` → openai, `o1/o3` → openai, `claude-` → anthropic. 순서 중요(첫 매치 우선) |
| **subagent 해시 매칭** | system 배열이 정확히 2개이고, `system[0]`에 "You are Claude Code" 포함, `system[1]` static prompt SHA256 앞 16자리가 일치할 때 subagent로 판정 |
| **static prompt** | subagent 프롬프트에서 `Notes:` 이전 구간. 해시의 기준이 되는 고정 부분 |
| **encoded CWD** | `~/.claude/projects/` 하위 디렉터리명. 경로 구분자 `/` → `-` 인코딩. `decodeProjectPath`가 복원 |

---

## 데이터 / 저장

| 용어 | 설명 |
|------|------|
| **RequestLog** | 요청 저장 단위 DTO. `BodyRaw`(DB 저장) vs `Body interface{}`(API 응답용) 구분 |
| **ResponseLog** | 응답 저장 DTO. `StreamingChunks`, `IsStreaming`, `ResponseTime` 포함 |
| **session_id** | requests 테이블 컬럼. `X-Claude-Code-Session-Id` 헤더 값 |
| **SessionSummary** | 세션 요약 `{sessionId, firstTimestamp, lastTimestamp, requestCount}` |
| **ProjectSummary** | 프로젝트 요약 `{projectPath, displayName, lastMTime, conversationCount}` |
| **BodyBytesKey** | `context.BodyBytesKey = "bodyBytes"`. middleware → handler 간 요청 바디 전달 키. 변경 금지 |
| **prompt_grade** | `PromptGrade` JSON 컬럼. `Score/MaxScore/Feedback/ImprovedPrompt/Criteria` |

---

## 스트리밍

| 용어 | 설명 |
|------|------|
| **SSE** | Server-Sent Events. `data: ` prefix 파싱으로 처리 |
| **StreamingEvent** | SSE 이벤트 DTO. `{type, index, delta, content_block}` |
| **message_start / content_block_delta / message_delta / message_stop** | Anthropic 표준 스트리밍 이벤트 타입 |
| **content_block_start / content_block_stop** | 블록 경계 이벤트 |
| **transformOpenAIStreamToAnthropic** | OpenAI SSE → Anthropic SSE 변환 함수. `choices` + `usage` 케이스 순서 중요 |

---

## OpenAI 변환

| 용어 | 설명 |
|------|------|
| **AnthropicToOpenAI 변환** | `openai.go`. `max_tokens` → `max_completion_tokens`, o-series는 `temperature` 제거, `tool_choice` 변환 |
| **OpenAIProvider** | `provider/openai.go`. Anthropic 요청을 OpenAI 형식으로 변환해 포워딩 후 응답 역변환 |

---

## 보안

| 용어 | 설명 |
|------|------|
| **SanitizeHeaders** | 민감 헤더(`x-api-key`, `authorization`, `anthropic-api-key` 등)를 SHA256 해시로 대체 |
| **sanitize_headers** | `config.security.sanitize_headers`. false면 평문 저장(로컬 디버깅 전용) |

---

## 설정 / 환경

| 용어 | 설명 |
|------|------|
| **config.yaml** | 주 설정 파일. `server / providers / storage / subagents / security` 섹션 |
| **설정 로드 순서** | 기본값 → `config.yaml` → ENV 오버라이드 (ENV 최우선) |
| **subagents.enable** | subagent 라우팅 기능 on/off. false면 모든 요청이 기본 provider로 |
| **subagents.mappings** | `map[agentName]targetModel`. config.yaml에 선언 |

---

## UI 컴포넌트 (Remix)

| 용어 | 설명 |
|------|------|
| **SessionPicker** | 세션 전환 드롭다운 + 삭제 버튼. `/requests/:sid` 좌측 패널 상단 |
| **ProjectPicker** | 프로젝트 전환 드롭다운(삭제 없음). `/conversations/:pid` 좌측 패널 상단 |
| **HorizontalSplit** | 좌/우 드래그 splitter. 상태 영속화 없음, 매 마운트 디폴트(420px)로 리셋 |
| **RequestDetailContent** | 요청/응답 상세 뷰 |
| **ConversationThread** | 대화 스레드 렌더링 |
| **rid** | `?rid=` 쿼리 파라미터. 선택된 요청 ID |
| **sid** | `?sid=` 쿼리 파라미터. 선택된 대화 ID (conversations 뷰) |
| **model 필터** | `?model=` 쿼리 파라미터. 요청 목록 모델별 필터링 |

---

## 개발 / 빌드

| 용어 | 설명 |
|------|------|
| **run.sh** | 로컬 dev 실행 스크립트. proxy 빌드 + Remix dev 동시 기동, 종료 시 cleanup trap |
| **Makefile 타겟** | `install / build / dev / clean / db-reset` |
| **CGO_ENABLED=1** | go-sqlite3 CGO 필수. Dockerfile에서 변경 금지 |
| **bin/proxy** | 빌드 산출물 바이너리. 커밋됨 — 직접 수정 금지 |
| **vite dev proxy** | `/api/*` → `http://localhost:3001`. 프론트에서 백엔드 API 투명 접근 |
