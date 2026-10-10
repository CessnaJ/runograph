# 홈 화면 설치와 시작 화면

2026-10-08. 미니멀 기록장의 크림색·초록색 팔레트와 `r`/러닝 그래프 심볼을 앱 아이콘과 시작 화면에 적용했다.

## 파일과 생성

- `public/manifest.webmanifest`: 앱 이름, 고정 ID, 시작 주소 `/#summary`, 범위 `/`, standalone 표시, 배경·테마 색, PNG 아이콘.
- `public/icons/icon.svg`: 수정 가능한 벡터 원본. favicon과 앱 헤더에도 사용.
- `public/icons/icon-{32,192,512,1024,2048}.png`: 일반 PNG 출력.
- `public/icons/icon-maskable-512.png`: 배경이 가장자리까지 채워진 Android용 출력. 심볼은 중앙 안전 영역에 배치.
- `public/icons/apple-touch-icon.png`: 불투명 180×180 iOS 홈 화면 아이콘.
- `public/splash/launch-master{,-dark}.{svg,png}`: 밝은/어두운 2160×3840 실행 화면 디자인 원본.
- `public/splash/launch-WxH.png`: 13가지 CSS 화면 크기의 세로·가로용 26개 불투명 시작 이미지. 화면 크기·픽셀 비율·방향 조건으로 `index.html`에 연결.

SVG를 수정한 뒤 아래 명령으로 PNG와 시작 이미지 링크를 재생성한다. sharp는 개발 도구에만 포함되며 브라우저 번들에서 사용하지 않는다.

```sh
npm run assets:pwa
npx prettier --write index.html
npm run build
```

고해상도 원본 전체를 초기 화면에서 읽지 않는다. HTML 시작 화면과 헤더는 SVG 한 개를 사용하고, 매니페스트/Apple 이미지 선택은 브라우저와 OS가 담당한다. 앱 준비가 끝나면 React가 HTML 시작 화면을 교체하며 인위적인 대기 시간을 추가하지 않는다.

## 플랫폼별 표시

Android Chrome 등은 매니페스트의 아이콘·이름·배경색으로 자체 스플래시를 만들 수 있다. `launch-master.png`를 Android가 그대로 표시하는 설정은 아니다. [Web App Manifest 공식 안내](https://web.dev/articles/add-manifest).

iOS는 `apple-touch-icon`, `apple-touch-startup-image`, 홈 화면 웹 앱 메타 태그를 별도로 연결했다. 정확한 화면 조건과 일치하는 밝은 PNG를 지정한다. 모든 화면 크기나 OS 버전에서 동일한 시작 이미지를 보장하지 않는다. 어두운 디자인 원본은 함께 제공하지만 iOS 시작 이미지 링크는 밝은 버전이며, 앱 HTML의 첫 화면은 OS의 밝은/어두운 설정을 따른다. 앱을 연 뒤 테마를 바꾸면 `theme-color`도 업데이트된다. [Apple 웹 앱 설정 문서](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).

Android 브라우저 메뉴에서 앱 설치/홈 화면에 추가, iPhone Safari 공유 메뉴에서 홈 화면에 추가를 사용한다. 메뉴와 지원은 브라우저에 따라 달라진다. HTTPS Vercel URL을 실기기에서 설치한 뒤 확인해야 한다. 로컬 HTTP 주소에서 테스트한 자동화 결과로 실기기 설치 완료를 주장하지 않는다.

## 저장과 오프라인 범위

이번 변경은 홈 화면 설치를 위한 메타데이터와 아이콘·시작 화면이다. Service Worker를 등록하거나 Cache Storage에 앱/건강 데이터를 저장하지 않는다. 인터넷 없는 새 실행은 지원 범위가 아니다. 브라우저 메뉴의 설치와 오프라인 지원은 별개이며 자동 설치 제안창도 보장하지 않는다. [Chrome의 메뉴 설치 조건 변경](https://developer.chrome.com/blog/update-install-criteria).

v0.3은 기본 메모리 전용이며 사용자가 선택하면 정규화된 러닝을 IndexedDB에 보관한다. 보관한 기록은 새로고침 후 복원하며, 보관하지 않은 기록은 ZIP을 다시 선택한다. 원본 ZIP은 저장하지 않는다. 테마와 그래프 보기 설정만 localStorage에 남는다. GPS, 원본 기록을 포함하는 설치 스크린샷, 외부 폰트·텔레메트리는 추가하지 않았다.

## 확인한 범위

production build, 기존 Vitest 28개, Playwright 10개 통과. 모바일 Chromium/WebKit에서 매니페스트 MIME·JSON, Chromium 매니페스트 파싱, 아이콘 실제 PNG 해상도, maskable 불투명도, 모든 Apple 시작 이미지의 크기·조건 일치, JS 실행 전 시작 화면과 두 색상 모드, 테마 색 변경, 320px 가로 넘침을 검사했다. 합성 ZIP 분석 뒤 Service Worker·Cache Storage가 비어 있고 localStorage에 보기 설정만 있는 것도 확인했다.

실제 휴대폰의 설치 메뉴·OS 스플래시·다시 열기·세로/가로 전환과 Vercel HTTPS 배포는 아직 검증 전이다.
