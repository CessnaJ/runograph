# 실제 내보내기 기반 파서 및 처리 설계 v0.1

2026-10-08 로컬 ZIP의 중앙 디렉터리와 운동 CSV, 관련 러닝 JSON만 선택적으로 읽었다. 전체 압축 해제나 서버 전송을 수행하지 않았다. 실제 개인별 개수·용량·품질 통계는 Git에서 제외한 `.local/zip-structure.md`에 기록한다.

## 1. 확인한 구조

```text
<export-root>/
  com.samsung.shealth.exercise.<export-stamp>.csv
  jsons/
    com.samsung.shealth.exercise/
      <shard>/
        <reference>.json
```

- 첫 CSV 행은 메타데이터 `com.samsung.shealth.exercise,<version>,<schema>`다. 두 번째 행이 헤더.
- 파일명의 `shealth`와 주요 헤더의 `com.samsung.health.exercise.` 접두사가 다름.
- `.exercise.extension.`, `.exercise.weather.`, `.exercise.photo.` 등은 주 운동 CSV가 아니다. 파일명만 부분 문자열 검색하면 잘못된 파일을 읽을 수 있음.
- 이번 파일의 헤더는 75열, 데이터 행은 76열이며 마지막 추가 열은 빈 값. 끝의 추가 빈 열만 허용하고 다른 추가값은 경고/오류로 구분.
- 주요 헤더는 긴 접두사 형태. `live_data`, `start_time` 같은 짧은 이름과 명시적으로 매핑한다. 접두사를 모든 열에서 무조건 제거하면 내부 필드와 충돌할 수 있음.
- running=1002, walking=1001. 제목/속도로 운동 타입을 추측하지 않는다. 알 수 없는 타입은 제외 이유에 표시.
- `live_data` 값은 JSON 파일의 basename. ZIP 내 관련 디렉터리에서 참조를 연결한다.
- JSON 최상위는 배열, 항목의 start_time은 숫자 epoch-ms, heart_rate/speed/cadence/distance 등은 숫자. 일부 항목에는 일부 지표가 없음.
- CSV 시간은 시간대 없는 날짜 문자열이지만 상세 epoch-ms와 비교하면 UTC로 일치. `time_offset`은 `UTC+0900` 문자열.
- `segment` 필드가 있으나 이번 자료에서는 한 종류의 값만 관찰했다. 의미를 확인하기 전 정지/걷기/달리기 코드로 사용하지 않는다.

## 2. 파서 계약

파일 발견은 허용된 exercise CSV basename 패턴과 실제 헤더를 함께 검사한다. 여러 후보가 있으면 개별 파싱 후 내부 UUID로 중복 제거한다. UUID가 없으면 현재 내보내기 안의 행 키를 만들되 다른 기록과 추정 병합하지 않는다.

헤더 별칭은 각 논리 필드별 whitelist로 정의한다. 같은 논리 필드의 별칭 두 개가 존재하고 값이 다르면 조용히 하나를 선택하지 않고 품질 문제로 기록한다. CSV 행의 필드 수 오류를 마지막 빈 열 예외 외에는 숨기지 않는다.

숫자 빈칸, null 문자열, NaN/Infinity를 null로 정규화한다. 0 거리나 0 속도는 유효한 상태일 수 있으므로 결측과 구별한다. 심박 0은 측정 없음으로 처리하되 높은 양수 심박만으로 삭제하거나 위험 판정하지 않는다. 음수 속도/거리/시간은 무효. 센서 이상 후보는 별도의 품질 플래그로 남기며 계산 제외 이유를 표시한다.

원본 허용 필드만 읽어 내부 모델에 옮긴다. UUID는 Worker 내부 연결/중복 제거용, UI에는 순번 기반 앱 ID를 전달한다. 위치·제목·댓글·기기 원본 이름·프로필은 모델과 리포트에 포함하지 않는다.

## 3. 단위와 시간

- 저장 및 계산 단위: epoch-ms, elapsed-ms, duration-ms, distance-m, speed-m/s, heart-rate-bpm, cadence/min.
- 표시 단위: km, 분:초/km, bpm, 분당 횟수. 속도 >0일 때 paceSecPerKm=1000/speed. 속도 0의 페이스는 무한대 숫자 대신 `정지` 또는 결측 상태로 표시.
- CSV UTC 문자열은 직접 구성요소를 파싱하고 UTC로 생성한다. `new Date(시간대 없는 문자열)`의 브라우저별 로컬 해석에 의존하지 않는다.
- 오프셋은 명시된 포맷별로 해석: `UTC±HHMM`, `±HH:MM`, `±HHMM`, 확인된 스키마의 수치 ms. 출처 모르는 수치의 단위를 규모만으로 추측하지 않는다.
- 원본 시각이 Z/명시 오프셋을 이미 갖는 포맷이면 그것을 epoch-ms로 변환하고 time_offset을 epoch에 다시 적용하지 않는다.
- 날짜·월별 묶음은 epoch+기록 오프셋에서 달력 성분을 취한다. 현재 기기 시간대를 다시 적용하지 않는다. 오프셋 결측은 UTC로 명시하거나 확인 필요 상태로 표시한다.
- 상세 elapsedMs=pointEpochMs-sessionStartEpochMs. 경계의 미세 오차는 원본을 보존하며 표시/정렬 기준에서만 허용 규칙을 적용한다. 큰 불일치는 상세 불일치 상태로 둔다.
- 샘플 간격은 고정 1초가 아니다. 실제 시간차로 가중하며 화면에 확대해도 측정 해상도가 늘어나는 것처럼 표현하지 않는다.

