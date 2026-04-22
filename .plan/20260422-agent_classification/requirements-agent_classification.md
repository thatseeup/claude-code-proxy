# Agent 유형별 상세 분류

/o-implementation-plan의 입력으로 제공할 파일이다.

## 문제점

현재 Body.system[1] 기준의 분류가 정확하지 않다.

## 새로운 분류 기준

Agent
- Body.system[1]가 'You are a Claude agent'로 시작
- Body.system[2]가 'You are an agent for Claude Code'로 시작
- Body.system[2]가 'You are a file search specialist for Claude Code'로 시작
- 두 조건 중에 하나만 부합하면 된다.

Security Monitor
- Body.system[1]가 'You are a security monitor'로 시작

Main session
- Body.system[2]이 'You are an interactive agent'로 시작
- 지금처럼 UI에 Chip 표시하지 않는다.

Other
- 나머지는 Other로 표시
- system 배열 길이가 짧거나 없거나 하는 등의 예외 상황도 모두 Other

판단 순서
1. system[1]이 'You are a Claude agent'로 시작 → Agent
2. system[1]이 'You are a security monitor'로 시작 → Security Monitor
3. system[2]이 'You are an interactive agent'로 시작 → Main session
4. system[2]가 'You are an agent for Claude Code'로 시작 → Agent
5. system[2]가 'You are a file search specialist for Claude Code'로 시작 → Agent
6. 그 외 → Other

## UI

- 기존 Agent chip 표시 자리에 Main session은 표시없고 나머지는 chip으로 표시

## 구현 완료

- 간단해서 IMPLEMENTATION_PLAN 생성없이 바로 구현
