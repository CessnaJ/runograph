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
  domain,
  paceDomain,
  METRICS,
  metricInfo,
  nearest,
  timeTicks,
  trendPoints,
  type Metric,
} from "../core/chart";
import {
  intervals,
  metricStats,
  primaryRange,
  timeSegments,
} from "../core/analysis";
import { elapsed, num, pace } from "../core/format";
import {
  movement,
  movementSegments,
  observations,
  observedStats,
} from "../core/metrics";
import type { Detail, Observation, Profile } from "../core/types";
import { Button } from "./ui/button";
const Plot = memo(function Plot({
  data,
  domains,
  from,
  to,
  metrics,
  axis,
  trend,
}: {
  data: ReturnType<typeof trendPoints>;
  domains: Record<Metric, [number, number]>;
  from: number;
  to: number;
  metrics: Metric[];
  axis: Metric;
  trend: boolean;
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
          ticks={timeTicks(from, to)}
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
            strokeOpacity={key === "hr" && trend ? 0.35 : 1}
            strokeWidth={key === "hr" && trend ? 1 : 1.8}
            strokeDasharray={metricInfo[key].dash}
            dot={({ cx, cy, index }) => {
              const previous = data[index - 1]?.[key];
              const next = data[index + 1]?.[key];
              return data[index]?.[key] != null &&
                previous == null &&
                next == null ? (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={2.5}
                  fill={metricInfo[key].color}
                />
              ) : (
                <g key={index} />
              );
            }}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
        {trend && metrics.includes("hr") && (
          <Line
            yAxisId="hr"
            dataKey="hrTrend"
            type="linear"
            stroke="var(--heart)"
            strokeWidth={2}
            dot={false}
            activeDot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
});
export function RunChart({
  detail,
  profile,
  focus,
}: {
  detail: Detail;
  profile?: Profile;
  focus?: { from: number; to: number };
}) {
  const points = detail.points,
    end = points.at(-1)!.time;
  const primary = useMemo(() => primaryRange(detail), [detail]);
  const groups = useMemo(() => timeSegments(detail), [detail]);
  const [displayRange, setDisplayRange] = useState<[number, number]>(primary);
  const [layout, setLayout] = useState<"split" | "combined">(() =>
    localStorage.getItem("runograph-layout") === "combined"
      ? "combined"
      : "split",
  );
  const hasHr = points.some((p) => p.hr !== null);
  const [axis, setAxis] = useState<Metric>(hasHr ? "hr" : "pace"),
    [selected, setSelected] = useState<number | null>(null),
    [pinned, setPinned] = useState(false),
    [range, setRange] = useState<[number, number]>(
      focus ? [focus.from, focus.to] : primary,
    ),
    [zoom, setZoom] = useState(false),
    [threshold, setThreshold] = useState(""),
    [cadence, setCadence] = useState(false),
    [fullPace, setFullPace] = useState(false),
    [trend, setTrend] = useState(true),
    [gapCursor, setGapCursor] = useState<number | null>(null);
  const frame = useRef<number | null>(null),
    pending = useRef<{ index: number | null; gap: number | null } | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  useEffect(() => {
    if (focus) {
      setRange([Math.max(0, focus.from), Math.min(end, focus.to)]);
      setSelected(null);
      setPinned(false);
      setZoom(true);
    }
  }, [focus, end]);
  const [from, to] = range;
  const domains = useMemo(
    () => ({
      hr: domain(points, "hr"),
      pace: paceDomain(detail, displayRange[0], displayRange[1], fullPace),
      cadence: domain(points, "cadence"),
    }),
    [detail, points, displayRange, fullPace],
  );
  const data = useMemo(
    () => trendPoints(detail, from, to, domains.pace),
    [detail, from, to, domains.pace],
  );
  const stats = useMemo(
    () => observedStats(detail, from, to),
    [detail, from, to],
  );
  const thirds = useMemo(
    () =>
      Array.from({ length: 3 }, (_, i) => {
        const a =
            displayRange[0] + ((displayRange[1] - displayRange[0]) * i) / 3,
          b =
            displayRange[0] +
            ((displayRange[1] - displayRange[0]) * (i + 1)) / 3;
        return {
          from: a,
          to: b,
          hr: metricStats(detail, a, b, "hr"),
          speed: metricStats(detail, a, b, "speed"),
        };
      }),
    [detail, displayRange],
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
  const gaps = useMemo(
    () =>
      points
        .slice(1)
        .flatMap((p, i) =>
          p.time - points[i].time > detail.gapSec
            ? [{ from: points[i].time, to: p.time }]
            : [],
        ),
    [points, detail.gapSec],
  );
  const outliers = useMemo(
    () =>
      points.flatMap((p, i) =>
        p.time >= from &&
        p.time <= to &&
        p.pace !== null &&
        (p.pace < domains.pace[0] || p.pace > domains.pace[1])
          ? [{ ...p, index: i }]
          : [],
      ),
    [points, from, to, domains.pace],
  );
  const chosen = selected === null ? null : points[selected];
  const outside = points.filter((p) => p.time < from || p.time > to).length;
  const displayMetrics: Metric[] = hasHr ? ["hr", "pace"] : ["pace"];
  if (cadence) displayMetrics.push("cadence");
  const plots =
    layout === "split" ? displayMetrics.map((m) => [m]) : [displayMetrics];
  function selectTime(time: number, pin: boolean) {
    const inGap =
      gaps.some((g) => time > g.from && time < g.to) ||
      time < points[0].time ||
      time > end;
    const value = {
      index: inGap ? null : nearest(points, time),
      gap: inGap ? time : null,
    };
    if (pin) {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      setSelected(value.index);
      setGapCursor(value.gap);
      setPinned(true);
    } else if (!pinned) {
      pending.current = value;
      if (frame.current === null)
        frame.current = requestAnimationFrame(() => {
          setSelected(pending.current!.index);
          setGapCursor(pending.current!.gap);
          frame.current = null;
        });
    }
  }
  function updateCursor(x: number, element: HTMLDivElement, pin: boolean) {
    const box = element.getBoundingClientRect();
    selectTime(
      from +
        (to - from) *
          Math.max(0, Math.min(1, (x - box.left - 44) / (box.width - 60))),
      pin,
    );
  }
  function clear() {
    setSelected(null);
    setGapCursor(null);
    setPinned(false);
  }
  function changeRange(a: number, b: number) {
    setRange([a, b]);
    if (
      (chosen && (chosen.time < a || chosen.time > b)) ||
      (gapCursor !== null && (gapCursor < a || gapCursor > b))
    )
      clear();
  }
  function showObservation(o: Observation) {
    changeRange(Math.max(0, o.from - 30), Math.min(end, o.to + 30));
    setZoom(true);
    clear();
    document
      .querySelector(".chart-section")
      ?.scrollIntoView({ block: "start" });
  }
  const cursorTime = chosen?.time ?? gapCursor;
  const cursor =
    cursorTime !== null && cursorTime >= from && cursorTime <= to && to > from
      ? (cursorTime - from) / (to - from)
      : null;
  const pairedSec = useMemo(
    () =>
      intervals(detail, from, to)
        .filter((x) => x.hr !== null && x.speed !== null)
        .reduce((n, x) => n + x.sec, 0),
    [detail, from, to],
  );
  return (
    <section className="chart-section" aria-label="러닝 시계열 그래프">
      <div className="chart-toolbar">
        <div className="segmented" aria-label="그래프 보기">
          {(["split", "combined"] as const).map((v) => (
            <Button
              key={v}
              variant="ghost"
              aria-pressed={layout === v}
              onClick={() => {
                setLayout(v);
                localStorage.setItem("runograph-layout", v);
              }}
            >
              {v === "split" ? "나눠 보기" : "겹쳐 보기"}
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
      {(primary[0] > 0 || primary[1] < end) && (
        <p className="focus-note">
          주 관측 구간 {elapsed(primary[0])}–{elapsed(primary[1])} · 전체 경과{" "}
          {elapsed(end)} · 화면 밖 {outside}점
        </p>
      )}
      {groups.length > 1 && (
        <label className="time-scope">
          시간축 · 긴 공백으로 나뉜 관측
          <select
            aria-label="시간축 관측 범위"
            value={JSON.stringify(displayRange)}
            onChange={(e) => {
              const next = JSON.parse(e.target.value) as [number, number];
              setDisplayRange(next);
              changeRange(...next);
              clear();
            }}
          >
            <option value={JSON.stringify([0, end])}>
              전체 경과 · {elapsed(end)}
            </option>
            {groups.map((g, i) => (
              <option
                key={i}
                value={JSON.stringify([g.from, Math.max(g.to, g.from + 1)])}
              >
                관측 묶음 {i + 1} · {elapsed(g.from)}–{elapsed(g.to)} ·{" "}
                {g.points}점
              </option>
            ))}
          </select>
        </label>
      )}
      {plots.map((metrics) => (
        <div className="chart-panel" key={metrics.join("-")}>
          <div className="chart-label">
            {layout === "split"
              ? `${metricInfo[metrics[0]].label} · ${metricInfo[metrics[0]].unit}`
              : "변화 시점 비교 · 독립 Y축"}
          </div>
          <div
            className={`plot ${layout === "combined" ? "plot-combined" : metrics[0] === "hr" ? "plot-heart" : "plot-pace"}`}
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
                clear();
              }
            }}
          >
            <Plot
              data={data}
              domains={domains}
              from={from}
              to={to > from ? to : from + 1}
              metrics={metrics}
              axis={
                layout === "split"
                  ? metrics[0]
                  : displayMetrics.includes(axis)
                    ? axis
                    : displayMetrics[0]
              }
              trend={trend}
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
            {metrics.includes("pace") &&
              outliers.slice(0, 60).map((p) => (
                <button
                  key={p.index}
                  className="outside-point"
                  title={`${elapsed(p.time)} · ${pace(p.pace)} /km · 표시 범위 밖`}
                  aria-label={`${elapsed(p.time)} 페이스 바깥값 ${pace(p.pace)}`}
                  style={{
                    left: `calc(44px + (100% - 60px) * ${(p.time - from) / (to - from || 1)})`,
                    top: p.pace! < domains.pace[0] ? 8 : undefined,
                    bottom: p.pace! > domains.pace[1] ? 30 : undefined,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(p.index);
                    setGapCursor(null);
                    setPinned(true);
                  }}
                >
                  {" "}
                  {p.pace! < domains.pace[0] ? "▲" : "▼"}
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="readout" data-testid="readout">
        <div className="readout-time">
          {gapCursor !== null
            ? `${elapsed(gapCursor)} · 관측 없음${pinned ? " · 고정" : ""}`
            : chosen
              ? `${elapsed(chosen.time)}${pinned ? " · 고정" : ""}`
              : "시점을 선택하면 측정값이 표시됩니다"}
        </div>
        {(chosen || gapCursor !== null) && (
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
        )}
        {chosen && (
          <small className="subtle">
            {movement(chosen.speed)} · 원본 관측값
          </small>
        )}
      </div>
      <div className="chart-options">
        <Button
          variant="ghost"
          aria-pressed={cadence}
          onClick={() => setCadence(!cadence)}
        >
          추가 지표 · 케이던스
        </Button>
        <Button
          variant="ghost"
          aria-pressed={fullPace}
          onClick={() => setFullPace(!fullPace)}
        >
          {fullPace ? "달리기 페이스 범위" : "전체 페이스 범위"}
        </Button>
        {hasHr && (
          <Button
            variant="ghost"
            aria-pressed={trend}
            onClick={() => setTrend(!trend)}
          >
            표시용 추세 {trend ? "켜짐" : "꺼짐"}
          </Button>
        )}
      </div>
      {outliers.length > 0 && (
        <details className="outlier-list">
          <summary>
            표시 범위 밖 페이스 {outliers.length}점 · 실제 값 확인
          </summary>
          {outliers.map((p) => (
            <Button
              key={p.index}
              variant="ghost"
              onClick={() => {
                setSelected(p.index);
                setGapCursor(null);
                setPinned(true);
              }}
            >
              {elapsed(p.time)} · {pace(p.pace)} /km
            </Button>
          ))}
        </details>
      )}
      {layout === "combined" && (
        <>
          <label className="axis-select">
            Y축 눈금{" "}
            <select
              aria-label="Y축 눈금"
              value={displayMetrics.includes(axis) ? axis : displayMetrics[0]}
              onChange={(e) => setAxis(e.target.value as Metric)}
            >
              {displayMetrics.map((key) => (
                <option key={key} value={key}>
                  {metricInfo[key].label}
                </option>
              ))}
            </select>
          </label>
          <div className="axis-ranges">
            {displayMetrics.map((key) => (
              <span key={key} style={{ color: metricInfo[key].color }}>
                {metricInfo[key].label}{" "}
                {key === "pace"
                  ? `${pace(domains[key][0])}–${pace(domains[key][1])}`
                  : `${num(domains[key][0])}–${num(domains[key][1])}`}{" "}
                {metricInfo[key].unit}
              </span>
            ))}
          </div>
          <p className="fine">
            선의 교차나 높이는 같은 측정값을 뜻하지 않습니다.
          </p>
        </>
      )}
      <div className="chart-actions">
        <Button variant="ghost" onClick={clear}>
          선택 해제
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDisplayRange([0, end]);
            changeRange(0, end);
            clear();
          }}
        >
          전체 구간
        </Button>
        {(primary[0] > 0 || primary[1] < end) && (
          <Button
            variant="ghost"
            onClick={() => {
              setDisplayRange(primary);
              changeRange(...primary);
              clear();
            }}
          >
            주 관측 구간
          </Button>
        )}
      </div>
      <label className="slider-label">
        관측 시점 <span>{chosen ? elapsed(chosen.time) : "선택 전"}</span>
        <input
          aria-label="관측 시점"
          type="range"
          min={nearest(points, from)}
          max={nearest(points, to)}
          value={selected ?? nearest(points, from)}
          onChange={(e) => {
            setSelected(Number(e.target.value));
            setGapCursor(null);
            setPinned(true);
          }}
        />
      </label>
      {zoom && (
        <div className="zoom-controls">
          <label className="slider-label">
            시작 <span>{elapsed(from)}</span>
            <input
              aria-label="구간 시작"
              type="range"
              min="0"
              max={Math.max(0, to - 1)}
              value={from}
              onChange={(e) => changeRange(Number(e.target.value), to)}
            />
          </label>
          <label className="slider-label">
            끝 <span>{elapsed(to)}</span>
            <input
              aria-label="구간 끝"
              type="range"
              min={Math.min(end, from + 1)}
              max={end}
              value={to}
              onChange={(e) => changeRange(from, Number(e.target.value))}
            />
          </label>
          <div className="time-inputs">
            <label>
              시작 초
              <input
                aria-label="시작 초"
                type="number"
                min="0"
                max={to - 1}
                value={Math.round(from)}
                onChange={(e) =>
                  changeRange(
                    Math.max(0, Math.min(to - 1, Number(e.target.value))),
                    to,
                  )
                }
              />
            </label>
            <label>
              끝 초
              <input
                aria-label="끝 초"
                type="number"
                min={from + 1}
                max={end}
                value={Math.round(to)}
                onChange={(e) =>
                  changeRange(
                    from,
                    Math.min(end, Math.max(from + 1, Number(e.target.value))),
                  )
                }
              />
            </label>
          </div>
        </div>
      )}
      <div className="segment-stats">
        <span>
          {elapsed(from)}–{elapsed(to)}
        </span>
        <span>원본 {stats.samples}표본</span>
        <span>
          심박 관측 {num(stats.hrSec / 60, 1)}분 · {num(stats.coverage * 100)}%
        </span>
        <span>동시 관측 {num(pairedSec / 60, 1)}분</span>
        <span>
          {stats.coverage >= 0.7
            ? `관측 평균 심박 ${num(stats.meanHr)} bpm`
            : "심박 관측 부족"}
        </span>
        <span>
          {stats.speedCoverage >= 0.7
            ? `관측 평균 페이스 ${pace(stats.meanSpeed ? 1000 / stats.meanSpeed : null)} /km`
            : "속도 관측 부족"}
        </span>
        <span>
          {stats.cadenceCoverage >= 0.7
            ? `케이던스 ${num(stats.meanCadence)} 회/분`
            : "케이던스 관측 부족"}
        </span>
      </div>
      <section className="run-thirds">
        <h3>초반 · 중간 · 후반</h3>
        <div className="thirds-grid">
          {thirds.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                changeRange(s.from, s.to);
                setZoom(true);
              }}
            >
              <small>
                {["초반", "중간", "후반"][i]} · {elapsed(s.from)}–
                {elapsed(s.to)}
              </small>
              <b>
                {s.hr.coverage >= 0.7
                  ? `${num(s.hr.mean)} bpm`
                  : "심박 관측 부족"}
              </b>
              <span>
                {s.speed.coverage >= 0.7
                  ? `${pace(s.speed.mean ? 1000 / s.speed.mean : null)} /km`
                  : "속도 관측 부족"}
              </span>
              <small>
                심박 {num(s.hr.sec / 60, 1)}분 · {num(s.hr.coverage * 100)}%
              </small>
            </button>
          ))}
        </div>
      </section>
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
        <p className="fine">빈 구간: 공백·짧은 전환·미측정</p>
      </div>
      {gaps.length > 0 && (
        <details>
          <summary>
            관측 공백 {gaps.length}곳 · 전체 경과 {elapsed(end)}
          </summary>
          {gaps.map((g, i) => (
            <p className="fine" key={i}>
              {elapsed(g.from)}–{elapsed(g.to)} · {elapsed(g.to - g.from)} 공백
            </p>
          ))}
          {groups.length > 1 &&
            groups.map((g, i) => (
              <Button
                variant="ghost"
                key={i}
                onClick={() => {
                  const next: [number, number] = [
                    g.from,
                    Math.max(g.to, g.from + 1),
                  ];
                  setDisplayRange(next);
                  changeRange(...next);
                  clear();
                }}
              >
                관측 묶음 {i + 1} · {elapsed(g.from)}–{elapsed(g.to)} ·{" "}
                {g.points}점
              </Button>
            ))}
        </details>
      )}
      <section className="journal-section">
        <h3>후반 유지력</h3>
        {profile?.halves ? (
          <>
            <p>
              전반 {num(profile.halves.first.hr)} → 후반{" "}
              {num(profile.halves.last.hr)} bpm · 페이스{" "}
              {pace(
                profile.halves.first.speed
                  ? 1000 / profile.halves.first.speed
                  : null,
              )}{" "}
              →{" "}
              {pace(
                profile.halves.last.speed
                  ? 1000 / profile.halves.last.speed
                  : null,
              )}{" "}
              /km
            </p>
            <p className="fine">
              {elapsed(profile.halves.from)}–{elapsed(profile.halves.to)} ·
              전반/후반 관측 {num(profile.halves.first.sec / 60, 1)}/
              {num(profile.halves.last.sec / 60, 1)}분 · 커버리지{" "}
              {num(profile.halves.first.coverage * 100)}/
              {num(profile.halves.last.coverage * 100)}% ·{" "}
              {profile.halves.speedDifference > 0.05
                ? "페이스도 달라진 전후반"
                : "비슷한 평균속도의 전후반"}
            </p>
          </>
        ) : (
          <p className="empty-note">
            각 절반 5분·동시 관측 70% 조건에 맞는 구간이 없습니다.
          </p>
        )}
        {profile?.drift && (
          <details>
            <summary>엄격한 드리프트 관측</summary>
            <p>
              {num(profile.drift.percent, 1)}% · {elapsed(profile.drift.from)}–
              {elapsed(profile.drift.to)}
            </p>
            <p className="fine">
              연속 20분·관측 80%·절반 속도 차이 5% 이내 구간의 속도/심박 비율
              변화입니다.
            </p>
          </details>
        )}
      </section>
      <section className="journal-section">
        <h3>기록의 관찰</h3>
        {profile?.observations.length ? (
          profile.observations.map((o, i) => (
            <button
              className="observation-row"
              key={i}
              onClick={() => showObservation(o)}
            >
              <small>
                {elapsed(o.from)}–{elapsed(o.to)} · 근거 구간 확대 →
              </small>
              <h3>{o.title}</h3>
              <p>{o.evidence}</p>
              <p className="fine">{o.limit}</p>
            </button>
          ))
        ) : (
          <p className="fine">
            분석 가능한 관측에서 조건에 맞는 특이 구간이 없습니다. 결측 구간은
            판단하지 않습니다.
          </p>
        )}
      </section>
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
          직접 정한 값 이상으로 60초 이상 이어진 실제 관측입니다.
        </p>
        {extra.map((o, i) => (
          <button
            className="observation-row"
            key={i}
            onClick={() => showObservation(o)}
          >
            {elapsed(o.from)}–{elapsed(o.to)} · {o.evidence}
          </button>
        ))}
        {threshold && !extra.length && (
          <p className="subtle">연속 관측 조건에 맞는 구간이 없습니다.</p>
        )}
      </details>
      <details className="journal-details">
        <summary>그래프와 계산 기준</summary>
        <p className="fine">
          얇은 선은 원본, 진한 심박 선은 60초 표시용 중앙값입니다. 계산은 원본
          관측 구간을 시간으로 가중합니다. {detail.gapSec}초 초과 공백과 결측은
          연결하지 않고 마지막 점을 연장하지 않습니다. 확대해도 축과 측정
          해상도는 유지됩니다. 이동 상태는 속도 기준 추정이며 원본 일시정지 버튼
          기록이 아닙니다.
        </p>
        <p className="fine">
          심박 축 {num(domains.hr[0])}–{num(domains.hr[1])} bpm · 페이스 축{" "}
          {pace(domains.pace[0])}–{pace(domains.pace[1])} /km. 구간거리 방향이
          확인되지 않아 거리 분할·회복심박 추정은 제공하지 않습니다.
        </p>
      </details>
      <div className="sr-only" aria-live="polite">
        {pinned
          ? gapCursor !== null
            ? `${elapsed(gapCursor)}, 관측 없음`
            : chosen
              ? `${elapsed(chosen.time)}, 심박 ${num(chosen.hr)}, 페이스 ${pace(chosen.pace)}, 케이던스 ${num(chosen.cadence)}`
              : ""
          : ""}
      </div>
    </section>
  );
}
