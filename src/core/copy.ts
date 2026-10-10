// Shared wording for the same question and source across screens.
export const APPLE_NOTICE =
  "애플 건강 지원은 시험 단계예요. 현재 러닝 요약만 지원하며, 실제 기기의 내보내기 파일은 아직 검증하지 못했어요.";
export const APPLE_DETAIL_NOTICE =
  "애플 건강의 시간별 그래프·전후반·구간 비교는 아직 지원하지 않아요. 현재는 러닝 요약만 지원해요.";
export const GROWTH_QUESTIONS = {
  heart: "비슷한 페이스에서 심박이 달라졌나요?",
  pace: "비슷한 심박에서 더 빨라졌나요?",
  duration: "한 번에 더 오래 달렸나요?",
  halves: "후반에도 페이스를 유지했나요?",
  habit: "얼마나 꾸준히 달렸나요?",
};
export function deviceLabel(group?: string) {
  return !group || group === "출처 미상" ? "기기 정보 없음" : group;
}
export function sourceLabel(source?: "samsung" | "apple") {
  return source === "apple" ? "애플 건강" : "삼성헬스";
}
