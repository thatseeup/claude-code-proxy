# CHUNK-CC-04 — Cross-cutting 리뷰 (세션/프로젝트 데이터 흐름)

- Executed: 2026-04-23
- Mode: CC
- Reviewer: o-web-reviewer subagent
- Files scanned: 8 (총 4,293 LOC) — 전량 판독
- Scope: session_id end-to-end 흐름, Unknown 버킷, 4필드 enrichment 규약, fsnotify 갱신, 삭제 전파, `?sid=` 쿼리 규약, `existingRequestSessions` 조회, 동시성

## 0. 데이터 흐름 다이어그램

```
Claude Code CLI
  │  X-Claude-Code-Session-Id: <uuid>
  ▼
POST /v1/messages
  │  handlers.go:95  SessionID = r.Header.Get(...)
  ▼
SQLite requests.session_id  (TEXT, NULL 또는 '' = Unknown)
  │  storage_sqlite.go:69-93
  ▼
GET /api/sessions
  │  GetSessionSummaries()  COALESCE(session_id,'')
  │  handlers.go:419  for each: sessionIndex.Lookup(sid)
  ▼
sessionResponse JSON  {sessionId, firstTs, lastTs, count, projectPath, projectDisplayName, title, hasConversation}
  │
  ├── FE: routes/requests.tsx loader ─▶ SessionPicker.sessions
  └── FE: routes/conversations.$projectId.tsx loader ─▶ existingRequestSessionIds: string[]
                                                        (sessionId 외 7개 필드 버림)

병렬 경로:
  ~/.claude/projects/<encoded>/<sid>.jsonl
    │  fsnotify Watch → handleFSEvent → upsertFile
    │  (폴백: 10s 폴링 Rebuild)
    ▼
  SessionIndex.entries[sid] = {sessionID, projectPath, displayName, title}

삭제 경로:
  SessionPicker 휴지통
    └▶ fetch DELETE /api/sessions/:id
        └▶ (Remix proxy) api.sessions.$sessionId.tsx
            └▶ BE DeleteSession
                └▶ storageService.DeleteRequestsBySessionID
                    (jsonl 보존 — Claude Code 소유)
```

---

## 1. 주제별 교차 확인 결과

### 1.1 `X-Claude-Code-Session-Id` → SQLite → API → UI 일관성

| 단계 | 파일:라인 | 관찰 |
|---|---|---|
| 수신 | handlers.go:95 | `r.Header.Get("X-Claude-Code-Session-Id")` — 길이/charset 검증 없음 |
| 저장 | storage_sqlite.go:76-93 | TEXT 컬럼. 빈 문자열 그대로 저장 |
| 그룹화 | storage_sqlite.go:498-506 | `COALESCE(session_id,'')` 로 NULL과 '' 동일 버킷 |
| 필터 | storage_sqlite.go:411-416 | `sessionIDFilter==""` → `IS NULL OR = ''` |
| 삭제 | storage_sqlite.go:563-565 | 동일 규칙 |
| Enrich | handlers.go:419-426 | `s.SessionID != ""` 가드, `sessionIndex != nil` 가드 |
| 노출 | handlers.go:389-398 | `sessionResponse` 구조체, 4개 프로젝트 필드 포함 |
| FE | SessionPicker.tsx:9-18 | 4개 필드 모두 `?:` optional |

**일관성 평가**: 대체로 일관됨. 다만 3가지 공백:

1. **헤더 검증 부재**: 악의적 헤더(10MB 문자열, 제어문자, SQL/XSS 페이로드)가 DB에 그대로 저장되고 다시 FE에 노출됨. UUID 정규식(`^[0-9a-f-]{8,64}$`) 또는 길이 cap 권장.
2. **빈 문자열 vs NULL의 3가지 처리점**: `COALESCE` (그룹화), `IS NULL OR = ''` (필터/삭제), `!= ""` (enrich). 각 경로의 규칙이 서로 다른 표현이지만 동일 의미 — 리팩토링 시 한 곳만 고치면 균형이 깨지기 쉬움.
3. **Contract gap**: BE는 항상 4개 필드를 포함(빈 문자열)하지만 FE `SessionSummary`는 모두 `?:` optional. 계약이 느슨함. Zod/타입 공유 필요.

