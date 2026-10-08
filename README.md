# runograph v0.2

삼성헬스 내보내기 ZIP을 **기기 안에서** 읽는 한국어 러닝 기록장. 미니멀 디자인의 요약·러닝·성장 화면과 동기화된 심박·페이스·케이던스 그래프를 제공합니다.

React · TypeScript · Vite · Tailwind CSS · shadcn 방식의 로컬 UI 컴포넌트 · Recharts · zip.js · Papa Parse · Web Worker. 서버 함수, 로그인, DB, API 키가 필요 없는 정적 앱입니다.

## 실행

```sh
npm ci
npm run dev
```

터미널에 표시되는 로컬 주소를 열어 삼성헬스에서 내보낸 원본 ZIP을 선택하세요. 압축을 풀 필요가 없습니다. 새로고침하면 기록은 사라지며 파일을 다시 선택해야 합니다. Node 20.19 이상 또는 22.12 이상에서 빌드할 수 있습니다. 현재 검증 환경은 Node 20.20.0입니다.

## 구현한 기능

- 선택적인 CSV/러닝 JSON 읽기, 진행 상태, 즉시 취소와 재선택, 크기·경로·CRC 검증
- UTC/기록 시간대, 단위, 중복·충돌·결측 정규화; JSON 거리 의미 판별
- 지표별 품질 상태, 짧거나 요약이 불일치하는 기록의 보류·원본 확인·사용 여부 조정
- 심박 중심 상세, 나눠/겹쳐 보기, 독립 Y축, 표시용 추세, 긴 공백·주 관측 그룹 탐색
- 달리기 페이스 축 집중과 바깥 관측 표식, 실제 시간 구간 확대·커버리지·초중후반 통계
- 안정 관측에 연속 가중치를 적용한 비슷한 속도의 심박 / 비슷한 심박의 페이스 비교
- 같은 길이의 두 기간, 익명 기기 그룹, 실제 날짜별 러닝 점·대표값·분포·민감도·근거 구간 연결
- 운동시간·이어진 달리기·전후반 유지·활동 일수·주간/월간 꾸준함 질문
- 정지·걷기·달리기 추정, 심박 급변·사용자 기준 이상 구간, 엄격한 드리프트 보조 지표
- 한국어 모바일 화면, 밝은/어두운 모드, 날짜·거리 검색과 기간 필터
- 계산 버전·비교 조건·제외 여부를 담는 개인 식별자·GPS 없는 JSON 리포트, 데이터 초기화
- 홈 화면 설치용 매니페스트, SVG·고해상도 PNG 아이콘, iOS 시작 이미지, 밝은/어두운 로딩 화면

빈 값은 0으로 대체하지 않습니다. 심박·성장 비교에는 관측 수와 계산 조건을 표시하며 질병·위험·회복심박을 추정하지 않습니다.

홈 화면 설치는 배포 후 브라우저 메뉴에서 진행합니다. 현재 오프라인 새 실행은 지원하지 않으며, 다시 열 때 ZIP을 선택해야 합니다. 아이콘 원본과 생성·설치 안내는 [PWA 문서](docs/PWA.md)에 있습니다.

## 검증

```sh
npm test
npm run build
npx playwright install chromium webkit
npm run test:e2e
```

Playwright는 `dist/`를 서비스하므로 빌드를 먼저 실행합니다. 모바일 Chromium/WebKit과 320px 화면에서 합성 ZIP을 사용합니다. 실제 OS 파일 선택창·Samsung Internet·저사양 휴대폰 메모리는 별도 실기기 검증이 필요합니다.

실제 ZIP의 로컬 검증은 아래처럼 실행합니다. 결과는 Git/배포에서 제외한 `.local/implementation-check.json`에만 기록합니다.

```sh
RUNOGRAPH_ZIP="/absolute/path/to/export.zip" npm run check:local
```

원본 ZIP, 추출 폴더, 건강 데이터, 개인 스크린샷은 커밋하지 마세요. 기존 `samsunghealth*/` 자료와 `.local/`은 `.gitignore` 및 `.vercelignore`에서 제외됩니다. 합성 테스트 ZIP은 실행 중 생성하며 제품에 포함하지 않습니다.

## Vercel 배포

`vercel.json`에 Vite 빌드, `dist/` 출력, 외부 데이터 전송을 막는 CSP와 보안 헤더를 설정했습니다. 로컬 preview에도 같은 헤더를 적용해 테스트합니다. 서버 함수와 유료 API를 만들지 않습니다.

CLI로 배포하려면 본인 계정 로그인 후 프로젝트 루트에서 실행합니다.

```sh
VERCEL_TELEMETRY_DISABLED=1 npx vercel login
VERCEL_TELEMETRY_DISABLED=1 npx vercel --prod
```

로그인 후 개인 Hobby 프로젝트를 선택합니다. 배포 대상은 앱 코드이며 개인 ZIP은 제외합니다. Hobby는 개인·비상업 용도의 무료 플랜으로 사용량 제한이 있습니다. [Hobby 공식 조건](https://vercel.com/docs/plans/hobby), [CLI 배포](https://vercel.com/docs/cli/deploy), [CLI telemetry 설정](https://vercel.com/docs/cli/about-telemetry).

GitHub와 연결한 프로젝트는 푸시 후 Vercel의 배포 상태를 확인하세요. 배포 URL의 보안 헤더와 Worker/ZIP 읽기는 별도 확인 항목입니다.

## 문서

- [개편 확정 스펙 v0.2 — A–C 구현](docs/REVISION_SPEC.md)
- [현재 구현과 검증 범위](docs/IMPLEMENTATION.md)
- [PWA 아이콘·시작 화면·설치 범위](docs/PWA.md)
- [제품 기획 및 분석 기준](docs/PRODUCT.md)
- [디자인](docs/DESIGN.md)
- [그래프 경험 스펙](docs/GRAPHS.md)
- [실제 파일 기반 파서 설계](docs/PARSER.md)

기획 문서는 초기 설계 기록입니다. 현재 지원 범위와 검증은 IMPLEMENTATION.md를 기준으로 확인합니다. 선택형 기기 내 저장·ZIP 병합은 v0.3 범위로 남아 있습니다.
