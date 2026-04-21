# Session title 추가

/o-implementation-plan의 입력으로 제공할 파일이다.

## 문제점

Claude Code 세션은 타이틀이 존재하지만 현재 Conversations UI에는 타이틀을 표시하지 않고 있다.

## jsonl의 title 정보

~/.claude/projects 의 jsonl 파일 중 타이틀 관련된 type은 "ai-title", "custom-title" 두 가지가 있다.

```
{"type":"ai-title","sessionId":"fd6172d6-4f70-4b6a-9752-dddd54bcaf65","aiTitle":"Set up Omok project with build and GitHub Pages deployment"}
{"type":"custom-title","customTitle":"오목 만들기","sessionId":"fd6172d6-4f70-4b6a-9752-dddd54bcaf65"}
```

여러 번 등장할 수가 있는데 type에 상관없이 그 중에서 가장 나중에 등장하는 title을 현재 세션의 title로 삼는다.

## Web UI

프로젝트 / 세션 목록
- 현재는 <세션 UUID prefix> <메시지 수> <시각> / <최초 메시지>
- 두 번째 줄의 최초 메시지를 앞에서 구한 title로 대체한다.

## Notice

IMPLEMENTATION_PLAN 없이 바로 구현 완료


