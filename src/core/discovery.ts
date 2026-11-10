import {
  compare,
  suggestComparison,
  type CompareConfig,
  type Comparison,
  type Question,
} from "./analysis";
import type { Profile, Summary } from "./types";

export interface AutoDiscovery {
  preferred: CompareConfig;
  alternative: Comparison | null;
  searched: number;
}

// Every ranking component describes inputs or support. Response values,
// differences and sensitivity directions must never influence the search.
function ranking(c: Comparison): number[] {
  const inputGaps = c.previous.phases.map((p, i) => {
    const n = c.recent.phases[i];
    if (p.input === null || n.input === null) return Infinity;
    return c.config.question === "heart"
      ? Math.abs(p.input - n.input) / (((p.input + n.input) / 2) * 0.01)
      : Math.abs(p.input - n.input) / 2;
  });
  const elapsedGaps = c.previous.phases.map((p, i) => {
    const n = c.recent.phases[i];
    return p.elapsed === null || n.elapsed === null
      ? Infinity
      : Math.abs(p.elapsed - n.elapsed) / 60;
  });
  return [
    c.baseState === "ready" ? 1 : 0,
    -Math.max(...inputGaps, ...elapsedGaps),
    Math.min(c.previous.effective, c.recent.effective),
    Math.min(
      ...c.previous.phases.map((p) => p.effective),
      ...c.recent.phases.map((p) => p.effective),
    ),
    Math.min(c.previous.count, c.recent.count),
    Math.min(c.previous.days, c.recent.days),
    Math.min(c.previous.sec, c.recent.sec),
    -c.config.days,
    -c.config.elapsedFrom,
  ];
}

function better(a: Comparison, b: Comparison) {
  const left = ranking(a),
    right = ranking(b);
  for (let i = 0; i < left.length; i++) {
    const delta = left[i] - right[i];
    if (Math.abs(delta) > 1e-8) return delta > 0;
  }
  return false;
}

function key(c: CompareConfig) {
  return JSON.stringify([
    c.question,
    c.days,
    c.anchor,
    c.target,
    c.device,
    c.phases,
    c.width,
    c.elapsedFrom,
    c.elapsedTo,
  ]);
}

/** A fixed, small search over cached minute windows, always ending at the latest known day. */
export function discoverComparison(
  sessions: Summary[],
  profiles: Profile[],
  question: Question = "heart",
  days = 28,
): AutoDiscovery {
  const preferred = suggestComparison(sessions, profiles, question, days),
    baseline = compare(sessions, profiles, preferred),
    checked = new Set([key(preferred)]);
  if (baseline.state === "ready")
    return { preferred, alternative: null, searched: 1 };
  let selected: Comparison | null = null;
  for (const span of [28, 56])
    for (const [from, to] of [
      [300, 1200],
      [600, 1200],
      [600, 1500],
    ]) {
      const cfg = suggestComparison(
        sessions,
        profiles,
        question,
        span,
        from,
        to,
        preferred.anchor,
      );
      const configKey = key(cfg);
      if (checked.has(configKey)) continue;
      checked.add(configKey);
      const candidate = compare(sessions, profiles, cfg, false);
      if (
        candidate.baseState !== "ready" &&
        candidate.baseState !== "reference"
      )
        continue;
      // A weaker reference is not an upgrade from a condition-matched ready
      // baseline. A sensitive baseline remains visible as the preferred result.
      if (baseline.baseState === "ready" && candidate.baseState !== "ready")
        continue;
      if (!selected || better(candidate, selected)) selected = candidate;
    }
  return {
    preferred,
    // Run the full sensitivity check only after the outcome-blind selection.
    alternative: selected ? compare(sessions, profiles, selected.config) : null,
    searched: checked.size,
  };
}