### 1.2 Unknown 버킷 처리 일관성

| 계층 | 토큰 | 비고 |
|---|---|---|
| URL path segment | `"unknown"` | `sessionPathUnknown` (handlers.go:436) |
| Storage sessionID | `""` | handlers.go:194, 448에서 변환 |
| FE URL constant | `UNKNOWN_TOKEN="unknown"` | **4곳 재선언**: SessionPicker.tsx:25, requests.$sessionId.tsx:44, requests.tsx:18, 그리고 암묵적으로 api.sessions.$sessionId.tsx |
| FE project label | `UNKNOWN_PROJECT="Unknown"` | SessionPicker.tsx:26 (케이스 다름!) |
| BE hasConversation | 항상 `false` | handlers.go:419 |

**발견:**
- **api.sessions.$sessionId.tsx:10-12**은 `sessionIdToken === ""`만 400으로 거부하고, 리터럴 `"unknown"`은 그대로 BE로 포워드. BE는 `"unknown"` → `""` 변환을 수행하므로 Unknown 버킷 삭제가 정상 작동. **그러나** 이 계층에서 `"unknown"`이라는 매직 리터럴에 대한 방어 주석/검증이 전무하여, BE 규약이 바뀌면 조용히 깨진다.
- **FE 리터럴 4중복** — 이미 FIXES #160에 등록됐지만 당시 3개로 기록됨. 실제 4개 + `UNKNOWN_PROJECT` 2번째 리터럴까지 감안하여 범위 확장 필요.
- **case 불일치**: `UNKNOWN_TOKEN` lowercase, `UNKNOWN_PROJECT` capitalized. BE 경로 토큰은 lowercase, FE 라벨은 capitalized — 의도된 분리이나 스크린리더/URL 해석기에서 혼동 유발 가능.

### 1.3 4필드 규약 (projectPath/projectDisplayName/title/hasConversation)

**소스 → 싱크 필드 매핑**:

| SessionIndexEntry (service) | sessionResponse (wire) | SessionSummary (FE) |
|---|---|---|
| `ProjectPath` | `projectPath` | `projectPath?` |
| `DisplayName` ⚠️ | `projectDisplayName` ⚠️ | `projectDisplayName?` |
| `Title` | `title` | `title?` |
| *(derived: found=true)* | `hasConversation` | `hasConversation?` |

**발견:**
- **이름 꼬임**: service의 `DisplayName`이 wire에서 `projectDisplayName`으로 이름이 바뀜. 의도(namespace 분리)는 이해되나 **어디에서 rename되는지 주석 없음** — handlers.go:422 `sr.ProjectDisplayName = entry.DisplayName` 한 줄이 계약.
- **derived field 계산 위치**: `hasConversation`은 handler에서만 결정(`found` 플래그). SessionIndex 자체는 이 개념을 모름. Rebuild 중 누락(`extractSessionTitle` 에러로 entry insert 안 됨?) 코드 경로를 봤을 때 — session_index.go:131-135 — 에러 발생 시에도 `newMap[sid] = ...`를 **여전히 수행**하므로 entry는 존재한다. 즉 lookup 성공 → `hasConversation=true` 이지만 title은 빈 문자열. FE는 이 상태를 구별 못함.
- **필드 유실 지점**: 아래 1.7 참조.

### 1.4 jsonl 변경 → SessionIndex 갱신

**경로:**
- Primary: fsnotify (session_index.go:157-205)
- Fallback: 10초 polling Rebuild (session_index.go:332-346)
- 이벤트 매핑: Create(dir|file), Write(file), Remove|Rename (session_index.go:213-249)

