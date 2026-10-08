export interface Summary {
  id: string;
  startMs: number;
  endMs: number | null;
  offsetMs: number | null;
  date: string;
  durationMs: number | null;
  distanceM: number | null;
  meanHr: number | null;
  maxHr: number | null;
  meanCadence: number | null;
  status: "pending" | "ready" | "missing" | "invalid" | "limited";
  issues: string[];
}
export interface InternalSummary extends Summary {
  reference: string | null;
  uuid: string | null;
  updatedMs: number | null;
}
export interface Point {
  time: number;
  epochMs: number;
  hr: number | null;
  speed: number | null;
  pace: number | null;
  cadence: number | null;
  distance: number | null;
}
export interface Detail {
  id: string;
  points: Point[];
  gapSec: number;
  distanceSemantics: "interval" | "cumulative" | "unknown";
  issues: string[];
}
export interface Weighted {
  hrSum: number;
  hrSec: number;
  maxHr: number | null;
}
export interface Pair {
  time: number;
  hr: number;
  speed: number;
  pace: number;
  weight: number;
}
export interface PaceBin {
  pace: number;
  hrs: number[];
  sec: number;
  possibleSec: number;
}
export interface Observation {
  kind: string;
  title: string;
  from: number;
  to: number;
  evidence: string;
  limit: string;
}
export interface Drift {
  percent: number;
  efficiency: number;
  from: number;
  to: number;
  samples: number;
  coverage: number;
}
export interface Profile extends Weighted {
  id: string;
  bins: PaceBin[];
  pairCount: number;
  observations: Observation[];
  drift: Drift | null;
}
export interface Dataset {
  sessions: Summary[];
  profiles: Profile[];
  warnings: string[];
}
export type WorkerRequest =
  | { type: "IMPORT"; requestId: number; file: File }
  | { type: "DETAIL"; requestId: number; id: string };
export type WorkerResponse =
  | { type: "PROGRESS"; requestId: number; phase: string; percent: number }
  | { type: "DATA"; requestId: number; data: Dataset }
  | { type: "DETAIL"; requestId: number; detail: Detail }
  | { type: "ERROR"; requestId: number; message: string };
