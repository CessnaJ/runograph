import type { RunReview } from "./runReview";
import type { AutoDiscovery } from "./discovery";

export type ImportSource = "samsung" | "apple" | "strava" | "nike" | "activity";

export interface Summary {
  id: string;
  source?: ImportSource;
  detailAvailable?: boolean;
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
  deviceGroup?: string;
  quality?: QualityIssue[];
  inclusion?: "default" | "include" | "exclude";
  growthExcluded?: boolean;
}
export interface QualityIssue {
  code: string;
  metrics: ("duration" | "distance" | "pace" | "date" | "detail")[];
  evidence: string;
  action: "review" | "unavailable" | "notice";
  from?: number;
  to?: number;
}
export interface StableWindow {
  from: number;
  to: number;
  hr: number;
  speed: number;
  sec: number;
  samples: number;
  cv: number;
}
export interface EvidenceRef {
  id: string;
  from: number;
  to: number;
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
  windows?: StableWindow[];
  stabilityVariants?: {
    context: number;
    cv: number;
    windows: StableWindow[];
  }[];
  review?: RunReview;
  windowDiagnostics?: Record<string, number>;
  longestRunSec?: number;
  halves?: {
    from: number;
    to: number;
    first: { hr: number; speed: number; sec: number; coverage: number };
    last: { hr: number; speed: number; sec: number; coverage: number };
    speedDifference: number;
  } | null;
}
export interface Dataset {
  source?: ImportSource;
  sessions: Summary[];
  profiles: Profile[];
  warnings: string[];
  revision?: number;
  discoveries?: { heart: AutoDiscovery; pace: AutoDiscovery };
}
export type WorkerRequest =
  | { type: "IMPORT"; requestId: number; file: File }
  | { type: "PAIR"; requestId: number; ids: [string, string] }
  | { type: "SAVE"; requestId: number; generation: string }
  | { type: "DETAIL"; requestId: number; id: string };
export type WorkerResponse =
  | { type: "PROGRESS"; requestId: number; phase: string; percent: number }
  | { type: "DATA"; requestId: number; data: Dataset }
  | { type: "DETAIL"; requestId: number; detail: Detail }
  | { type: "PAIR"; requestId: number; details: [Detail, Detail] }
  | { type: "SAVE_PROGRESS"; requestId: number; count: number; total: number }
  | { type: "SAVED"; requestId: number; generation: string }
  | { type: "ERROR"; requestId: number; message: string };