**관찰:**
- **새 프로젝트 디렉토리 Create + 즉시 write 레이스**: handleFSEvent.Create → `watcher.Add(path)` + `indexProjectDir(path)` 순서. `Add` 완료 전 첫 write가 도착하면 이벤트 유실. `indexProjectDir`는 현재 파일 시스템 상태를 스캔하므로 title은 캡쳐되나, 그 **직후** 쓰기 이벤트가 사라지면 다음 polling Rebuild까지 10초 stale.
- **Polling 영구 고착**: fsnotify 실패 시 polling으로 진입 후 복구 시도 없음 — FIXES #51 기록됨.
- **레이스: 첫 `/v1/messages` 수신 시 jsonl 미존재**: Claude Code는 보통 세션 시작 후 bidirectional로 `/v1/messages` 호출. jsonl이 생성되는 시점은 tool event 이후일 수 있음. 즉 **첫 SaveRequest 시점에 SessionIndex에 entry 없음** → 첫 /api/sessions 응답에서 `hasConversation=false`. 이후 fsnotify이 Create 이벤트를 받아 upsert하지만, **FE는 자동 재검증 안 함** (revalidator 수동 호출 외에는 polling 없음). 사용자는 수동 새로고침까지 "Untitled / Project Not Found" 본다.
- **서브-서브 디렉토리 미감시**: fsnotify 1단계만 `watcher.Add` — FIXES #50 기록됨.

### 1.5 삭제 전파 (`DELETE /api/sessions/:id`)

**흐름:**
```
SessionPicker.handleDelete (fetch 직접 호출)
  ├─ POST /api/sessions/:id  (wrapper route action)
  │    ├─ sessionIdToken="" 이면 400
  │    └─ 그 외는 BE로 포워드
  ├─ BE DeleteSession
  │    ├─ id=="unknown" → sessionID=""
  │    └─ storage.DeleteRequestsBySessionID
  ├─ revalidator.revalidate()  ← 비동기
  └─ navigate("/requests")    ← 즉시
```

**관찰:**
- **Revalidate/navigate race**: `revalidate()`는 비동기, `navigate`는 즉시. 느린 BE에서 parent loader가 old 데이터로 재실행될 수 있으나, `/requests`는 loader가 `redirect`로 최신 세션으로 이동하므로 사용자 체감 영향은 미미.
- **jsonl 보존**: BE 경로에 jsonl 삭제 호출 없음. ✅ 설계대로.
- **확인 다이얼로그 부재**: FIXES #81.
- **FE가 `useFetcher` 대신 `fetch` 직접**: FIXES #80.
- **api.sessions.$sessionId.tsx의 UNKNOWN 처리 누락**: FIXES #106.

### 1.6 `?sid=` 쿼리 규약 (프로젝트 전환)

| 컴포넌트 | 전환 시 쿼리 | 동작 |
|---|---|---|
| ProjectPicker.handleSelect | 없음 (생성하지 않음) | ✅ `?sid=` 제거 |
| SessionPicker.handleSelectProject | `?project=<name>` (+ `?model=` 유지) | 세션만 전환, project는 URL scope |
| SessionPicker.handleSelectSession | 동일 | 동일 |

**발견:**
- ProjectPicker는 `?sid=` 제거, SessionPicker는 `?model=` 유지 — 비대칭 규약. 의도됐지만 **코드 주석만 있고 문서 없음** (`project-map.md`에도 없음).
- **UNKNOWN_PROJECT 쿼리 오염**: FIXES #91 — `handleSelectSession`이 `selectedProject==="Unknown"`일 때 `?project=Unknown` 를 URL에 찍음.

### 1.7 `existingRequestSessionIds: string[]` — 필드 유실

**현황:**
```ts
// conversations.$projectId.tsx:69-80
const data = (await res.json()) as Array<{ sessionId: string }> | null;
return (data ?? []).map((s) => s.sessionId).filter(Boolean);
```

`SessionSummary`의 **7개 부가 필드 전부 버림**: firstTimestamp, lastTimestamp, requestCount, projectPath, projectDisplayName, title, hasConversation.

**UI 영향:**
- `SquareTerminal` 버튼(Go to Requests) — 세션이 존재하는지만 알림. 사용자에게 "몇 개 요청이 있는지 / 최근 활동" 미리보기 제공 불가.
- 버튼 툴팁이 `"No matching request session"` 외에 상세 정보 없음.

