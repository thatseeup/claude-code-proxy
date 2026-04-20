# HTTP Raw data 표시는 모두 원본 순서 보장

/o-implementation-plan의 입력으로 제공할 파일이다.

## 의도

가공하지 않은 메시지는 원본의 순서를 유지해야 한다. 현재 DB에 저장하는 과정에서 순서가 유지되지 않는 경우가 많다. 

## 원본 출력해야 하는 곳

- Request Headers
- Request Body (이미 작업 완료)
- Response Headers
- Response Body
- Streaming Response / Raw Streaming Data

## DB 스키마 

- 필요하면 스키마를 변경한다.
- 기본 DB는 지워도 되므로 마이그레이션을 고려하지 않는다.
- 가능하면 같은 내용을 두 가지 형식으로 보유하지 않는다. Raw data로 충분한 경우에는 그렇게 한다.

## 리뷰 결과

Go net/http의 제약으로 진행하지 않는다.