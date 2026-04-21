# Session title 추가

/o-implementation-plan의 입력으로 제공할 파일이다.

## 현재 문제점 

현재의 Project 경로는 -Users-syoh-Development-thatseeup-claude-code-proxy처럼 encoded 되어 있다. 경로의 마지막 폴더에 -이 있는 경우에 폴더 이름 복원이 제대로 되지 않아서 UI 표시가 이상하다.

## encoded-cwd에서 경로 복원하기

경로 복원 함수를 만들어서 필요할 때 사용한다. 
세션 정보는 현재 사용중인 파일 시스템 정보를 이용한다.
-Users-syoh-Development-thatseeup-claude-code-proxy를 복원하는 경우의 예로 설명한다.
1. 먼저 -를 기준으로 split한다. 
 [Users,syoh,Development,thatseeup,claude,code,proxy]
2. 앞에서부터 점층적으로 늘리면서 현재 존재하는 디렉토리임음 파악한다. 디렉토리임을 확인한 경우에는 '/' +  다음 요소, 실패한 경우에는 '-'를 디렉토리를 찾을 때까지 붙인다.
  /Users -> Exist
  /Users/syoh -> Exist
  /Users/syoh/Development -> Exist
  /Users/syoh/Development/thatseeup -> Exist
  /Users/syoh/Development/thatseeup/claude -> Not Exist
  /Users/syoh/Development/thatseeup/claude-code -> Not Exist
  /Users/syoh/Development/thatseeup/claude-code-proxy -> Exist
3. 최종 결과는
   확인된 디렉토리: 
   미확인된 나머지:
   - 파일 시스템에서 폴더가 삭제되어 마지막까지 진행해도 매칭되는 디렉토리를 찾지 못 할 수도 있다.

프로젝트 이름은 다음을 활용한다. 
- 미확인된 나머지가 없는 경우에는 확인된 디렉토리의 마지막 pathname
- 미확인된 나머지가 있는 경우에는 미확인된 나머지

## Web UI

프로젝트 목록
- 현재는 'endeded-cwd의 마지막' / encoded-cwd / mtime의 3행으로 구성되어 있다.
- 상단의 'endeded-cwd의 마지막'을 앞에서 구한 프로젝트 이름으로 대체한다.


