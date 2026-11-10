import { intervals, primaryRange } from "./analysis";
import { num } from "./format";
import type { Detail, Profile } from "./types";

export function changeText(value: number, unit: "bpm" | "초/km") {
  const rounded = Math.round(Math.abs(value));
  if (!rounded)
    return unit === "bpm" ? "심박은 비슷했어요" : "페이스는 비슷했어요";
  return unit === "bpm"
    ? `심박은 ${num(rounded)} bpm ${value < 0 ? "낮았어요" : "높았어요"}`
    : `페이스는 ${num(rounded)}초/km ${value < 0 ? "빨랐어요" : "느렸어요"}`;
}

export function recap(halves: Profile["halves"]) {
  if (!halves || halves.first.speed <= 0 || halves.last.speed <= 0) return null;
  return {
    pace: changeText(
      1000 / halves.last.speed - 1000 / halves.first.speed,
      "초/km",
    ),
    heart: changeText(halves.last.hr - halves.first.hr, "bpm"),
  };
}

// Both metrics use the same observed intervals. Missing time stays in the denominator.
export function pairedStats(detail: Detail, from: number, to: number) {
  const valid = intervals(detail, from, to).filter(
    (v) => v.hr !== null && v.speed !== null,
  );
  const sec = valid.reduce((sum, v) => sum + v.sec, 0);
  const coverage = to > from ? sec / (to - from) : 0;
  const speed = sec
    ? valid.reduce((sum, v) => sum + v.speed! * v.sec, 0) / sec
    : 0;
  return {
    sec,
    coverage,
    hr:
      coverage >= 0.7 && sec > 0
        ? valid.reduce((sum, v) => sum + v.hr! * v.sec, 0) / sec
        : null,
    pace: coverage >= 0.7 && speed > 0 ? 1000 / speed : null,
  };
}

function commonStats(current: Detail, previous: Detail, from: number, to: number) {
  const observed = (d: Detail) => intervals(d, from, to).filter(
    (v) => v.hr !== null && v.speed !== null,
  );
  const a = observed(current), b = observed(previous);
  let i = 0, j = 0, sec = 0, currentHr = 0, previousHr = 0,
    currentSpeed = 0, previousSpeed = 0;
  while (i < a.length && j < b.length) {
    const x = a[i], y = b[j];
    const overlap = Math.max(0, Math.min(x.to, y.to) - Math.max(x.from, y.from));
    if (overlap) {
      sec += overlap;
      currentHr += x.hr! * overlap;
      previousHr += y.hr! * overlap;
      currentSpeed += x.speed! * overlap;
      previousSpeed += y.speed! * overlap;
    }
    if (x.to <= y.to) i++;
    if (y.to <= x.to) j++;
  }
  const coverage = to > from ? sec / (to - from) : 0;
  const result = (hr: number, speed: number) => ({
    sec, coverage,
    hr: coverage >= 0.7 && sec > 0 ? hr / sec : null,
    pace: coverage >= 0.7 && speed > 0 ? 1000 * sec / speed : null,
  });
  return { current: result(currentHr, currentSpeed), previous: result(previousHr, previousSpeed) };
}

export function runPair(current: Detail, previous: Detail) {
  const a = primaryRange(current),
    b = primaryRange(previous);
  const from = Math.max(300, a[0], b[0]);
  const to = Math.min(a[1], b[1], from + 900);
  if (to - from < 300) return null;
  const common = commonStats(current, previous, from, to);
  const rows = [];
  for (let start = from; start < to; start += 60) {
    const end = Math.min(start + 60, to);
    const { current: a, previous: b } = commonStats(current, previous, start, end);
    rows.push({
      time: start,
      currentHr: a.hr,
      previousHr: b.hr,
      currentPace: a.pace,
      previousPace: b.pace,
    });
  }
  return { from, to, ...common, rows };
}