## 4. 거리 의미는 포맷별로 결정

이번 내보내기에서는 **JSON distance 합이 세션 요약거리와 거의 일치하고, 대부분 배열에서 distance가 증가하지 않는다.** 따라서 해당 포맷은 구간 거리 후보로 분류한다. 마지막 값을 총거리로 사용하거나 distance 차분을 적용하면 잘못된 결과가 된다.

삼성 구 SDK의 LIVE_DATA 문서에는 누적거리 설명이 있으므로 모든 내보내기를 동일하게 처리하지 않는다. SDK 문서가 CSV 내보내기 스키마 자체를 보장하는 것은 아니다.

`distanceSemantics: interval | cumulative | unknown`을 세션별 보관한다. 확인된 스키마 adapter와 다음 검증 결과를 함께 사용한다.

1. 구간 후보: sum(distance)와 summaryDistance 비교.
2. 누적 후보: 단조성·리셋/세그먼트 경계 확인 및 최종값/기준값과 summaryDistance 비교.
3. 초기 오차 허용 제안: `max(5m, 요약거리 × 1%)`. 원본 품질과 테스트로 확정.
4. 두 후보가 모두 맞거나 둘 다 맞지 않으면 unknown. 요약 총거리는 그대로 이용 가능하지만 JSON 거리 기반 구간거리·분할은 계산하지 않음.

구간 값이 앞 구간을 가리키는지 뒤 구간을 가리키는지도 검증해야 한다. speed와 시간차의 일관성만으로 확신이 없으면 구간거리 통계를 보류한다. 속도 그래프는 독립적인 speed 필드에서 제공 가능하다. 속도 적분으로 누락 거리를 만들어 삼성 원본 거리라고 표시하지 않는다.

## 5. 중복, 결측, 커버리지

세션은 내부 UUID를 기준으로 중복 제거하고 동일 ID의 갱신 시각이 유효하면 최신 행을 선택한다. 갱신 시각이 같고 내용이 다르면 충돌을 기록한다. 서로 다른 UUID의 비슷한 운동은 자동 합치지 않고 후보 경고만 제안한다.

상세는 안정 정렬 후 동일 시각 완전 중복을 한 번만 사용한다. 같은 시각의 보완 지표는 필드별 병합할 수 있으나 충돌값은 무효/품질 경고로 남긴다. 구간 거리의 동일 시각 충돌을 임의 합산하지 않는다.

관측 구간은 정렬된 인접 시각으로 정의하되 대표 간격의 3배를 넘는 공백은 연결하지 않는 방식을 제안한다. 마지막 샘플 뒤로 운동 종료까지 연장하지 않는다. 각 지표와 동시 측정쌍마다 유효 구간/표본 수를 따로 계산한다. 점 측정값의 구간 대표 사용은 계산 가정임을 공개한다.

속도와 심박이 모두 실제 관측된 공통 시각으로 성장 분석을 구성한다. 결측값을 보간해 분석 표본을 늘리지 않는다. 차트 리샘플링/다운샘플링은 표시용이며 통계 계산 경로와 분리한다.

이동 상태는 `stationary_estimate | walking_estimate | running_estimate | unknown`을 기본 모델로 제안한다. 속도/케이던스와 최소 지속시간을 사용하는 휴리스틱의 수치는 실제 검증 후 확정한다. 원본 정지 상태가 확인되지 않으면 정지와 일시정지 버튼 사용을 동일시하지 않는다. 결측은 unknown이다.

## 6. 제안 모델

```ts
type MetricSource = 'csv-summary' | 'live-observed' | 'unavailable';
type DistanceSemantics = 'interval' | 'cumulative' | 'unknown';
type DetailStatus = 'pending' | 'ready' | 'missing' | 'invalid' | 'limited';

interface SessionSummary {
  id: string; // UI용 순번 기반 키. 원본 UUID는 Worker에서만 유지
  startEpochMs: number | null;
  endEpochMs: number | null;
  offsetMs: number | null;
  durationMs: number | null;
  distanceM: number | null;
  meanHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  detailStatus: DetailStatus;
  qualityIssueCodes: string[];
}

interface ObservedPoint {
  epochMs: number;
  elapsedMs: number;
  heartRateBpm: number | null;
  speedMps: number | null;
  cadencePerMin: number | null;
  rawDistanceM: number | null;
}
```