**추가 문제:**
- 전체 `/api/sessions` 응답을 받아서 `sessionId`만 사용 — 대역폭 낭비.
- 동일 응답을 parent `routes/requests.tsx`가 이미 가지지만 `routes/conversations`는 parent가 다르므로 공유 불가 — FIXES #110.

### 1.8 동시성 — Rebuild/Lookup/Watch ↔ SaveRequest

**SessionIndex 동기화:**
- `sync.RWMutex`: Lookup=RLock, Rebuild/upsert/remove=Lock
- `GetSessions` (handlers.go:400)가 N번 `Lookup` 순차 호출 — N회 RLock/RUnlock (각 호출). Rebuild 완료 대기 시 꼬임 없음.
- **Rebuild 중 전체 entries 교체** (session_index.go:146-148): 원자적. 다만 `Rebuild` 진행 중 새 upsertFile 이벤트는 이전 map에 기록될 수 있음 — Rebuild는 구 map 무시하고 새 newMap을 통째로 swap하므로 **그 사이 upsert는 유실**. 폴링 fallback에서만 문제; 정상 fsnotify 모드에서는 `Rebuild`가 한 번만 호출(초기 blocking).
- **초기 Rebuild 순서 가드**: main.go:54 — HTTP listen 이전 블로킹. ✅ 문서화됨.

**SQLite 동시성:**
- `database/sql` 기본 pool — `mattn/go-sqlite3` 직렬화. Write 경합 시 `SQLITE_BUSY`.
- WAL 미설정 — 지표상 부하 낮지만 스트리밍 usage 저장/UI list 조회 동시 발생 시 미세 지연 가능.

### 1.9 필드 유실 요약 표

| BE가 제공 | FE가 소비 | 유실 |
|---|---|---|
| `SessionSummary.firstTimestamp` | SessionPicker: 미사용 | ✓ |
| `SessionSummary.lastTimestamp` | SessionPicker: 표시. conversations.*: 버림 | conv에서 ✓ |
| `SessionSummary.requestCount` | SessionPicker: 표시. conv: 버림 | conv에서 ✓ |
| `SessionSummary.projectPath` | SessionPicker: conv 이동 시 사용. conv: 버림 | conv에서 ✓ |
| `SessionSummary.projectDisplayName` | SessionPicker: 표시. conv: 버림 | conv에서 ✓ |
| `SessionSummary.title` | SessionPicker: 표시. conv: 버림 | conv에서 ✓ |
| `SessionSummary.hasConversation` | SessionPicker: Conversations 버튼 disabled 판단. conv: 버림 | conv에서 ✓ |

→ `conversations.$projectId.tsx`는 7/7 (sessionId 외 전부) 유실.

---

## 2. 새로 발견된 이슈 (FIXES.md append 대상)

| ID | 심각도 | 차원 | 파일:라인 | 이슈 |
|---|---|---|---|---|
| 182 | High | D4 | handlers.go:95 | `X-Claude-Code-Session-Id` 헤더 미검증 저장 |
| 183 | Medium | D2 | conversations.$projectId.tsx:69-80 | `/api/sessions` 응답에서 sessionId 외 7 필드 버림, 전 페이로드 받는 낭비 |
| 184 | Medium | D3 | handlers.go:389-398 + SessionPicker.tsx:9-18 | BE는 항상 4개 프로젝트 필드 emit, FE는 모두 `?:` optional — 계약 느슨 |
| 185 | Medium | D1 | SessionPicker.handleDelete 157-175 | revalidate()/navigate() race, 느린 BE에서 parent loader stale로 재실행 |
| 186 | Medium | D1 | conversations.$projectId.tsx + SessionPicker.tsx (문서 부재) | `?sid=` 제거 규약(ProjectPicker) vs `?model=` 유지(SessionPicker) 비대칭이 project-map/주석 어디에도 문서화 안 됨 |
| 187 | Medium | D1 | SessionPicker.tsx:25-26 | `UNKNOWN_TOKEN="unknown"` + `UNKNOWN_PROJECT="Unknown"` 두 리터럴 case 불일치, 비교 경로에서 혼동 위험 |
| 188 | Medium | D1 | main.go + session_index.go | 새 세션의 첫 `/v1/messages` 수신 시 jsonl 미존재 → `hasConversation=false` 고정, FE 자동 재검증 없어 사용자 수동 새로고침 전까지 stale |
| 189 | Medium | D1 | api.sessions.$sessionId.tsx:10-12 | `"unknown"` 리터럴 방어 주석/검증 없음 — BE 규약 변경 시 조용히 파손 |

