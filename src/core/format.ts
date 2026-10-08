export const num = (n: number | null, digits = 0) =>
  n === null
    ? "—"
    : n.toLocaleString("ko-KR", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
export function pace(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—";
  const v = Math.round(n);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
}
export function elapsed(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec) % 60).padStart(2, "0")}`;
}
export function duration(ms: number | null) {
  if (ms === null) return "—";
  if (ms < 60000) return `${Math.round(ms / 1000)}초`;
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min}분`;
}
export function issueLabel(code: string) {
  if (code.startsWith("duplicate-points:")) return "중복 시각을 병합했습니다";
  if (code.startsWith("invalid-points:"))
    return "잘못된 상세 표본을 제외했습니다";
  if (code.startsWith("alias-conflict:")) return "같은 필드의 값이 충돌합니다";
  return (
    (
      {
        "offset-unknown": "시간대 정보 없음 · UTC 날짜",
        "conflicting-points": "중복 표본의 충돌값은 제외했습니다",
        "size-limit": "상세 크기 제한",
        "detail-invalid": "상세 형식 또는 파일 오류",
        "ambiguous-reference": "여러 상세 파일이 같은 이름을 사용합니다",
        "invalid-reference": "지원하지 않는 상세 파일 참조",
        "session-conflict": "중복 기록에 값 차이가 있습니다",
        "short-record": "짧은 기록 · 기본 추세 제외",
        "duration-conflict": "요약 운동시간 확인 필요",
        "summary-pace-review": "요약 시간·거리 비율 확인 필요",
        "summary-detail-speed": "요약·상세 속도 불일치",
        "observation-gap": "관측 공백 있음",
      } as Record<string, string>
    )[code] ?? "데이터 품질 확인 필요"
  );
}
