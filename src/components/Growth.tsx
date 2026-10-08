import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  compare,
  dayNumber,
  evidence,
  STATE_LABEL,
  suggestComparison,
  trainingRows,
  type CompareConfig,
  type Comparison,
  type CompareRow,
  type Question,
} from "../core/analysis";
import { elapsed, num, pace } from "../core/format";
import type { EvidenceRef, Profile, Summary } from "../core/types";
import { Button } from "./ui/button";
export type GrowthView = Question | "duration" | "halves" | "habit";
function RunDot({
  cx = 0,
  cy = 0,
  payload,
  fill,
}: {
  cx?: number;
  cy?: number;
  payload?: CompareRow;
  fill?: string;
}) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={fill}
      fillOpacity={0.25 + 0.75 * Math.sqrt(Math.min(1, payload?.q ?? 1))}
    />
  );
}
export function ComparisonHeadline({ result }: { result: Comparison }) {
  const isHeart = result.config.question === "heart",
    diff = result.difference;
  const message =
    result.state === "insufficient"
      ? "현재 조건으로 비교할 관측이 부족합니다."
      : result.state === "conditions"
        ? "실제 비교 조건에 차이가 있습니다."
        : result.state === "sensitive"
          ? "비교 조건에 민감한 차이입니다."
          : diff === null
            ? "비교할 관측이 없습니다."
            : diff === 0
              ? "두 기간의 관측 대표값이 같습니다."
              : isHeart
                ? `비슷한 속도 부근에서 최근 관측 심박이 ${diff < 0 ? "낮았습니다" : "높았습니다"}.`
                : `비슷한 심박 부근에서 최근 관측 페이스가 ${diff < 0 ? "빨랐습니다" : "느렸습니다"}.`;
  return (
    <div
      className="comparison-answer"
      data-testid="comparison-answer"
      data-state={result.state}
    >
      <span className="status-label">{STATE_LABEL[result.state]}</span>
      <h2>{message}</h2>
      {diff !== null && result.state !== "insufficient" && (
        <p className="answer-number">
          {diff > 0 ? "+" : ""}
          {num(diff, 1)}{" "}
          <small>{isHeart ? "bpm" : "초/km"} · 최근 − 이전</small>
        </p>
      )}
      <p className="subtle">
        이전 {result.previous.count}회 · 최근 {result.recent.count}회
      </p>
      {result.baseState === "conditions" && (
        <p className="fine">실제 속도·심박 또는 운동 시점도 다릅니다.</p>
      )}
      {result.state === "insufficient" && result.reason[0] && (
        <p className="fine">{result.reason[0]}</p>
      )}
      <p className="fine">날씨·코스는 맞추지 않은 관측 비교입니다.</p>
      <details className="comparison-notes">
        <summary>비교 조건·민감도</summary>
        {result.reason.map((r) => (
          <p className="fine" key={r}>
            {r}
          </p>
        ))}
        {result.sensitivity && (
          <p className="fine">
            폭 변경·러닝 한 회 제외 시 차이 범위{" "}
            {num(result.sensitivity.min, 1)}–{num(result.sensitivity.max, 1)}{" "}
            {isHeart ? "bpm" : "초/km"}
          </p>
        )}
      </details>
    </div>
  );
}
export function ComparisonPlot({
  result,
  onOpen,
  compact = false,
}: {
  result: Comparison;
  onOpen?: (id: string, focus?: EvidenceRef) => void;
  compact?: boolean;
}) {
  const rows = [...result.previous.rows, ...result.recent.rows];
  const heart = result.config.question === "heart";
  const [lo, hi] = [
    dayNumber(result.periods.previous[0]) * 86400000,
    dayNumber(result.periods.recent[1]) * 86400000,
  ];
  const ticks = Array.from({ length: 4 }, (_, i) => lo + ((hi - lo) * i) / 3);
  const values = rows.map((r) => r.value);
  for (const period of [result.previous, result.recent]) {
    if (period.value !== null) values.push(period.value);
    if (period.iqr) values.push(...period.iqr);
  }
  const min = values.length ? Math.min(...values) : heart ? 100 : 360;
  const max = values.length ? Math.max(...values) : heart ? 160 : 480;
  const padding = heart ? 5 : 15;
  const span = Math.max(max - min + padding * 2, heart ? 20 : 60);
  const center = (min + max) / 2;
  return (
    <div
      className={`growth-chart ${compact ? "compact-chart" : ""}`}
      data-testid="comparison-plot"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 14, bottom: 0, left: 0 }}>
          <CartesianGrid
            vertical={false}
            stroke="var(--rule)"
            strokeDasharray="2 5"
          />
          <XAxis
            type="number"
            dataKey="epoch"
            domain={[lo, hi === lo ? hi + 86400000 : hi]}
            scale="time"
            ticks={ticks}
            tickFormatter={(v) => new Date(v).toISOString().slice(5, 10)}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="number"
            dataKey="value"
            reversed={!heart}
            width={44}
            domain={[center - span / 2, center + span / 2]}
            tickFormatter={(v) => (heart ? num(v) : pace(v))}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            axisLine={false}
            tickLine={false}
          />
          {result.state !== "insufficient" &&
            (["previous", "recent"] as const).map((period) => {
              const p = result[period],
                range = result.periods[period],
                color = period === "previous" ? "var(--muted)" : "var(--heart)";
              return p.iqr ? (
                <ReferenceArea
                  key={period}
                  x1={dayNumber(range[0]) * 86400000}
                  x2={dayNumber(range[1]) * 86400000}
                  y1={p.iqr[0]}
                  y2={p.iqr[1]}
                  fill={color}
                  fillOpacity={0.07}
                  stroke="none"
                  pointerEvents="none"
                />
              ) : null;
            })}
          {result.state !== "insufficient" &&
            (["previous", "recent"] as const).map((period) => {
              const p = result[period],
                range = result.periods[period];
              return p.value !== null ? (
                <ReferenceLine
                  key={period}
                  segment={[
                    { x: dayNumber(range[0]) * 86400000, y: p.value },
                    { x: dayNumber(range[1]) * 86400000, y: p.value },
                  ]}
                  stroke={
                    period === "previous" ? "var(--muted)" : "var(--heart)"
                  }
                  strokeDasharray="4 4"
                  pointerEvents="none"
                />
              ) : null;
            })}
          <Tooltip
            content={({ active, payload }) => {
              const r = payload?.[0]?.payload as CompareRow | undefined;
              return active && r ? (
                <div className="chart-tooltip">
                  {r.date} ·{" "}
                  {heart ? `${num(r.value, 1)} bpm` : `${pace(r.value)} /km`}
                  <br />
                  관측 {num(r.sec / 60, 1)}분 · {r.samples}표본
                </div>
              ) : null;
            }}
          />
          <Scatter
            name="이전"
            data={rows.filter((r) => r.period === "previous")}
            fill="var(--muted)"
            fillOpacity={0.55}
            shape={<RunDot />}
            isAnimationActive={false}
            onClick={(p) => {
              const r = p.payload as CompareRow;
              if (r && onOpen) onOpen(r.id, evidence(r)[0]);
            }}
          />
          <Scatter
            name="최근"
            data={rows.filter((r) => r.period === "recent")}
            fill="var(--heart)"
            shape={<RunDot />}
            isAnimationActive={false}
            onClick={(p) => {
              const r = p.payload as CompareRow;
              if (r && onOpen) onOpen(r.id, evidence(r)[0]);
            }}
          />
        </ScatterChart>
      </ResponsiveContainer>
      {!rows.length && (
        <p className="chart-empty">표시할 안정 관측이 없습니다.</p>
      )}
    </div>
  );
}
export function Growth({
  sessions,
  profiles,
  onOpen,
  config,
  onConfig,
  view,
  onView,
  onExclude,
  revision = 0,
}: {
  sessions: Summary[];
  profiles: Profile[];
  onOpen: (id: string, focus?: EvidenceRef) => void;
  config: CompareConfig | null;
  onConfig: (cfg: CompareConfig) => void;
  view: GrowthView;
  onView: (view: GrowthView) => void;
  onExclude: (id: string, excluded: boolean) => void;
  revision?: number;
}) {
  const suggested = useMemo(
    () => suggestComparison(sessions, profiles),
    [sessions, profiles],
  );
  const cfg = config ?? suggested;
  const [advanced, setAdvanced] = useState(false);
  const [customPeriod, setCustomPeriod] = useState(
    ![14, 28, 56].includes(cfg.days),
  );
  useEffect(() => {
    if (!config) onConfig(suggested);
  }, [config, suggested, onConfig]);
  const result = useMemo(
    () => compare(sessions, profiles, cfg, true, revision),
    [sessions, profiles, cfg, revision],
  );
  const [trainingPeriod, setTrainingPeriod] = useState<"week" | "month">(
    "week",
  );
  const training = useMemo(
    () => trainingRows(sessions, profiles, trainingPeriod),
    [sessions, profiles, trainingPeriod],
  );
  const recentTraining = training.slice(trainingPeriod === "week" ? -12 : -12);
  const own = new Set(sessions.map((s) => s.id));
  const halves = profiles.filter(
    (p) =>
      own.has(p.id) &&
      !sessions.find((s) => s.id === p.id)?.growthExcluded &&
      p.halves,
  );
  const strict = profiles.filter(
    (p) =>
      own.has(p.id) &&
      !sessions.find((s) => s.id === p.id)?.growthExcluded &&
      p.drift,
  );
  const rows = [...result.previous.rows, ...result.recent.rows].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const devices = [
    ...new Set(sessions.map((s) => s.deviceGroup ?? "출처 미상")),
  ];
  const set = (next: Partial<CompareConfig>) => onConfig({ ...cfg, ...next });
  const titles: Record<GrowthView, string> = {
    heart: "비슷한 속도에서 심박이 달라졌나?",
    pace: "비슷한 심박에서 빨라졌나?",
    duration: "더 오래 달렸나?",
    halves: "후반에도 유지했나?",
    habit: "꾸준히 달렸나?",
  };
  const isCompare = view === "heart" || view === "pace";
  function changeView(v: GrowthView) {
    onView(v);
    if (v === "heart" || v === "pace")
      onConfig(
        suggestComparison(
          sessions,
          profiles,
          v,
          cfg.days,
          cfg.elapsedFrom,
          cfg.elapsedTo,
          cfg.anchor,
        ),
      );
  }
  return (
    <>
      <div className="page-heading compact-heading">
        <h1 className="sr-only">성장과 변화</h1>
        <label className="question-control">
          <span className="sr-only">살펴볼 질문</span>
          <select
            aria-label="성장 질문"
            value={view}
            onChange={(e) => changeView(e.target.value as GrowthView)}
          >
            {Object.entries(titles).map(([key, title]) => (
              <option value={key} key={key}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {isCompare ? (
        <>
          <div className="comparison-controls">
            <label>
              비교 기간
              <select
                aria-label="비교 기간"
                value={
                  !customPeriod && [14, 28, 56].includes(cfg.days)
                    ? cfg.days
                    : "custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "custom") {
                    setCustomPeriod(false);
                    set({ days: Number(e.target.value) });
                  } else {
                    setCustomPeriod(true);
                    setAdvanced(true);
                  }
                }}
              >
                <option value="14">최근 2주 / 이전 2주</option>
                <option value="28">최근 4주 / 이전 4주</option>
                <option value="56">최근 8주 / 이전 8주</option>
                <option value="custom">직접 지정</option>
              </select>
            </label>
            <label className="target-control">
              {view === "heart" ? "중심 페이스 (/km)" : "중심 심박 (bpm)"}
              <strong>
                {view === "heart" ? pace(cfg.target) : num(cfg.target)}
              </strong>
              <input
                aria-label={view === "heart" ? "비교 페이스" : "비교 심박"}
                type="range"
                min={view === "heart" ? 240 : 70}
                max={view === "heart" ? 600 : 220}
                step={view === "heart" ? 1 : 1}
                value={cfg.target}
                onChange={(e) => set({ target: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="period-caption">
            이전 {result.periods.previous.join("–")}
            <br />
            최근 {result.periods.recent.join("–")} ·{" "}
            {cfg.device === "all" ? "모든 기기" : cfg.device}
          </p>
          <ComparisonHeadline result={result} />
          <ComparisonPlot result={result} onOpen={onOpen} />
          <p className="fine">
            점 하나는 러닝 한 회의 주변 관측 요약입니다. 회색: 이전 · 녹색:
            최근. 점을 누르면 근거 구간을 엽니다. 점선: 기간 대표값 · 옅은 띠:
            러닝별 중앙 50% 관측 편차.
          </p>
          <div className="period-values">
            {(["previous", "recent"] as const).map((key) => {
              const p = result[key];
              return (
                <div key={key}>
                  <small>
                    {key === "previous" ? "이전" : "최근"} · {p.count}회 /{" "}
                    {p.days}일
                  </small>
                  <strong>
                    {view === "heart" ? num(p.value, 1) : pace(p.value)}{" "}
                    <small>{view === "heart" ? "bpm" : "/km"}</small>
                  </strong>
                  <span>
                    러닝별 관측 편차{" "}
                    {p.iqr
                      ? view === "heart"
                        ? `${num(p.iqr[0], 1)}–${num(p.iqr[1], 1)} bpm`
                        : `${pace(p.iqr[0])}–${pace(p.iqr[1])} /km`
                      : "—"}
                  </span>
                  <span>
                    유효 러닝 {num(p.effective, 1)}회 · 가중 관측{" "}
                    {num(p.sec / 60, 1)}분 · 원본 {p.samples}표본
                  </span>
                </div>
              );
            })}
          </div>
          <details
            className="journal-details"
            open={advanced}
            onToggle={(e) => setAdvanced(e.currentTarget.open)}
          >
            <summary>비교 조건 조정</summary>
            <div className="filter-fields">
              <label>
                최근 기간 끝
                <input
                  aria-label="최근 기간 끝"
                  type="date"
                  value={cfg.anchor}
                  onChange={(e) => {
                    if (e.target.value) set({ anchor: e.target.value });
                  }}
                />
              </label>
              <label>
                기간 길이 (일)
                <input
                  aria-label="기간 길이"
                  type="number"
                  min="7"
                  max="365"
                  value={cfg.days}
                  onChange={(e) =>
                    set({
                      days: Math.max(
                        7,
                        Math.min(365, Number(e.target.value) || 28),
                      ),
                    })
                  }
                />
              </label>
              <label>
                기기
                <select
                  aria-label="비교 기기"
                  value={cfg.device}
                  onChange={(e) => set({ device: e.target.value })}
                >
                  <option value="all">모든 기기 · 혼합</option>
                  {devices.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label>
                운동 구간
                <select
                  aria-label="비교 운동 구간"
                  value={cfg.elapsedFrom}
                  onChange={(e) => {
                    const a = Number(e.target.value);
                    set({
                      elapsedFrom: a,
                      elapsedTo: a + 900,
                      phases: [a / 300, a / 300 + 1, a / 300 + 2],
                    });
                  }}
                >
                  <option value="300">시작 5–20분</option>
                  <option value="600">시작 10–25분</option>
                  <option value="1200">시작 20–35분</option>
                </select>
              </label>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                onConfig(
                  suggestComparison(
                    sessions,
                    profiles,
                    cfg.question,
                    cfg.days,
                    cfg.elapsedFrom,
                    cfg.elapsedTo,
                    cfg.anchor,
                  ),
                )
              }
            >
              조건 다시 제안
            </Button>
            <p className="fine">
              제안은 공통 관측 지원량을 기준으로 합니다. 심박 차이나 개선 폭은
              사용하지 않습니다.
            </p>
          </details>
          <details
            className="journal-details"
            open={result.state === "insufficient"}
          >
            <summary>사용 구간과 비교 지원량</summary>
            <p className="fine">
              운동 구간:{" "}
              {cfg.phases.length
                ? cfg.phases.map((p) => `${p * 5}–${p * 5 + 5}분`).join(" · ")
                : "공통 구간 없음"}{" "}
              · 속도 안정성 문맥 120초 · 실제 분석 창 60초
            </p>
            <p className="fine">
              {view === "heart"
                ? `속도 폭 8% · 대상 페이스 ${pace(cfg.target / 1.08)}–${pace(cfg.target / 0.92)} /km`
                : `심박 ${num(cfg.target - 10)}–${num(cfg.target + 10)} bpm 부근`}
              에 부드러운 비중을 줍니다.
            </p>
            <div className="growth-table">
              {cfg.phases.map((p, i) => (
                <div key={p}>
                  <b>
                    {p * 5}–{p * 5 + 5}분
                  </b>
                  <span>
                    유효 {num(result.previous.phases[i]?.effective ?? 0, 1)} /{" "}
                    {num(result.recent.phases[i]?.effective ?? 0, 1)}회
                  </span>
                  <small>
                    실제 {view === "heart" ? "페이스" : "심박"}:{" "}
                    {view === "heart"
                      ? `${pace(result.previous.phases[i]?.input ? 1000 / result.previous.phases[i].input! : null)} / ${pace(result.recent.phases[i]?.input ? 1000 / result.recent.phases[i].input! : null)} /km`
                      : `${num(result.previous.phases[i]?.input ?? null, 1)} / ${num(result.recent.phases[i]?.input ?? null, 1)} bpm`}{" "}
                    · 평균 시점{" "}
                    {elapsed(result.previous.phases[i]?.elapsed ?? 0)} /{" "}
                    {elapsed(result.recent.phases[i]?.elapsed ?? 0)}
                  </small>
                </div>
              ))}
            </div>
            <p className="fine">
              비교 가능: 각 기간 5회·3일·유효 5회·가중 10분 이상, 각 운동 구간
              유효 3회 이상. 참고 관측: 각 기간 3회·2일·유효 3회·가중 5분, 각
              구간 유효 2회 이상. 기기·실제 속도/심박·운동 시점도 맞아야 합니다.
            </p>
          </details>
          <section className="journal-section">
            <h2>사용한 러닝과 실제 구간</h2>
            {rows.length ? (
              rows.map((r) => (
                <details key={r.id} className="evidence-record">
                  <summary>
                    {r.date} · {r.period === "recent" ? "최근" : "이전"} ·{" "}
                    {view === "heart"
                      ? `${num(r.value, 1)} bpm`
                      : `${pace(r.value)} /km`}{" "}
                    · {r.windows.length}구간
                  </summary>
                  <div className="evidence-windows">
                    {r.windows.map((w, i) => (
                      <Button
                        variant="ghost"
                        key={i}
                        onClick={() =>
                          onOpen(r.id, { id: r.id, from: w.from, to: w.to })
                        }
                      >
                        {elapsed(w.from)}–{elapsed(w.to)} ·{" "}
                        {pace(1000 / w.speed)} /km · {num(w.hr)} bpm →
                      </Button>
                    ))}
                  </div>
                  <Button variant="ghost" onClick={() => onExclude(r.id, true)}>
                    이 러닝을 성장 비교에서 제외
                  </Button>
                </details>
              ))
            ) : (
              <p className="empty-note">
                이 조건에서 사용 가능한 안정 관측이 없습니다.
              </p>
            )}
          </section>
          <details className="journal-details">
            <summary>제외된 기록 {result.excluded.length}회와 이유</summary>
            {result.excluded.map((r) => (
              <div className="excluded-row" key={r.id}>
                <button className="text-button" onClick={() => onOpen(r.id)}>
                  {r.date} · {r.reason} →
                </button>
                {sessions.find((s) => s.id === r.id)?.growthExcluded && (
                  <Button
                    variant="ghost"
                    onClick={() => onExclude(r.id, false)}
                  >
                    다시 포함
                  </Button>
                )}
              </div>
            ))}
          </details>
          <details className="journal-details">
            <summary>속도와 심박의 관측 분포</summary>
            <div className="growth-chart">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart
                  margin={{ left: 0, right: 14, top: 12, bottom: 0 }}
                >
                  <CartesianGrid stroke="var(--rule)" strokeDasharray="2 5" />
                  <XAxis
                    type="number"
                    dataKey="pace"
                    tickFormatter={pace}
                    name="페이스"
                    domain={["dataMin", "dataMax"]}
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                  />
                  <YAxis
                    type="number"
                    dataKey="hr"
                    width={44}
                    domain={["dataMin - 5", "dataMax + 5"]}
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      const p = payload?.[0]?.payload;
                      return active && p ? (
                        <div className="chart-tooltip">
                          {p.date} · {elapsed(p.from)}–{elapsed(p.to)}
                          <br />
                          {pace(p.pace)} /km · {num(p.hr)} bpm
                        </div>
                      ) : null;
                    }}
                  />
                  {(["previous", "recent"] as const).map((period) => (
                    <Scatter
                      key={period}
                      data={rows
                        .filter((r) => r.period === period)
                        .flatMap((r) =>
                          r.windows.map((w) => ({
                            ...w,
                            id: r.id,
                            date: r.date,
                            pace: 1000 / w.speed,
                          })),
                        )}
                      fill={
                        period === "previous" ? "var(--muted)" : "var(--heart)"
                      }
                      fillOpacity={0.5}
                      isAnimationActive={false}
                      onClick={(p) =>
                        onOpen(p.payload.id, {
                          id: p.payload.id,
                          from: p.payload.from,
                          to: p.payload.to,
                        })
                      }
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="fine">선택한 두 기간의 안정 관측 창입니다.</p>
          </details>
          <details className="journal-details">
            <summary>계산 기준과 비교 한계</summary>
            <p className="fine">
              가까운 속도·심박의 관측에 큰 비중을 주고 러닝별 기여도를
              제한합니다. 같은 운동 시점의 구간을 같은 비중으로 맞춥니다. 표시용
              추세선은 계산에 쓰지 않습니다. 기간 대표값은 구간을 맞춘 가중
              평균, 점은 러닝별 관측 요약, 분포는 기여도로 가중한 중앙
              50%입니다. 분포는 신뢰구간이 아닙니다. 계산 버전{" "}
              {result.analysisVersion}。
            </p>
          </details>
        </>
      ) : view === "halves" ? (
        <>
          <div className="comparison-answer">
            <h2>전체 평균에 숨은 전후반 변화</h2>
            <p>
              전후반 비교 {halves.length}회 / 가져온 {sessions.length}회 ·
              엄격한 드리프트 {strict.length}회
            </p>
            <p className="fine">
              길이가 다른 러닝을 하나의 유지력 점수로 합치지 않습니다.
            </p>
          </div>
          {halves.map((p) => {
            const h = p.halves!;
            return (
              <button
                className="observation-row"
                key={p.id}
                onClick={() =>
                  onOpen(p.id, { id: p.id, from: h.from, to: h.to })
                }
              >
                <b>{sessions.find((s) => s.id === p.id)?.date}</b>
                <p>
                  심박 {num(h.first.hr)} → {num(h.last.hr)} bpm
                </p>
                <p>
                  페이스 {pace(h.first.speed ? 1000 / h.first.speed : null)} →{" "}
                  {pace(h.last.speed ? 1000 / h.last.speed : null)} /km
                </p>
                <small>
                  {elapsed(h.from)}–{elapsed(h.to)} · 각 절반 관측{" "}
                  {num(h.first.sec / 60, 1)}/{num(h.last.sec / 60, 1)}분 ·{" "}
                  {h.speedDifference > 0.05
                    ? "페이스도 달라진 전후반"
                    : "비슷한 평균속도"}{" "}
                  →
                </small>
              </button>
            );
          })}
          {!halves.length && (
            <p className="empty-note">
              각 절반 5분·심박과 속도 동시 관측 70% 이상인 구간이 필요합니다.
            </p>
          )}
          <details className="journal-details">
            <summary>엄격한 드리프트 · {strict.length}회</summary>
            {strict.map((p) => (
              <button
                key={p.id}
                className="observation-row"
                onClick={() =>
                  onOpen(p.id, {
                    id: p.id,
                    from: p.drift!.from,
                    to: p.drift!.to,
                  })
                }
              >
                {sessions.find((s) => s.id === p.id)?.date} ·{" "}
                {num(p.drift!.percent, 1)}% →
              </button>
            ))}
            <p className="fine">
              연속 20분·관측 80%·절반 속도 차이 5% 이내 조건입니다. 소수
              관측으로 장기 추세를 만들지 않습니다.
            </p>
          </details>
        </>
      ) : (
        <>
          <div className="comparison-answer">
            <h2>{titles[view]}</h2>
            <p className="fine">
              {view === "duration"
                ? "운동시간과 관측상 이어진 달리기 시간을 따로 봅니다. 같은 강도의 지구력 향상을 뜻하지 않습니다."
                : "파일에 있는 기록으로 운동 일수·시간·거리를 확인합니다. 빈 주는 운동하지 않았다는 뜻이 아닙니다."}
            </p>
          </div>
          <div className="segmented">
            {(["week", "month"] as const).map((p) => (
              <Button
                variant="ghost"
                key={p}
                aria-pressed={trainingPeriod === p}
                onClick={() => setTrainingPeriod(p)}
              >
                {p === "week" ? "주간" : "월간"}
              </Button>
            ))}
          </div>
          <div className="growth-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={recentTraining}
                margin={{ top: 12, right: 14, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--rule)"
                  strokeDasharray="2 5"
                />
                <XAxis
                  type="number"
                  dataKey="epoch"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v) => new Date(v).toISOString().slice(5, 10)}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                />
                <YAxis
                  width={40}
                  domain={[0, "auto"]}
                  tick={{ fontSize: 11, fill: "var(--muted)" }}
                />
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="chart-tooltip">
                        {payload[0].payload.date} ·{" "}
                        {num(payload[0].value as number, 1)}분
                      </div>
                    ) : null
                  }
                />
                <Bar
                  dataKey={view === "duration" ? "durationMedian" : "minutes"}
                  fill="var(--accent)"
                  maxBarSize={32}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="fine">
            최근 12개 {trainingPeriod === "week" ? "주" : "월"} ·{" "}
            {view === "duration" ? "기록당 운동시간 중앙값" : "운동시간 합계"}{" "}
            (분) · 날짜 간격을 보존합니다.
          </p>
          <div className="growth-table">
            {recentTraining.map((r) => (
              <div key={r.date}>
                <b>
                  {r.date}
                  {r.partial ? " · 기록 기준 진행 중" : ""}
                </b>
                <span>
                  {r.count ? `${r.days}일 · ${r.count}회` : "기록 없음"}
                </span>
                <small>
                  {view === "duration"
                    ? `기록당 운동시간 ${num(r.durationMedian, 1)}분 · 중앙 50% ${num(r.durationIqr[0], 1)}–${num(r.durationIqr[1], 1)}분 · 이어진 달리기 추정 중앙값 ${num(r.longestMedian, 1)}분 · 중앙 50% ${num(r.longestIqr[0], 1)}–${num(r.longestIqr[1], 1)}분`
                    : `${num(r.minutes, 1)}분 · ${num(r.distance, 1)}km`}
                </small>
                {r.ids.length > 0 && (
                  <details>
                    <summary>사용한 러닝 {r.ids.length}회</summary>
                    {r.ids.map((id) => (
                      <Button
                        variant="ghost"
                        key={id}
                        onClick={() => onOpen(id)}
                      >
                        {sessions.find((s) => s.id === id)?.date} →
                      </Button>
                    ))}
                  </details>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