**기존 FIXES와의 중첩 (재등록 지양):**
- #50 (sub-sub-dir watcher.Add 누락) — 본 CC에서 §1.4 재확인.
- #51 (polling 고착) — 재확인.
- #80 (useFetcher 미사용) — 재확인.
- #81 (삭제 확인 다이얼로그) — 재확인.
- #91 (UNKNOWN_PROJECT 쿼리 오염) — 재확인.
- #93 (BACKEND URL 하드코딩) — 본 CC 흐름 전체에서 영향.
- #106 (api.sessions.$sessionId.tsx UNKNOWN 분기) — #189로 보강.
- #110 (parent/child loader 중복 호출) — #183과 공명.
- #160 (UNKNOWN_TOKEN 4중복) — 본 CC에서 범위 확인 + #187로 보강.

---

## 3. 긍정적 관찰

- `SessionIndex` 인터페이스 분리 + test-injectable pollInterval — 확장성·테스트 용이.
- 초기 `Rebuild()` 블로킹 + Watch goroutine — 명시적 lifecycle.
- `COALESCE(session_id,'')` 그룹화 + `IS NULL OR = ''` 필터 — NULL/'' 동일 시맨틱 일관되게 SQL로 승격.
- jsonl은 절대 삭제하지 않는 불변 원칙 — `DeleteSession`이 SQLite만 건드림.
- BE `sessionResponse` DTO가 내부 `SessionSummary`와 분리되어 wire contract 명시.
- `DisplayName` → `projectDisplayName` rename은 FE에서 `displayName`(ProjectSummary)와 충돌 회피.
- Rebuild 중 newMap 빌드 후 원자적 swap — lock window 최소화.
- `extractSessionTitle` 경량 스캐너 — 전체 파싱 회피로 Rebuild 비용 절감.

---

## 4. 후속 단계 권장

1. **단기**: #182 (헤더 검증), #189 (UNKNOWN 방어 주석) — 보안/명확성.
2. **중기**: #183 + #110 통합, `/api/sessions` 응답 shape 1회 공유 설계; 공용 backendFetch(#93)와 함께.
3. **중기**: #184 — 타입 공유 (예: `shared/types/session.ts` + BE 코드생성 또는 Zod 런타임 검증).
4. **장기**: #188 — SessionIndex upsert 이벤트를 WebSocket/SSE로 FE에 push하거나 polling revalidate(30s) 도입.

---

## 5. 참고 — 데이터 흐름 계약 요약 (차후 문서화 권장)

- **sessionId wire 형식**: 빈 문자열 = Unknown. URL segment에서는 `"unknown"` 리터럴로 승격. 비UUID 값은 현재 허용(검증 추가 시 후방 호환성 고려).
- **NULL vs ''**: BE 내부에서만 구분. API 응답/FE는 항상 `""`.
- **하위 4 필드**: BE가 항상 emit(기본값 빈 문자열 / false). FE는 runtime 검증 없이 `?:` 처리.
- **jsonl 소유권**: Claude Code CLI가 유일 write. 프록시는 read-only. 삭제는 오직 SQLite rows.
- **Revalidation 트리거**: 수동(useRevalidator) 또는 라우트 변경 시. 자동 polling/WebSocket 없음.
- **프로젝트 전환**: ProjectPicker → `?sid=` 제거 / SessionPicker → `?model=`+`?project=` 유지.
