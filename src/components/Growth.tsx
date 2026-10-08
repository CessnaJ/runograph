import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  baselineObservations,
  growthRows,
  periodGrowth,
} from "../core/metrics";
import { median } from "../core/parser";
import { elapsed, num, pace } from "../core/format";
import type { Profile, Summary } from "../core/types";
import { Button } from "./ui/button";
export function Growth({
  sessions,
  profiles,
  onOpen,
}: {
  sessions: Summary[];
  profiles: Profile[];
  onOpen: (id: string) => void;
}) {
  const [center, setCenter] = useState(420),
    [period, setPeriod] = useState<"week" | "month">("month");
  const rows = useMemo(
    () => growthRows(sessions, profiles, center),
    [sessions, profiles, center],
  );
  const periods = useMemo(() => periodGrowth(rows, period), [rows, period]);
  const baseline = useMemo(() => baselineObservations(rows), [rows]);
  const own = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions]);
  const selectedProfiles = useMemo(
    () => profiles.filter((p) => own.has(p.id)),
    [profiles, own],
  );
  const scatter = useMemo(() => {
    const all = selectedProfiles.flatMap((p) =>
      p.bins.flatMap((bin) =>
        bin.hrs.map((hr) => ({ pace: bin.pace + 0.5, hr, id: p.id })),
      ),
    );
    const step = Math.max(1, Math.ceil(all.length / 900));
    return { data: all.filter((_, i) => i % step === 0), total: all.length };
  }, [selectedProfiles]);
  const eligible = rows.filter((r) => r.eligible),
    sampleCount = eligible.reduce((s, r) => s + r.samples, 0),
    drifts = selectedProfiles.filter((p) => p.drift !== null);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">A LITTLE FURTHER</p>
        <h1>
          같은 페이스,
          <br />
          다른 날의 나.
        </h1>
        <p className="subtle">
          비슷한 속도에서 심박이 어떻게 달랐는지 살펴보세요.
        </p>
      </div>
      <section className="journal-section">
        <div className="section-heading">
          <h2>페이스와 심박</h2>
        </div>
        <div className="growth-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="var(--rule)" strokeDasharray="2 5" />
              <XAxis
                type="number"
                dataKey="pace"
                name="페이스"
                domain={["dataMin", "dataMax"]}
                tickFormatter={pace}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="number"
                dataKey="hr"
                name="심박"
                domain={["dataMin - 5", "dataMax + 5"]}
                width={40}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="chart-tooltip">
                      {pace(payload[0].payload.pace)} /km ·{" "}
                      {num(payload[0].payload.hr)} bpm
                    </div>
                  ) : null
                }
              />
              <Scatter
                data={scatter.data}
                fill="var(--heart)"
                fillOpacity={0.35}
                isAnimationActive={false}
              />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="fine">
          X축: 페이스 (/km) · Y축: 심박 (bpm). 시작 5분·정지/걷기
          추정·결측·급격한 속도 전환을 제외한 동시 관측 {num(scatter.total)}
          표본. 화면에는 최대 900점을 표시하며 페이스는 1초 단위로 묶습니다.
          계산은 원본 표본을 사용합니다.
        </p>
      </section>
      <section className="journal-section">
        <h2>비교할 페이스 구간</h2>
        <label className="slider-label pace-control">
          중심 페이스 <b>{pace(center)} /km</b>
          <input
            aria-label="비교 페이스"
            type="range"
            min="240"
            max="600"
            step="5"
            value={center}
            onChange={(e) => setCenter(Number(e.target.value))}
          />
        </label>
        <p className="subtle">
          {pace(center - 15)}–{pace(center + 15)} /km · ±15초
        </p>
        <div className="comparison-stats">
          <div>
            <strong>{eligible.length}</strong>
            <span>적격 러닝</span>
          </div>
          <div>
            <strong>{num(sampleCount)}</strong>
            <span>동시 표본</span>
          </div>
          <div>
            <strong>{num(median(eligible.map((r) => r.hr!)))}</strong>
            <span>기록별 심박 중앙값의 중앙값 · bpm</span>
          </div>
        </div>
        <p className="fine">
          기록당 20표본 · 관측 3분 · 커버리지 70% 이상일 때 비교에 포함합니다.
          심박·속도가 함께 관측된 구간을 사용합니다. 기간당 적격 3회 미만은
          참고용입니다. 선택 기간의 {rows.length - eligible.length}회는 적격
          조건을 충족하지 못했습니다.
        </p>
        <div className="segmented period-toggle">
          <Button
            variant="ghost"
            aria-pressed={period === "week"}
            onClick={() => setPeriod("week")}
          >
            주간
          </Button>
          <Button
            variant="ghost"
            aria-pressed={period === "month"}
            onClick={() => setPeriod("month")}
          >
            월간
          </Button>
        </div>
        {periods.length ? (
          <>
            <div className="growth-chart trend-chart">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={periods}
                  margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    stroke="var(--rule)"
                    vertical={false}
                    strokeDasharray="2 5"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v) => String(v).slice(5)}
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={["dataMin - 5", "dataMax + 5"]}
                    width={40}
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <div className="chart-tooltip">
                          {payload[0].payload.date} ·{" "}
                          {num(payload[0].payload.hr)} bpm ·{" "}
                          {payload[0].payload.sessions}회
                        </div>
                      ) : null
                    }
                  />
                  <Line
                    type="linear"
                    dataKey="hr"
                    stroke="var(--heart)"
                    dot={{ r: 4 }}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="growth-table">
              {periods.map((p) => (
                <div key={p.date}>
                  <b>{p.date}</b>
                  <span>{num(p.hr)} bpm</span>
                  <small>
                    {p.sessions}회 · {p.samples}표본 ·{" "}
                    {p.eligible ? "관측 비교 가능" : "참고용"}
                  </small>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="empty-note">
            이 페이스 구간에서 비교에 필요한 관측이 부족합니다. 다른 구간을
            선택해 보세요.
          </p>
        )}
        <details className="journal-details">
          <summary>날짜별 원본 비교와 제외 이유</summary>
          {rows.map((r) => (
            <button
              key={r.id}
              className="growth-record"
              onClick={() => onOpen(r.id)}
            >
              <span>{r.date}</span>
              <b>{num(r.hr)} bpm</b>
              <small>
                {r.samples}표본 · {num(r.sec / 60, 1)}분 ·{" "}
                {num(r.coverage * 100)}% · {r.eligible ? "포함" : "조건 미달"}
              </small>
            </button>
          ))}
        </details>
      </section>
      <section className="journal-section">
        <h2>이전 기록과 다른 심박</h2>
        {baseline.length ? (
          baseline.slice(-5).map((r) => (
            <button
              className="observation-row"
              key={r.id}
              onClick={() => onOpen(r.id)}
            >
              <b>{r.date}</b>
              <p>
                {num(r.hr)} bpm · 이전 {r.count}회 중앙값 {num(r.base)} bpm
              </p>
              <small>
                {r.samples}표본 · 이전 기록의 중앙절대편차(MAD) 기준
              </small>
            </button>
          ))
        ) : (
          <p className="empty-note">
            이전 적격 5회와 변동폭(MAD)이 필요합니다. 현재 페이스 구간에서 비교
            조건에 맞는 차이가 없습니다.
          </p>
        )}
        <p className="fine">
          현재 기록은 기준 집합에서 제외합니다. MAD가 0이면 점수를 만들지
          않습니다. 차이가 훈련 효과나 이상 상태를 뜻하지는 않습니다.
        </p>
      </section>
      <section className="journal-section">
        <h2>후반 효율 변화</h2>
        <p className="subtle">같은 속도를 유지할 때의 관측 비교</p>
        {drifts.length ? (
          drifts.slice(0, 8).map((p) => (
            <button
              key={p.id}
              className="observation-row"
              onClick={() => onOpen(p.id)}
            >
              <b>{sessions.find((s) => s.id === p.id)?.date}</b>
              <p>
                {num(p.drift!.percent, 1)}% · 효율 {num(p.drift!.efficiency, 4)}{" "}
                (m/s)/bpm
              </p>
              <small>
                {elapsed(p.drift!.from)}–{elapsed(p.drift!.to)} ·{" "}
                {p.drift!.samples}표본 · {num(p.drift!.coverage * 100)}%
                커버리지
              </small>
            </button>
          ))
        ) : (
          <p className="empty-note">
            안정적으로 이어진 20분 구간이 없어 분석할 수 없습니다.
          </p>
        )}
        <p className="fine">
          시작 5분을 제외하고 연속 20분·커버리지 80%·전후반 평균 속도 차이 5%
          이내인 구간만 사용합니다. 효율 = 시간가중 평균 속도 ÷ 심박. 변화율 =
          100 × (전반 효율 − 후반 효율) ÷ 전반 효율. 양수는 후반 효율이 낮아진
          관측입니다.
        </p>
      </section>
      <p className="analysis-limit">
        모든 비교는 참고용 관측입니다. 기기·착용·날씨·경사·수면을 통제하지
        않았으며 같은 기기만 비교하는 필터는 아직 제공하지 않습니다. 건강 상태나
        훈련 효과를 단정하지 않습니다.
      </p>
    </>
  );
}
