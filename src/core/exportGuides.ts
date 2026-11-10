import { APPLE_NOTICE } from "./copy";

export type ExportApp = "samsung" | "apple" | "strava" | "nike";
export type ExportPhone = "iphone" | "galaxy";

export type ExportGuide = {
  name: string;
  hint: string;
  steps: string[];
  file: string;
  note: string;
  link: { label: string; href: string };
};

export const PHONE_APPS: Record<ExportPhone, ExportApp[]> = {
  iphone: ["apple", "strava", "nike"],
  galaxy: ["samsung", "strava", "nike"],
};

export const EXPORT_GUIDES: Record<ExportApp, ExportGuide> = {
  samsung: {
    name: "삼성헬스",
    hint: "개인 데이터 ZIP",
    steps: [
      "삼성헬스 앱을 열고 더 보기(⋮) → 설정으로 이동하세요.",
      "‘개인 데이터 다운로드’를 선택하고 ‘다운로드’를 누르세요. 필요한 경우 삼성 계정으로 본인 확인을 해주세요.",
      "다운로드가 끝나면 ‘내 파일’ 앱에서 안내된 저장 위치 또는 다운로드 폴더를 확인하세요.",
      "받은 ZIP 파일을 아래에서 선택하세요. 폴더로 저장됐다면 폴더 전체를 ZIP으로 압축해 주세요.",
    ],
    file: "삼성헬스에서 내려받은 ZIP · 압축을 풀지 않고 선택",
    note: "메뉴 이름과 저장 위치는 삼성헬스 버전에 따라 달라질 수 있어요.",
    link: {
      label: "삼성 공식 내보내기 안내",
      href: "https://www.samsung.com/us/support/answer/ANS10001379/",
    },
  },
  apple: {
    name: "애플 건강",
    hint: "ZIP · XML / 요약 시험 지원",
    steps: [
      "아이폰의 ‘건강’ 앱을 열어 ‘요약’ 탭으로 이동하세요.",
      "오른쪽 위 프로필 사진이나 이니셜을 누르세요.",
      "‘모든 건강 데이터 내보내기’를 누른 뒤 내보내기가 끝날 때까지 기다려 주세요.",
      "공유 메뉴에서 ‘파일에 저장’을 선택하고, 저장한 ZIP 파일을 아래에서 선택하세요. 압축 안의 export.xml도 불러올 수 있어요.",
    ],
    file: "건강 앱의 ZIP 또는 export.xml · 러닝 요약 지원",
    note: APPLE_NOTICE,
    link: {
      label: "Apple 공식 내보내기 안내",
      href: "https://support.apple.com/guide/iphone/iph5ede58c3d/ios",
    },
  },
  strava: {
    name: "Strava",
    hint: "전체 ZIP · 개별 운동 파일",
    steps: [
      "휴대폰이나 컴퓨터의 웹 브라우저에서 Strava.com에 로그인하세요. 내보내기는 Strava 웹사이트에서 제공해요.",
      "전체 기록: 설정(Settings) → 내 계정(My Account) → 계정 다운로드(Download your account) → 시작(Get Started)으로 이동하세요.",
      "‘다운로드 요청(Request download)’을 누르고, Strava가 이메일로 보낸 링크에서 ZIP을 내려받으세요.",
      "한 기록만 보려면 웹사이트의 해당 활동에서 더 보기(⋯) → ‘원본 내보내기(Export Original)’를 선택하세요. 받은 ZIP이나 운동 파일을 아래에서 선택하면 돼요.",
    ],
    file: "Strava 전체 ZIP 또는 FIT·TCX·GPX · .gz 압축도 지원",
    note: "전체 기록은 이메일이 도착할 때까지 시간이 걸릴 수 있어요. 원본 파일을 권장하며, 기록에 심박이나 시간별 데이터가 없으면 해당 분석은 표시하지 않아요.",
    link: {
      label: "Strava 공식 내보내기 안내",
      href: "https://support.strava.com/en-us/articles/15401919-how-do-i-export-my-strava-data",
    },
  },
  nike: {
    name: "Nike Run Club",
    hint: "개인정보 사본 요청",
    steps: [
      "아래 ‘Nike 공식 데이터 요청’을 열어 Nike 개인정보 문의 양식으로 이동하세요.",
      "Nike 계정에 사용하는 이름과 이메일을 입력하고, 데이터 내보내기 요청에 해당하는 항목을 선택하세요.",
      "설명에 ‘Nike Run Club의 전체 러닝 기록 사본을 내보내기 파일로 받고 싶다’고 적어 제출하세요. 운동별 TCX 또는 GPX 파일도 요청할 수 있어요.",
      "Nike의 본인 확인과 회신 안내에 따라 파일을 내려받은 뒤, 지원하는 운동 파일이나 ZIP을 아래에서 선택하세요.",
    ],
    file: "TCX·GPX·FIT · 활동 metrics·summaries가 있는 JSON · 해당 ZIP",
    note: "Nike JSON은 확인 가능한 활동 구조만 지원하며 모든 버전의 호환을 보장하지 않아요. 제공되는 파일 형식과 처리 시간은 Nike의 답변에 따라 달라져요. PDF·HTML만 들어 있으면 러닝 분석을 불러올 수 없어요.",
    link: {
      label: "Nike 공식 데이터 요청",
      href: "https://www.nike.com/help/privacy",
    },
  },
};
