import { GROWTH_QUESTIONS, deviceLabel } from "../core/copy";
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
  const displayDiff = diff === null ? null : Math.round(diff * 10) / 10;
  const message =
    result.state === "insufficient"
      ? "이 조건에서는 비교할 기록이 부족해요."
      : result.state === "conditions"
        ? "조건이 달라 직접 비교하기 어려워요."
        : result.state === "sensitive" && result.sensitivity?.directionChanged
          ? "설정에 따라 차이의 방향이 뒤바뀌어요."
          : diff === null
            ? "비교에 쓸 측정값이 없어요."
            : displayDiff === 0
              ? "두 기간의 평균이 비슷해요."
              : isHeart
                ? `최근 심박이 ${diff < 0 ? "낮아졌어요" : "높아졌어요"}.`
                : `최근 페이스가 ${diff < 0 ? "빨라졌어요" : "느려졌어요"}.`;
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
          {num(Math.abs(displayDiff ?? 0), 1)}{" "}
          <small>
            {isHeart ? "bpm" : "초/km"}{" "}
            {displayDiff === 0
              ? "차이 (반올림)"
              : isHeart
                ? diff < 0
                  ? "낮음"
                  : "높음"
                : diff < 0
                  ? "빨라짐"
                  : "느려짐"}
            {displayDiff !== 0 && " · 이전보다"}
          </small>
        </p>
      )}
      <p className="subtle">
        이전 {result.previous.count}회 · 최근 {result.recent.count}회
      </p>
      {result.baseState === "conditions" && result.reason[0] && (
        <p className="fine">{result.reason[0]}</p>
      )}
      {result.state === "reference" && (
        <p className="fine">비교할 기록이 적어 참고로만 봐주세요.</p>
      )}
      {result.state === "insufficient" && result.reason[0] && (
        <p className="fine">{result.reason[0]}</p>
      )}
      <p className="fine">날씨와 코스 차이는 반영하지 않았어요.</p>
      {result.state === "sensitive" &&
        !result.sensitivity?.directionChanged && (
          <p className="fine">
            확인한 설정에서 차이의 방향은 같았어요. 다만 비교 조건의 충족 여부가
            달라 참고로 봐주세요.
          </p>
        )}
      <details className="comparison-notes">
        <summary>비교 조건·확인 사항</summary>
        {result.reason.map((r) => (
          <p className="fine" key={r}>
            {r}
          </p>
        ))}
        {result.sensitivity && (
          <p className="fine">
            비교 범위 변경·러닝 한 회 제외 시 차이 (최근 − 이전):{" "}
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
                  가중 시간 {num(r.sec / 60, 1)}분 · 측정 {r.samples}개
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
        <p className="chart-empty">이 조건에 맞는 측정 구간이 없어요.</p>
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
  const titles = GROWTH_QUESTIONS;
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
              {view === "heart" ? "비교 페이스 (/km)" : "비교 심박 (bpm)"}
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
            {cfg.device === "all" ? "모든 기기" : deviceLabel(cfg.device)}
          </p>
          <ComparisonHeadline result={result} />
          <ComparisonPlot result={result} onOpen={onOpen} />
          <p className="fine">
            회색은 이전, 녹색은 최근 러닝이에요. 점을 누르면 비교 구간을 볼 수
            있어요. 점선은 평균, 옅은 띠는 기록별 범위(중앙 50%)예요.
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
                    기록별 범위 (중앙 50%){" "}
                    {p.iqr
                      ? view === "heart"
                        ? `${num(p.iqr[0], 1)}–${num(p.iqr[1], 1)} bpm`
                        : `${pace(p.iqr[0])}–${pace(p.iqr[1])} /km`
                      : "—"}
                  </span>
                  <span>
                    유효 기록 {num(p.effective, 1)}회 · 가중 시간{" "}
                    {num(p.sec / 60, 1)}분 · 측정 {p.samples}개
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
                비교 기준일
                <input
                  aria-label="비교 기준일"
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
                  <option value="all">모든 기기 함께</option>
                  {devices.map((d) => (
                    <option key={d} value={d}>
                      {deviceLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                달리기 시작 후
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
                  <option value="300">5–20분 구간</option>
                  <option value="600">10–25분 구간</option>
                  <option value="1200">20–35분 구간</option>
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
              조건 다시 찾기
            </Button>
            <p className="fine">두 기간 모두 측정값이 충분한 조건을 찾아요.</p>
          </details>
          <details
            className="journal-details"
            open={result.state === "insufficient"}
          >
            <summary>비교에 쓴 구간·기록 수</summary>
            <p className="fine">
              운동 구간:{" "}
              {cfg.phases.length
                ? cfg.phases.map((p) => `${p * 5}–${p * 5 + 5}분`).join(" · ")
                : "공통 구간 없음"}{" "}
              · 2분간 속도가 안정적인지 확인한 뒤 마지막 1분을 비교
            </p>
            <p className="fine">
              {view === "heart"
                ? `속도 차이 8% 이내 · 페이스 ${pace(cfg.target / 1.08)}–${pace(cfg.target / 0.92)} /km`
                : `심박 ${num(cfg.target - 10)}–${num(cfg.target + 10)} bpm 부근`}
              의 측정값을 써요. 목표에 가까울수록 더 많이 반영해요.
            </p>
            <div className="growth-table">
              {cfg.phases.map((p, i) => (
                <div key={p}>
                  <b>
                    {p * 5}–{p * 5 + 5}분
                  </b>
                  <span>
                    유효 기록 (이전 / 최근){" "}
                    {num(result.previous.phases[i]?.effective ?? 0, 1)} /{" "}
                    {num(result.recent.phases[i]?.effective ?? 0, 1)}회
                  </span>
                  <small>
                    실제 {view === "heart" ? "페이스" : "심박"}:{" "}
                    {view === "heart"
                      ? `${pace(result.previous.phases[i]?.input ? 1000 / result.previous.phases[i].input! : null)} / ${pace(result.recent.phases[i]?.input ? 1000 / result.recent.phases[i].input! : null)} /km`
                      : `${num(result.previous.phases[i]?.input ?? null, 1)} / ${num(result.recent.phases[i]?.input ?? null, 1)} bpm`}{" "}
                    · 달리기 시작 후 평균{" "}
                    {elapsed(result.previous.phases[i]?.elapsed ?? 0)} /{" "}
                    {elapsed(result.recent.phases[i]?.elapsed ?? 0)}
                  </small>
                </div>
              ))}
            </div>
            <p className="fine">
              유효 기록·가중 시간은 비교 조건에 가까운 정도를 반영한 값이에요.
              일부 러닝에 비중이 몰리면 유효 기록 수는 실제 횟수보다 작아져요.
            </p>
            <p className="fine">
              비교 가능(각 기간): 5회·3일·유효 5회·가중 10분, 구간별 유효 3회
              이상. 참고용: 3회·2일·유효 3회·가중 5분, 구간별 유효 2회 이상.
              기기·페이스·심박·운동 시점도 비슷해야 해요.
            </p>
          </details>
          <section className="journal-section">
            <h2>비교에 쓴 러닝</h2>
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
                    이 러닝 빼고 비교
                  </Button>
                </details>
              ))
            ) : (
              <p className="empty-note">
                속도가 안정적이고 측정값이 충분한 구간이 없어요. 비교 조건을
                바꿔보세요.
              </p>
            )}
          </section>
          <details className="journal-details">
            <summary>비교에서 뺀 기록 {result.excluded.length}회·이유</summary>
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
                    다시 비교에 포함
                  </Button>
                )}
              </div>
            ))}
          </details>
          <details className="journal-details">
            <summary>페이스별 심박 살펴보기</summary>
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
            <p className="fine">
              점 하나는 속도가 안정적이었던 1분 구간이에요. 누르면 해당 구간으로
              이동해요.
            </p>
          </details>
          <details className="journal-details">
            <summary>평균은 어떻게 계산하나요?</summary>
            <p className="fine">
              비교하려는 페이스·심박에 가까운 측정값을 더 많이 반영해요. 한
              러닝이 결과를 좌우하지 않도록 비중을 제한하고, 달리기 시작 후
              비슷한 시간의 구간끼리 비교해요. 각 구간의 평균을 같은 비중으로
              합친 값이 기간별 평균이에요. 화면의 심박 흐름선은 계산에 쓰지
              않아요. 계산 버전 {result.analysisVersion}.
            </p>
            <p className="fine">
              옅은 띠는 비교 비중을 반영했을 때 가운데 50%의 기록이 모인
              범위예요. 러닝마다 값이 얼마나 다른지 보여주며, 평균의 오차 범위를
              뜻하지는 않아요.
            </p>
          </details>
        </>
      ) : view === "halves" ? (
        <>
          <div className="comparison-answer">
            <h2>전반과 후반을 함께 살펴보세요</h2>
            <p>
              전체 {sessions.length}회 중 {halves.length}회에서 전후반을 비교할
              수 있어요.
            </p>
            <p className="fine">
              러닝마다 시간과 강도가 달라요. 각 기록의 심박과 페이스를 함께
              확인해 주세요.
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
                  {elapsed(h.from)}–{elapsed(h.to)} · 전반 / 후반 측정{" "}
                  {num(h.first.sec / 60, 1)}/{num(h.last.sec / 60, 1)}분 ·{" "}
                  {h.speedDifference > 0.05
                    ? "페이스 차이 5% 초과"
                    : "페이스 차이 5% 이내"}{" "}
                  →
                </small>
              </button>
            );
          })}
          {!halves.length && (
            <p className="empty-note">
              아직 전후반을 비교할 구간이 없어요. 전반·후반 각각 5분 이상이며,
              심박과 속도가 함께 측정된 시간이 70% 이상이어야 해요.
            </p>
          )}
          <details className="journal-details">
            <summary>심박 효율 변화 (드리프트) · {strict.length}회</summary>
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
              속도 대비 심박이 전후반에 얼마나 달라졌는지 보는 값이에요
              (드리프트). 연속 20분 이상, 측정된 시간 80% 이상, 전후반 속도 차이
              5% 이내인 구간만 써요. 기록이 적으면 장기 변화로 볼 수는 없어요.
            </p>
          </details>
        </>
      ) : (
        <>
          <div className="comparison-answer">
            <h2>
              {view === "duration"
                ? "운동시간과 연속 달리기"
                : "달린 날과 운동량"}
            </h2>
            <p className="fine">
              {view === "duration"
                ? "운동시간과 연속 달리기 시간을 따로 봐요. 연속 달리기는 속도로 추정하며, 시간 증가가 곧 지구력 향상을 뜻하지는 않아요."
                : "달린 날과 시간·거리를 주별, 월별로 확인해요. 기록이 없는 기간에도 운동했을 수 있어요."}
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
            최근 12{trainingPeriod === "week" ? "주" : "개월"} ·{" "}
            {view === "duration" ? "러닝별 운동시간 중앙값" : "총 운동시간"}{" "}
            (분)
          </p>
          {view === "duration" && (
            <p className="fine">
              중앙값은 시간을 짧은 순서로 놓았을 때 가운데 값이에요. 중앙 50%는
              가운데 절반의 기록이 모인 범위예요.
            </p>
          )}
          <div className="growth-table">
            {recentTraining.map((r) => (
              <div key={r.date}>
                <b>
                  {r.date}
                  {r.partial ? " · 마지막 기록까지" : ""}
                </b>
                <span>
                  {r.count ? `${r.days}일 · ${r.count}회` : "기록 없음"}
                </span>
                {view === "duration" ? (
                  <>
                    <small>
                      운동시간 중앙값 {num(r.durationMedian, 1)}분 · 중앙 50%{" "}
                      {num(r.durationIqr[0], 1)}–{num(r.durationIqr[1], 1)}분
                    </small>
                    <small>
                      연속 달리기(추정) 중앙값 {num(r.longestMedian, 1)}분 ·
                      중앙 50% {num(r.longestIqr[0], 1)}–
                      {num(r.longestIqr[1], 1)}분
                    </small>
                  </>
                ) : (
                  <small>
                    {num(r.minutes, 1)}분 · {num(r.distance, 1)}km
                  </small>
                )}
                {r.ids.length > 0 && (
                  <details>
                    <summary>계산에 쓴 러닝 {r.ids.length}회</summary>
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
