import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  chartPoints,
  domain,
  METRICS,
  metricInfo,
  nearest,
  type Metric,
} from "../core/chart";
import { elapsed, num, pace } from "../core/format";
import {
  movement,
  movementSegments,
  observations,
  observedStats,
} from "../core/metrics";
import type { Detail } from "../core/types";
import { Button } from "./ui/button";
const Plot = memo(function Plot({
  data,
  domains,
  from,
  to,
  metrics,
  axis,
}: {
  data: ReturnType<typeof chartPoints>;
  domains: Record<Metric, [number, number]>;
  from: number;
  to: number;
  metrics: Metric[];
  axis: Metric;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" debounce={30}>
      <LineChart
        data={data}
        margin={{ top: 12, right: 16, left: 0, bottom: 4 }}
      >
        <CartesianGrid
          vertical={false}
          stroke="var(--rule)"
          strokeDasharray="2 5"
        />
        <XAxis
          dataKey="time"
          type="number"
          domain={[from, to]}
          allowDataOverflow
          ticks={[from, (from + to) / 2, to]}
          tickFormatter={elapsed}
          tick={{ fontSize: 11, fill: "var(--muted)" }}
          axisLine={false}
          tickLine={false}
          minTickGap={20}
        />
        {metrics.map((key) => (
          <YAxis
            key={key}
            yAxisId={key}
            domain={domains[key]}
            reversed={key === "pace"}
            hide={key !== axis}
            width={key === axis ? 44 : 0}
            tickCount={4}
            tickFormatter={(v) =>
              key === "pace" ? pace(Number(v)) : num(Number(v))
            }
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
            allowDataOverflow
          />
        ))}
        {metrics.map((key) => (
          <Line
            key={key}
            yAxisId={key}
            dataKey={key}
            type="linear"
            stroke={metricInfo[key].color}
            strokeWidth={1.8}
            strokeDasharray={metricInfo[key].dash}
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});
const SPLIT: Metric[][] = [["hr"], ["pace"], ["cadence"]];
const COMBINED: Metric[][] = [METRICS];
export function RunChart({ detail }: { detail: Detail }) {
  const points = detail.points;
  const [layout, setLayout] = useState<"split" | "combined">(() =>
    localStorage.getItem("runograph-layout") === "combined"
      ? "combined"
      : "split",
  );
  const [axis, setAxis] = useState<Metric>("hr"),
    [selected, setSelected] = useState<number | null>(null),
    [pinned, setPinned] = useState(false),
    [range, setRange] = useState<[number, number]>([0, points.length - 1]),
    [zoom, setZoom] = useState(false),
    [threshold, setThreshold] = useState("");
  const frame = useRef<number | null>(null),
    pending = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const from = points[range[0]].time,
    to = points[range[1]].time;
  const data = useMemo(() => chartPoints(detail, from, to), [detail, from, to]);
  const domains = useMemo(
    () =>
      Object.fromEntries(
        METRICS.map((key) => [key, domain(points, key)]),
      ) as Record<Metric, [number, number]>,
    [points],
  );
  const stats = useMemo(
    () => observedStats(detail, from, to),
    [detail, from, to],
  );
  const extra = useMemo(
    () =>
      threshold && Number(threshold) > 0
        ? observations(detail, Number(threshold)).filter(
            (o) => o.kind === "threshold",
          )
        : [],
    [detail, threshold],
  );
  const segments = useMemo(() => movementSegments(detail), [detail]);
  const chosen = selected === null ? null : points[selected];
  function updateCursor(
    clientX: number,
    element: HTMLDivElement,
    pin: boolean,
  ) {
    const box = element.getBoundingClientRect();
    const fraction = Math.max(
      0,
      Math.min(1, (clientX - box.left - 44) / (box.width - 60)),
    );
    const index = nearest(points, from + (to - from) * fraction);
    if (pin) {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setSelected(index);
      setPinned(true);
    } else if (!pinned) {
      pending.current = index;
      if (frame.current === null)
        frame.current = requestAnimationFrame(() => {
          setSelected(pending.current);
          frame.current = null;
        });
    }
  }
  const cursor =
    chosen && chosen.time >= from && chosen.time <= to && to > from
      ? (chosen.time - from) / (to - from)
      : null;
  const changeRange = (start: number, finish: number) => {
    setRange([start, finish]);
    if (selected !== null && (selected < start || selected > finish)) {
      setSelected(null);
      setPinned(false);
    }
  };
  return (
    <section className="chart-section" aria-label="러닝 시계열 그래프">
      <div className="section-heading">
        <div>
          <h3>러닝의 흐름</h3>
          <p className="subtle">
            실제 관측 시각 · 터치하거나 시점을 선택해 보세요
          </p>
        </div>
      </div>
      <div className="chart-toolbar">
        <div className="segmented" aria-label="그래프 보기">
          {(["split", "combined"] as const).map((value) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={layout === value}
              onClick={() => {
                setLayout(value);
                localStorage.setItem("runograph-layout", value);
              }}
            >
              {value === "split" ? "나눠 보기" : "겹쳐 보기"}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          onClick={() => setZoom(!zoom)}
          aria-expanded={zoom}
        >
          구간 선택
        </Button>
      </div>
      {layout === "combined" && (
        <>
          <div className="legend">
            {METRICS.map((key) => (
              <span key={key} style={{ color: metricInfo[key].color }}>
                <i
                  style={{
                    borderTopStyle:
                      key === "hr"
                        ? "solid"
                        : key === "pace"
                          ? "dashed"
                          : "dotted",
                  }}
                />
                {metricInfo[key].label}
              </span>
            ))}
          </div>
          <label className="axis-select">
            Y축 눈금{" "}
            <select
              aria-label="Y축 눈금"
              value={axis}
              onChange={(e) => setAxis(e.target.value as Metric)}
            >
              {METRICS.map((key) => (
                <option key={key} value={key}>
                  {metricInfo[key].label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="readout" data-testid="readout">
        <div className="readout-time">
          {chosen
            ? `${elapsed(chosen.time)}${pinned ? " · 고정" : ""}`
            : "시점을 선택하면 측정값이 표시됩니다"}
        </div>
        <div className="readout-values">
          {METRICS.map((key) => (
            <span key={key}>
              <small>{metricInfo[key].label}</small>
              <b>
                {chosen
                  ? key === "pace"
                    ? pace(chosen.pace)
                    : num(chosen[key])
                  : "—"}
              </b>
              <small>{metricInfo[key].unit}</small>
            </span>
          ))}
        </div>
        {chosen && (
          <small className="subtle">
            {movement(chosen.speed)} · 순간 속도 기준
          </small>
        )}
      </div>
      {(layout === "split" ? SPLIT : COMBINED).map((metrics) => (
        <div className="chart-panel" key={metrics.join("-")}>
          <div className="chart-label">
            {layout === "split"
              ? `${metricInfo[metrics[0]].label} · ${metricInfo[metrics[0]].unit}`
              : "세 지표의 변화 시점"}
          </div>
          <div
            className={`plot ${layout === "combined" ? "plot-combined" : ""}`}
            data-testid="timeline"
            onPointerMove={(e) =>
              updateCursor(e.clientX, e.currentTarget, false)
            }
            onClick={(e) => updateCursor(e.clientX, e.currentTarget, true)}
            onPointerLeave={() => {
              if (!pinned) {
                if (frame.current !== null) {
                  cancelAnimationFrame(frame.current);
                  frame.current = null;
                }
                setSelected(null);
              }
            }}
          >
            <Plot
              data={data}
              domains={domains}
              from={from}
              to={to > from ? to : from + 1}
              metrics={metrics}
              axis={layout === "split" ? metrics[0] : axis}
            />
            {cursor !== null && (
              <div className="cursor-plane" aria-hidden="true">
                <div
                  className="shared-cursor"
                  data-testid="shared-cursor"
                  style={{ left: `${cursor * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      {layout === "combined" && (
        <>
          <div className="axis-ranges">
            {METRICS.map((key) => (
              <span key={key}>
                {metricInfo[key].label}{" "}
                {key === "pace"
                  ? `${pace(domains[key][0])}–${pace(domains[key][1])}`
                  : `${num(domains[key][0])}–${num(domains[key][1])}`}{" "}
                {metricInfo[key].unit}
              </span>
            ))}
          </div>
          <p className="fine">
            각 선은 독립적인 Y축입니다. 선의 높이나 교차는 같은 측정값을 뜻하지
            않습니다.
          </p>
        </>
      )}
      <div className="movement-track">
        <p className="fine">이동 흐름 · 속도 기준 추정</p>
        <div className="movement-bar" aria-label="추정 이동 구간">
          {segments
            .filter((s) => s.to > from && s.from < to)
            .map((s, i) => (
              <span
                key={i}
                title={`${elapsed(s.from)}–${elapsed(s.to)} · ${s.state}`}
                data-state={s.state}
                style={{
                  left: `${((Math.max(from, s.from) - from) / (to - from || 1)) * 100}%`,
                  width: `${((Math.min(to, s.to) - Math.max(from, s.from)) / (to - from || 1)) * 100}%`,
                }}
              />
            ))}
        </div>
        <div className="movement-legend">
          <span>● 달리기 추정</span>
          <span>● 걷기 추정</span>
          <span>● 정지 추정</span>
          <span>빈 구간: 공백·짧은 전환·미측정</span>
        </div>
      </div>
      <label className="slider-label">
        관측 시점 <span>{chosen ? elapsed(chosen.time) : "선택 전"}</span>
        <input
          aria-label="관측 시점"
          type="range"
          min={range[0]}
          max={range[1]}
          value={selected ?? range[0]}
          onChange={(e) => {
            setSelected(Number(e.target.value));
            setPinned(true);
          }}
        />
      </label>
      <div className="chart-actions">
        <Button
          variant="ghost"
          onClick={() => {
            setSelected(null);
            setPinned(false);
          }}
        >
          선택 해제
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            changeRange(0, points.length - 1);
            setSelected(null);
            setPinned(false);
          }}
        >
          전체 구간
        </Button>
      </div>
      {zoom && (
        <div className="zoom-controls">
          <label className="slider-label">
            시작 <span>{elapsed(from)}</span>
            <input
              aria-label="구간 시작"
              type="range"
              min="0"
              max={Math.max(0, range[1] - 1)}
              value={range[0]}
              onChange={(e) => changeRange(Number(e.target.value), range[1])}
            />
          </label>
          <label className="slider-label">
            끝 <span>{elapsed(to)}</span>
            <input
              aria-label="구간 끝"
              type="range"
              min={Math.min(points.length - 1, range[0] + 1)}
              max={points.length - 1}
              value={range[1]}
              onChange={(e) => changeRange(range[0], Number(e.target.value))}
            />
          </label>
        </div>
      )}
      <div className="segment-stats">
        <span>
          {elapsed(from)}–{elapsed(to)}
        </span>
        <span>원본 {stats.samples.toLocaleString()}표본</span>
        <span>심박 커버리지 {num(stats.coverage * 100)}%</span>
        <span>관측 평균 심박 {num(stats.meanHr)} bpm</span>
        <span>관측 평균 케이던스 {num(stats.meanCadence)} 회/분</span>
        <span>관측 평균 속도 {num(stats.meanSpeed, 2)} m/s</span>
      </div>
      <p className="fine">
        인접한 유효 표본 사이를 시간으로 가중합니다. {Math.round(detail.gapSec)}
        초 초과 공백과 결측은 연결하지 않습니다. 확대해도 Y축과 측정 해상도는
        유지됩니다. 이동 흐름은 속도 0.3 m/s 미만 정지·1.8 m/s 미만 걷기·그 이상
        달리기를 30초 이상 유지한 구간의 추정입니다. 원본 일시정지·걷기 표시는
        아닙니다.
      </p>
      <details className="threshold">
        <summary>내 기준 심박 이상 구간 확인</summary>
        <label>
          심박 기준 (bpm)
          <input
            inputMode="numeric"
            type="number"
            min="1"
            max="400"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="직접 입력"
          />
        </label>
        <p className="fine">
          직접 정한 값 이상으로 60초 이상 이어진 관측만 표시합니다. 최대심박이나
          위험 기준을 자동으로 정하지 않습니다.
        </p>
        {extra.map((o, i) => (
          <p key={i}>
            {elapsed(o.from)}–{elapsed(o.to)} · {o.evidence}
          </p>
        ))}
        {threshold && !extra.length && (
          <p className="subtle">연속 관측 조건에 맞는 구간이 없습니다.</p>
        )}
      </details>
      <div className="sr-only" aria-live="polite">
        {pinned && chosen
          ? `${elapsed(chosen.time)}, 심박 ${num(chosen.hr)}, 페이스 ${pace(chosen.pace)}, 케이던스 ${num(chosen.cadence)}`
          : ""}
      </div>
    </section>
  );
}
