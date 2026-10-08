import { median } from "./parser";
import type {
  Detail,
  Drift,
  Observation,
  Pair,
  Profile,
  Summary,
} from "./types";
export function aggregate(sessions: Summary[], profiles: Profile[]) {
  const paired = sessions.filter(
    (s) =>
      s.durationMs !== null &&
      s.durationMs > 0 &&
      s.distanceM !== null &&
      s.distanceM > 0,
  );
  const duration = paired.reduce((sum, s) => sum + s.durationMs!, 0),
    distance = paired.reduce((sum, s) => sum + s.distanceM!, 0);
  const own = new Set(sessions.map((s) => s.id));
  const ps = profiles.filter((p) => own.has(p.id));
  const hrSec = ps.reduce((sum, p) => sum + p.hrSec, 0);
  const max = sessions
    .map((s) => s.maxHr)
    .filter((x): x is number => x !== null);
  const fallback = ps
    .map((p) => p.maxHr)
    .filter((x): x is number => x !== null);
  return {
    count: sessions.length,
    distanceM: sessions.some((s) => s.distanceM !== null)
      ? sessions.reduce((sum, s) => sum + (s.distanceM ?? 0), 0)
      : null,
    distanceMissing: sessions.filter((s) => s.distanceM === null).length,
    durationMs: sessions.some((s) => s.durationMs !== null)
      ? sessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
      : null,
    durationMissing: sessions.filter((s) => s.durationMs === null).length,
    pace: distance > 0 ? duration / distance : null,
    medianPace: median(paired.map((s) => s.durationMs! / s.distanceM!)),
    meanHr: hrSec > 0 ? ps.reduce((sum, p) => sum + p.hrSum, 0) / hrSec : null,
    maxHr: max.length
      ? Math.max(...max)
      : fallback.length
        ? Math.max(...fallback)
        : null,
    hrSec,
    hrSessions: ps.filter((p) => p.hrSec > 0).length,
    paceSessions: paired.length,
    maxSource: max.length
      ? "CSV 요약"
      : fallback.length
        ? "상세 관측"
        : "관측 없음",
  };
}
export function observedStats(detail: Detail, from = 0, to = Infinity) {
  let hrSum = 0,
    hrSec = 0,
    speedSum = 0,
    speedSec = 0,
    cadSum = 0,
    cadSec = 0;
  let maxHr: number | null = null;
  let samples = 0;
  for (let i = 0; i < detail.points.length; i++) {
    const p = detail.points[i];
    if (p.time < from || p.time > to) continue;
    samples++;
    if (p.hr !== null) maxHr = Math.max(maxHr ?? 0, p.hr);
    const next = detail.points[i + 1];
    if (!next) continue;
    const delta = next.time - p.time;
    if (delta <= 0 || delta > detail.gapSec) continue;
    const w = Math.max(0, Math.min(next.time, to) - Math.max(p.time, from));
    // Both endpoints must be observed; no extending through a missing endpoint.
    if (p.hr !== null && next.hr !== null) {
      hrSum += p.hr * w;
      hrSec += w;
    }
    if (p.speed !== null && next.speed !== null) {
      speedSum += p.speed * w;
      speedSec += w;
    }
    if (p.cadence !== null && next.cadence !== null) {
      cadSum += p.cadence * w;
      cadSec += w;
    }
  }
  const extent = Math.max(
    0,
    Math.min(to, detail.points.at(-1)?.time ?? 0) -
      Math.max(from, detail.points[0]?.time ?? 0),
  );
  return {
    hrSum,
    hrSec,
    maxHr,
    samples,
    meanHr: hrSec ? hrSum / hrSec : null,
    meanSpeed: speedSec ? speedSum / speedSec : null,
    meanCadence: cadSec ? cadSum / cadSec : null,
    coverage: extent ? hrSec / extent : 0,
  };
}
export function movement(
  speed: number | null,
): "정지 추정" | "걷기 추정" | "달리기 추정" | "미측정" {
  return speed === null
    ? "미측정"
    : speed < 0.3
      ? "정지 추정"
      : speed < 1.8
        ? "걷기 추정"
        : "달리기 추정";
}
export function pairedSamples(detail: Detail): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < detail.points.length - 1; i++) {
    const p = detail.points[i],
      next = detail.points[i + 1],
      delta = next.time - p.time;
    if (
      p.time < 300 ||
      p.hr === null ||
      p.speed === null ||
      p.speed < 1.8 ||
      p.pace === null ||
      next.hr === null ||
      next.speed === null ||
      next.speed < 1.8 ||
      delta <= 0 ||
      delta > detail.gapSec ||
      Math.abs(next.speed - p.speed) / p.speed > 0.2
    )
      continue;
    pairs.push({
      time: p.time,
      hr: p.hr,
      speed: p.speed,
      pace: p.pace,
      weight: delta,
    });
  }
  return pairs;
}
function weighted(pairs: Pair[]) {
  const sec = pairs.reduce((s, p) => s + p.weight, 0);
  return sec
    ? {
        sec,
        hr: pairs.reduce((s, p) => s + p.hr * p.weight, 0) / sec,
        speed: pairs.reduce((s, p) => s + p.speed * p.weight, 0) / sec,
      }
    : null;
}
export function driftAnalysis(detail: Detail, pairs: Pair[]): Drift | null {
  // Find the longest continuous run of eligible pairs. Do not bridge excluded windows.
  const segments: Pair[][] = [];
  for (const p of pairs) {
    const last = segments.at(-1)?.at(-1);
    if (!last || Math.abs(p.time - (last.time + last.weight)) > 0.01)
      segments.push([]);
    segments.at(-1)!.push(p);
  }
  const eligible = segments
    .filter((s) => s.at(-1)!.time + s.at(-1)!.weight - s[0].time >= 1200)
    .sort(
      (a, b) =>
        b.at(-1)!.time +
        b.at(-1)!.weight -
        b[0].time -
        (a.at(-1)!.time + a.at(-1)!.weight - a[0].time),
    );
  for (const seg of eligible) {
    const from = seg[0].time,
      to = seg.at(-1)!.time + seg.at(-1)!.weight,
      mid = (from + to) / 2;
    const a = weighted(
        seg.flatMap((p) => {
          const weight = Math.max(0, Math.min(p.time + p.weight, mid) - p.time);
          return weight ? [{ ...p, weight }] : [];
        }),
      ),
      b = weighted(
        seg.flatMap((p) => {
          const weight = Math.max(0, p.time + p.weight - Math.max(p.time, mid));
          return weight ? [{ ...p, weight }] : [];
        }),
      );
    if (
      !a ||
      !b ||
      a.hr <= 0 ||
      b.hr <= 0 ||
      Math.abs(b.speed - a.speed) / a.speed > 0.05
    )
      continue;
    const coverage = (a.sec + b.sec) / (to - from);
    if (coverage < 0.8) continue;
    const e1 = a.speed / a.hr,
      e2 = b.speed / b.hr;
    return {
      percent: (100 * (e1 - e2)) / e1,
      efficiency:
        (a.speed * a.sec + b.speed * b.sec) /
        (a.sec + b.sec) /
        ((a.hr * a.sec + b.hr * b.sec) / (a.sec + b.sec)),
      from,
      to,
      samples: seg.length,
      coverage,
    };
  }
  void detail;
  return null;
}
export function observations(
  detail: Detail,
  threshold?: number,
): Observation[] {
  const out: Observation[] = [];
  const points = detail.points;
  const limit =
    "센서·측정 간격·운동 조건의 영향을 받습니다. 질환이나 위험을 판정하는 결과가 아닙니다.";
  let highFrom: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      prev = points[i - 1];
    const continuous = prev && p.time - prev.time <= detail.gapSec;
    if (
      prev &&
      continuous &&
      p.hr !== null &&
      prev.hr !== null &&
      p.time > prev.time &&
      p.time - prev.time <= 30 &&
      Math.abs(p.hr - prev.hr) >= 20
    )
      out.push({
        kind: "change",
        title: "짧은 시간의 심박 변화",
        from: prev.time,
        to: p.time,
        evidence: `${Math.round(p.time - prev.time)}초 동안 ${Math.round(p.hr - prev.hr) > 0 ? "+" : ""}${Math.round(p.hr - prev.hr)} bpm (${Math.round(prev.hr)} → ${Math.round(p.hr)})`,
        limit,
      });
    if (threshold !== undefined) {
      const high = p.hr !== null && p.hr >= threshold;
      if (high && highFrom === null) highFrom = p.time;
      if (
        highFrom !== null &&
        (!high || !continuous || i === points.length - 1)
      ) {
        const end = high && continuous ? p.time : (prev?.time ?? p.time);
        if (end - highFrom >= 60)
          out.push({
            kind: "threshold",
            title: "설정한 심박 이상 구간",
            from: highFrom,
            to: end,
            evidence: `${threshold} bpm 이상 · ${Math.round(end - highFrom)}초 관측`,
            limit,
          });
        highFrom = high ? p.time : null;
      }
    }
  }
  // Rolling windows require 30 pairs, at least 3 minutes, continuous observations.
  for (let start = 0; start < points.length; start += 15) {
    const window = points.slice(start, start + 30);
    if (
      window.length < 30 ||
      window.at(-1)!.time - window[0].time < 180 ||
      window.some(
        (p, i) =>
          p.hr === null ||
          p.cadence === null ||
          p.cadence <= 0 ||
          (i > 0 && p.time - window[i - 1].time > detail.gapSec),
      )
    )
      continue;
    const x = window.map((p) => p.hr!),
      y = window.map((p) => p.cadence!),
      mx = x.reduce((a, b) => a + b, 0) / 30,
      my = y.reduce((a, b) => a + b, 0) / 30;
    const vx = x.reduce((sum, v) => sum + (v - mx) ** 2, 0),
      vy = y.reduce((sum, v) => sum + (v - my) ** 2, 0);
    if (vx === 0 || vy === 0) continue;
    const r =
      x.reduce((sum, v, i) => sum + (v - mx) * (y[i] - my), 0) /
      Math.sqrt(vx * vy);
    const diff = median(x.map((v, i) => Math.abs(v - y[i])))!;
    if (r >= 0.8 && diff <= 10) {
      out.push({
        kind: "similarity",
        title: "심박과 케이던스의 유사한 변화",
        from: window[0].time,
        to: window.at(-1)!.time,
        evidence: `동시 표본 30개 · 상관 ${r.toFixed(2)} · 차이 중앙값 ${diff.toFixed(1)}`,
        limit:
          "두 원본 수치의 유사성입니다. 센서 간섭이나 cadence lock을 확정하지 않습니다.",
      });
      break;
    }
  }
  // Compare measured windows around a slowing event; not post-exercise HRR.
  const lower = (time: number) => {
    let lo = 0,
      hi = points.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (points[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let lastCandidate = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].time;
    if (t < 360 || t - lastCandidate < 10) continue;
    lastCandidate = t;
    const bounds = [lower(t - 60), i, lower(t + 60), lower(t + 120)];
    if (bounds[3] - bounds[0] > 6000) continue;
    const windows = [
      points.slice(bounds[0], bounds[1]),
      points.slice(bounds[1], bounds[2]),
      points.slice(bounds[2], bounds[3]),
    ];
    if (
      windows.some(
        (w) =>
          w.length < 4 ||
          w.at(-1)!.time - w[0].time < 40 ||
          w.some(
            (p, j) =>
              p.hr === null ||
              p.speed === null ||
              (j > 0 && p.time - w[j - 1].time > detail.gapSec),
          ),
      )
    )
      continue;
    const all = windows.flat();
    if (all.some((p, j) => j > 0 && p.time - all[j - 1].time > detail.gapSec))
      continue;
    const speeds = windows.map((w) => median(w.map((p) => p.speed!))!),
      hrs = windows.map((w) => median(w.map((p) => p.hr!))!);
    if (speeds[0] > 1.8 && speeds[1] <= speeds[0] * 0.8) {
      out.push({
        kind: "slowing",
        title: "감속 뒤 관측한 심박 변화",
        from: t - 60,
        to: t + 120,
        evidence: `속도 중앙값 ${speeds[0].toFixed(1)} → ${speeds[1].toFixed(1)} m/s · 이후 심박 ${Math.round(hrs[1])} → ${Math.round(hrs[2])} bpm`,
        limit:
          "러닝 중 60초 창의 관측값 비교입니다. 운동 종료 후 회복심박(HRR)이 아닙니다.",
      });
      break;
    }
  }
  return out;
}
export function profile(detail: Detail): Profile {
  const stats = observedStats(detail),
    pairs = pairedSamples(detail);
  const bins = new Map<
    number,
    { pace: number; hrs: number[]; sec: number; possibleSec: number }
  >();
  // One-second bins support exact integer-second pace bands without shipping raw timelines.
  for (let i = 0; i < detail.points.length - 1; i++) {
    const p = detail.points[i],
      n = detail.points[i + 1],
      delta = n.time - p.time;
    if (
      p.time < 300 ||
      p.pace === null ||
      p.speed === null ||
      p.speed < 1.8 ||
      delta <= 0 ||
      delta > detail.gapSec
    )
      continue;
    const key = Math.floor(p.pace);
    if (!bins.has(key))
      bins.set(key, { pace: key, hrs: [], sec: 0, possibleSec: 0 });
    bins.get(key)!.possibleSec += delta;
  }
  for (const p of pairs) {
    const bin = bins.get(Math.floor(p.pace))!;
    bin.hrs.push(p.hr);
    bin.sec += p.weight;
  }
  return {
    id: detail.id,
    hrSum: stats.hrSum,
    hrSec: stats.hrSec,
    maxHr: stats.maxHr,
    bins: [...bins.values()],
    pairCount: pairs.length,
    observations: observations(detail),
    drift: driftAnalysis(detail, pairs),
  };
}
export function growthRows(
  sessions: Summary[],
  profiles: Profile[],
  center: number,
  width = 15,
) {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return sessions
    .map((s) => {
      const bins =
          byId
            .get(s.id)
            ?.bins.filter(
              (b) => b.pace >= center - width && b.pace < center + width,
            ) ?? [],
        hrs = bins.flatMap((b) => b.hrs),
        sec = bins.reduce((sum, b) => sum + b.sec, 0),
        possible = bins.reduce((sum, b) => sum + b.possibleSec, 0),
        coverage = possible ? sec / possible : 0;
      return {
        id: s.id,
        date: s.date,
        hr: median(hrs),
        samples: hrs.length,
        sec,
        coverage,
        eligible: hrs.length >= 20 && sec >= 180 && coverage >= 0.7,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function periodGrowth(
  rows: ReturnType<typeof growthRows>,
  period: "week" | "month",
) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows.filter((r) => r.eligible)) {
    let key = row.date.slice(0, 7);
    if (period === "week") {
      const d = new Date(row.date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = d.toISOString().slice(0, 10);
    }
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({
      date,
      hr: median(group.map((r) => r.hr!)),
      sessions: group.length,
      samples: group.reduce((sum, r) => sum + r.samples, 0),
      eligible: group.length >= 3,
    }));
}
export function baselineObservations(rows: ReturnType<typeof growthRows>) {
  const eligible = rows.filter((r) => r.eligible && r.hr !== null);
  return eligible.flatMap((r, i) => {
    const prev = eligible.slice(0, i).slice(-10);
    if (prev.length < 5) return [];
    const base = median(prev.map((x) => x.hr!))!,
      mad = median(prev.map((x) => Math.abs(x.hr! - base)))!;
    if (mad === 0 || Math.abs(r.hr! - base) <= 3 * 1.4826 * mad) return [];
    return [
      {
        id: r.id,
        date: r.date,
        hr: r.hr!,
        base,
        count: prev.length,
        samples: r.samples,
      },
    ];
  });
}

export function movementSegments(detail: Detail) {
  const segments: {
    from: number;
    to: number;
    state: ReturnType<typeof movement>;
  }[] = [];
  for (let i = 0; i < detail.points.length - 1; i++) {
    const p = detail.points[i],
      next = detail.points[i + 1];
    if (next.time - p.time > detail.gapSec || next.time <= p.time) continue;
    const state =
      p.speed === null || next.speed === null ? "미측정" : movement(p.speed);
    const last = segments.at(-1);
    if (last && last.to === p.time && last.state === state) last.to = next.time;
    else segments.push({ from: p.time, to: next.time, state });
  }
  return segments.map((s) =>
    s.to - s.from < 30 ? { ...s, state: "미측정" as const } : s,
  );
}
