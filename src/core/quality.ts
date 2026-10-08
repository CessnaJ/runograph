import type { Detail, QualityIssue, Summary } from "./types";

export function qualityIssues(s: Summary, d?: Detail): QualityIssue[] {
  const out: QualityIssue[] = [];
  const review = (code: string, evidence: string) =>
    out.push({
      code,
      evidence,
      metrics: ["duration", "distance", "pace"],
      action: "review",
    });
  if (s.durationMs !== null && s.durationMs < 60000)
    review(
      "short-record",
      "1분 미만 기록은 기본 합계에서 제외해요. 분할 기록이면 직접 포함할 수 있어요.",
    );
  if (s.durationMs !== null && s.endMs !== null) {
    const wall = s.endMs - s.startMs;
    if (wall < 0 || s.durationMs - wall > Math.max(60000, wall * 0.05))
      review(
        "duration-conflict",
        "저장된 운동시간이 시작·종료 시각과 맞지 않아 시간·거리 합계에서 뺐어요.",
      );
  }
  if (
    s.durationMs !== null &&
    s.distanceM !== null &&
    s.distanceM > 0 &&
    s.durationMs / s.distanceM < 120
  )
    review(
      "summary-pace-review",
      "요약 페이스가 2:00/km보다 빨라 시간·거리 합계에서 제외해요. 원본을 확인해 주세요.",
    );
  if (s.offsetMs === null)
    out.push({
      code: "offset-unknown",
      metrics: ["date"],
      evidence:
        "시간대 정보가 없어 UTC 날짜로 보여드려요. 날짜별 비교에서는 제외해요.",
      action: "unavailable",
    });
  if (d) {
    const speeds = d.points.flatMap((p) => (p.speed === null ? [] : [p.speed]));
    const maxSpeed = speeds.reduce((a, b) => Math.max(a, b), 0);
    if (
      speeds.length >= 10 &&
      maxSpeed > 0 &&
      s.durationMs &&
      s.distanceM &&
      s.distanceM / (s.durationMs / 1000) > maxSpeed * 1.5
    )
      review(
        "summary-detail-speed",
        "요약 평균속도가 상세 최고속도의 1.5배를 넘어 합계에서 제외해요. 상세 측정이 운동 일부에만 있을 수도 있어요.",
      );
    for (let i = 1; i < d.points.length; i++)
      if (d.points[i].time - d.points[i - 1].time > d.gapSec) {
        out.push({
          code: "observation-gap",
          metrics: ["detail"],
          action: "unavailable",
          evidence:
            "측정이 끊긴 구간이에요. 그래프를 잇거나 계산할 값으로 채우지 않아요.",
          from: d.points[i - 1].time,
          to: d.points[i].time,
        });
      }
  }
  return out;
}
export function usesSummary(
  s: Summary,
  metric: "duration" | "distance" | "pace",
  raw = false,
) {
  if (raw) return true;
  if (s.inclusion === "exclude") return false;
  const codes = new Set([
    ...(s.quality ?? [])
      .filter((q) => q.metrics.includes(metric))
      .map((q) => q.code),
    ...s.issues.filter((c) =>
      [
        "short-record",
        "duration-conflict",
        "summary-pace-review",
        "summary-detail-speed",
      ].includes(c),
    ),
  ]);
  if (s.durationMs !== null && s.durationMs < 60000) codes.add("short-record");
  if (
    s.durationMs !== null &&
    s.distanceM !== null &&
    s.distanceM > 0 &&
    s.durationMs / s.distanceM < 120
  )
    codes.add("summary-pace-review");
  if (s.inclusion === "include") codes.delete("short-record");
  return codes.size === 0;
}
export function datedActivity(s: Summary) {
  return (
    s.offsetMs !== null &&
    usesSummary(s, "duration") &&
    usesSummary(s, "distance")
  );
}
export function summaryPace(s: Summary) {
  return usesSummary(s, "pace") &&
    s.durationMs !== null &&
    s.distanceM !== null &&
    s.distanceM > 0
    ? s.durationMs / s.distanceM
    : null;
}