구현 시 단위를 혼동하지 않도록 branded type 또는 단위가 드러나는 필드 이름을 사용한다. QualityIssue는 code/severity/metric/affectedCount를 갖고, 내부 진단용 원본 UUID와 행 내용은 UI/로그로 보내지 않는다.

## 7. Worker와 메모리

메인 스레드는 File을 Worker에 전달한다. Worker는 ZIP 목록 → exercise CSV → 러닝만 선택 → 참조 인덱스 → JSON을 하나씩 읽기 → 정규화/품질 검증 → 요약과 분석용 집계 반환 순으로 처리한다. ZIP 전체를 arrayBuffer로 읽거나 모든 엔트리를 해제하거나 모든 JSON을 동시에 Promise.all로 읽지 않는다.

처음에는 CSV 요약을 먼저 표시할 수 있다. 상세 읽기는 순서대로 처리해 성장 분석용 유효 집계를 만들고, 보관할 정규화 포인트는 메모리 예산 안으로 제한한다. 초과분은 원래 File에서 필요할 때 다시 읽고, 상세 화면 캐시는 LRU 최대 3개 기록을 초기안으로 둔다. 모든 시계열을 React state에 복제하지 않는다.

Worker 메시지 제안: requestId를 포함한 `START / LOAD_DETAIL / ANALYZE / CANCEL / RESET`, 응답은 `PROGRESS / SUMMARIES / DETAIL / ANALYSIS / WARNING / ERROR / CANCELLED`. 오래된 requestId의 응답은 버린다.

취소는 사용할 수 있는 라이브러리 abort 외에, 중단이 느리면 Worker를 terminate하고 재생성한다. ZIP 라이브러리의 내부 Worker를 활성화하는 경우 그 수명 관리까지 포함해 중단을 검증한다. 내부 Worker 비활성화를 먼저 검토한다.

## 8. 안전 제한 초기안

아래 수치는 아직 스마트폰에서 보장한 상한이 아니다. OS가 브라우저를 종료하면 오류를 잡을 수 없으므로 복귀 후 재선택 안내도 제공한다.

| 대상 | 초기 제한안 |
| --- | --- |
| ZIP 압축 크기 | 256MiB에서 주의, 512MiB 초과는 요약 모드 등의 재검토 대상 |
| 엔트리 수 | 100,000에서 중단. 스트림으로 목록을 읽는 동안에도 집계 |
| 대상 CSV 출력 | 파일당 16MiB |
| 대상 JSON 출력 | 파일당 8MiB |
| 선택한 압축 해제 출력 총합 | 처리당 128MiB. 메모리 보관량과 별도 |
| 정규화 상세 포인트 보관 | 32MiB 예산 초기안. 객체의 실제 메모리 차이도 고려해 실측으로 조정 |
| 차트 표시 | 한 계열당 1,000점 정도. 피크를 보존하는 다운샘플링 |

헤더에 선언된 크기 외에 압축 해제 writer의 실제 출력 bytes도 제한한다. JSON 구조 깊이, 레코드 수, 숫자의 유한성을 검사한다. 압축률만으로 안전성을 판단하지 않는다. ZIP의 무관한 대용량 파일은 해제하지 않는다.

경로의 `..`/절대 경로, 중복 엔트리 이름, 모호한 basename 참조, CRC 손상, 암호화, 중첩 ZIP, 미지원 압축을 명시적으로 처리한다. 참조는 허용된 JSON 영역으로 한정하고 같은 basename이 여러 개면 임의로 고르지 않는다. 외부 URL 참조는 fetch하지 않는다. 미지원 형식은 데이터 부족과 구별하며 가능한 요약은 남긴다.

## 9. 구현 전 남은 항목

- 구간 distance의 앞/뒤 구간 대응, `segment`, 내부 live_data의 의미. 근거가 확인될 때까지 보완 경로로 사용하지 않는다.
- 여러 기기/과거 내보내기 형식 대응. 이번 ZIP 하나로 모든 버전을 지원한다고 선언하지 않는다.
- 차이 있는 중복, 시간 경계, 결측을 다루는 의미 있는 합성 테스트.
- zip.js의 중단/출력 제한 API, Recharts의 터치/커서 동기화, Safari 메모리 동작 기술 검증.

공식 참조: [Samsung Exercise](https://developer.samsung.com/health/android/data/api-reference/com/samsung/android/sdk/healthdata/HealthConstants.Exercise.html), [Exercise Type](https://developer.samsung.com/health/android/data/api-reference/EXERCISE_TYPE.html). SDK 단위의 참고와 실제 CSV 관찰을 구별한다.
