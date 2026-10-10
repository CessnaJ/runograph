import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "./ui/button";
import { duration, elapsed, num, pace } from "../core/format";
import { changeText, runPair } from "../core/review";
import { APPLE_DETAIL_NOTICE } from "../core/copy";
import { summaryPace, usesSummary } from "../core/quality";
import type { Detail, EvidenceRef, Summary } from "../core/types";

export function RunComparison({
  sessions,
  ids,
  details,
  loading,
  error,
  onSelect,
  onOpen,
  onBack,
}: {
  sessions: Summary[];
  ids: [string, string];
  details: [Detail, Detail] | null;
  loading: boolean;
  error: string;
  onSelect: (ids: [string, string]) => void;
  onOpen: (id: string, focus?: EvidenceRef) => void;
  onBack: () => void;
}) {
  const pair = useMemo(() => (details ? runPair(...details) : null), [details]);
  const runs = ids.map((id) => sessions.find((s) => s.id === id));
  const summaryOnly = runs.some((s) => s?.source === "apple");
  const sorted = [...sessions].sort((a, b) => b.startMs - a.startMs);
  const usable =
    pair &&
    pair.current.hr !== null &&
    pair.previous.hr !== null &&
    pair.current.pace !== null &&
    pair.previous.pace !== null;
  return (
    <>
      <Button variant="ghost" className="back-button" onClick={onBack}>
        ← 요약으로 돌아가기
      </Button>
      <div className="page-heading compact-heading">
        <h1>두 러닝 나란히 보기</h1>
        <p className="subtle">같은 코스·비슷한 목적의 기록을 골라보세요.</p>
      </div>
      <div className="pair-selectors">
        {[0, 1].map((i) => (
          <label key={i}>
            {i === 0 ? "기준 러닝" : "비교할 러닝"}
            <select
              aria-label={i === 0 ? "기준 러닝" : "비교할 러닝"}
              value={ids[i]}
              onChange={(e) =>
                onSelect(
                  i === 0 ? [e.target.value, ids[1]] : [ids[0], e.target.value],
                )
              }
            >
              <option value="">러닝 선택</option>
              {sorted
                .filter((s) => s.id !== ids[1 - i])
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.date} ·{" "}
                    {new Date(s.startMs + (s.offsetMs ?? 0))
                      .toISOString()
                      .slice(11, 16)}{" "}
                    · {num(s.distanceM === null ? null : s.distanceM / 1000, 2)}{" "}
                    km
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      {!ids[0] || !ids[1] ? (
        <p className="empty-note">
          {sessions.some((s) => s.source === "apple")
            ? "두 기록을 고르면 전체 거리·운동시간·평균 페이스·요약 심박을 나란히 볼 수 있어요."
            : "두 기록을 고르면 같은 운동 경과시간의 심박과 페이스를 비교해요."}
        </p>
      ) : loading ? (
        <p role="status" className="loading-panel">
          두 러닝의 측정값을 읽고 있어요…
        </p>
      ) : summaryOnly ? (
        <section aria-label="두 러닝 요약 비교">
          <p className="fine">{APPLE_DETAIL_NOTICE}</p>
          <table className="pair-table">
            <caption>두 러닝의 전체 요약</caption>
            <thead>
              <tr>
                <th scope="col">항목</th>
                {runs.map((s) => (
                  <th key={s?.id} scope="col">
                    {s?.date}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  [
                    "거리",
                    (s: Summary) =>
                      `${num(s.distanceM === null || !usesSummary(s, "distance") ? null : s.distanceM / 1000, 2)} km`,
                  ],
                  [
                    "운동시간",
                    (s: Summary) =>
                      duration(
                        usesSummary(s, "duration") ? s.durationMs : null,
                      ),
                  ],
                  [
                    "평균 페이스",
                    (s: Summary) => `${pace(summaryPace(s))} /km`,
                  ],
                  ["요약 평균 심박", (s: Summary) => `${num(s.meanHr)} bpm`],
                  ["요약 최대 심박", (s: Summary) => `${num(s.maxHr)} bpm`],
                ] as const
              ).map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {runs.map((s) => (
                    <td key={s?.id}>{s ? value(s) : "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">
            전체 운동 요약이에요. 같은 구간·코스·강도를 비교한 값은 아니에요.
            없는 값이나 확인이 필요한 시간·거리는 —로 표시해요.
          </p>
          <div className="pair-actions">
            {runs.map(
              (s, i) =>
                s && (
                  <Button
                    key={s.id}
                    variant="outline"
                    onClick={() => onOpen(s.id)}
                  >
                    {i === 0 ? "기준" : "비교"} 러닝 요약 보기 →
                  </Button>
                ),
            )}
          </div>
        </section>
      ) : error ? (
        <p role="alert" className="empty-note">
          {error}
        </p>
      ) : details && !pair ? (
        <p className="empty-note">
          시작 5분 이후 두 기록에 공통으로 남는 구간이 5분보다 짧아요. 다른
          러닝을 골라보세요.
        </p>
      ) : (
        pair && (
          <>
            <section className="pair-answer" aria-label="두 러닝 비교 결과">
              <p className="recap-context">
                {runs[1]?.date} 기록에 비해 {runs[0]?.date} 기록은
              </p>
              {usable ? (
                <h2>
                  {changeText(
                    pair.current.pace! - pair.previous.pace!,
                    "초/km",
                  )}
                  .<br />
                  {changeText(pair.current.hr! - pair.previous.hr!, "bpm")}.
                </h2>
              ) : (
                <h2>이 구간에는 함께 측정된 심박·속도가 부족해요.</h2>
              )}
              <p className="subtle">
                두 러닝 모두 시작 후 {elapsed(pair.from)}–{elapsed(pair.to)}를
                비교했어요.
              </p>
              <p className="fine">
                같은 경과시간의 관측 비교예요. 코스·날씨·강도가 같다는 뜻은
                아니에요.
                {runs[0]?.deviceGroup !== runs[1]?.deviceGroup
                  ? " 측정 기기도 달라요."
                  : !runs[0]?.deviceGroup ||
                      runs[0]?.deviceGroup === "출처 미상"
                    ? " 측정 기기 정보가 없어요."
                    : ""}
              </p>
            </section>
            <table className="pair-table">
              <caption className="sr-only">
                같은 구간의 평균과 측정 비율
              </caption>
              <thead>
                <tr>
                  <th>같은 구간</th>
                  <th>
                    <span className="pair-current">기준</span>
                    <br />
                    {runs[0]?.date}
                  </th>
                  <th>
                    <span className="pair-previous">비교</span>
                    <br />
                    {runs[1]?.date}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>페이스</th>
                  <td>{pace(pair.current.pace)} /km</td>
                  <td>{pace(pair.previous.pace)} /km</td>
                </tr>
                <tr>
                  <th>심박</th>
                  <td>{num(pair.current.hr)} bpm</td>
                  <td>{num(pair.previous.hr)} bpm</td>
                </tr>
                <tr>
                  <th>측정 비율</th>
                  <td>{num(pair.current.coverage * 100)}%</td>
                  <td>{num(pair.previous.coverage * 100)}%</td>
                </tr>
              </tbody>
            </table>
            {(["Hr", "Pace"] as const).map((metric) => (
              <div className="pair-chart" key={metric}>
                <h3>
                  {metric === "Hr" ? "심박 · bpm" : "페이스 · /km"}
                  <small>1분 평균</small>
                </h3>
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart
                    data={pair.rows}
                    margin={{ left: 0, right: 18, top: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="var(--rule)"
                      strokeDasharray="2 5"
                    />
                    <XAxis
                      type="number"
                      dataKey="time"
                      domain={[pair.from, pair.to]}
                      tickFormatter={elapsed}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      reversed={metric === "Pace"}
                      domain={["auto", "auto"]}
                      width={44}
                      tickFormatter={(v) =>
                        metric === "Hr" ? num(v) : pace(v)
                      }
                      tick={{ fontSize: 11 }}
                    />
                    <Line
                      dataKey={`current${metric}`}
                      stroke="var(--heart)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                    <Line
                      dataKey={`previous${metric}`}
                      stroke="var(--muted)"
                      strokeDasharray="5 4"
                      dot={{ r: 2 }}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ))}
            <p className="fine">
              <span className="pair-current">실선: 기준 러닝</span> · 점선: 비교
              러닝
            </p>
            <div className="pair-actions">
              {runs.map(
                (run, i) =>
                  run && (
                    <Button
                      key={run.id}
                      variant="outline"
                      onClick={() =>
                        onOpen(run.id, {
                          id: run.id,
                          from: pair.from,
                          to: pair.to,
                        })
                      }
                    >
                      {i === 0 ? "기준" : "비교"} 러닝 구간 보기 →
                    </Button>
                  ),
              )}
            </div>
            <details className="journal-details">
              <summary>전체 운동량·계산 기준</summary>
              <p className="fine">
                평균은 심박·속도가 함께 측정된 시간으로 가중해요. 비교 구간은
                시작 5분 이후 공통 구간 중 최대 15분이며, 함께 측정된 비율이 70%
                미만인 값은 표시하지 않아요. 점은 해당 시점부터 1분 구간의
                평균이에요. 비어 있는 구간은 잇지 않아요.
              </p>
              {runs.map(
                (run) =>
                  run && (
                    <p className="fine" key={run.id}>
                      {run.date} · 전체{" "}
                      {num(
                        run.distanceM === null ? null : run.distanceM / 1000,
                        2,
                      )}{" "}
                      km · {duration(run.durationMs)}
                    </p>
                  ),
              )}
            </details>
          </>
        )
      )}
    </>
  );
}
