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
  if (code.startsWith("duplicate-points:"))
    return "같은 시각의 측정값을 합쳤어요";
  if (code.startsWith("invalid-points:")) return "읽을 수 없는 측정값을 뺐어요";
  if (code.startsWith("alias-conflict:"))
    return "같은 항목에 서로 다른 값이 있어요";
  return (
    (
      {
        "offset-unknown": "시간대 정보 없음 · UTC 날짜로 표시",
        "conflicting-points": "같은 시각에 서로 다른 값이 있어 계산에서 뺐어요",
        "size-limit": "측정 파일이 너무 커요",
        "detail-invalid": "시간별 측정 파일을 읽지 못했어요",
        "ambiguous-reference": "같은 이름의 측정 파일이 여러 개 있어요",
        "invalid-reference": "연결된 측정 파일을 찾을 수 없어요",
        "session-conflict": "중복된 기록에 서로 다른 값이 있어요",
        "short-record": "1분 미만 · 기본 계산에서 제외",
        "duration-conflict": "저장된 운동시간 확인 필요",
        "summary-pace-review": "저장된 시간·거리 확인 필요",
        "summary-detail-speed": "저장된 요약과 시간별 속도가 달라요",
        "observation-gap": "측정이 끊긴 구간 있음",
      } as Record<string, string>
    )[code] ?? "확인할 기록이 있어요"
  );
}
