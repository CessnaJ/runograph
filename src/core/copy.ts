// Shared wording for the same question and source across screens.
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
