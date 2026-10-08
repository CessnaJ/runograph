import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { aggregate } from "../core/metrics";
import {
  compare,
  suggestComparison,
  trainingRows,
  type CompareConfig,
} from "../core/analysis";
import { datedActivity } from "../core/quality";
import { duration, num, pace } from "../core/format";
import type { EvidenceRef, Profile, Summary } from "../core/types";
import { ComparisonHeadline, ComparisonPlot } from "./Growth";
import { Button } from "./ui/button";
export function Dashboard({
  sessions,
  profiles,
  onOpen,
  onGrowth,
  revision = 0,
}: {
  sessions: Summary[];
  profiles: Profile[];
  onOpen: (id: string, focus?: EvidenceRef) => void;
  onGrowth: (cfg: CompareConfig) => void;
  revision?: number;
}) {
  const stats = useMemo(
    () => aggregate(sessions, profiles),
    [sessions, profiles],
  );
  const raw = useMemo(
    () => aggregate(sessions, profiles, true),
    [sessions, profiles],
  );
  const cfg = useMemo(
    () => suggestComparison(sessions, profiles),
    [sessions, profiles],
  );
  const result = useMemo(
    () => compare(sessions, profiles, cfg, true, revision),
    [sessions, profiles, cfg, revision],
  );
  const months = useMemo(
    () => trainingRows(sessions, profiles, "month").slice(-12),
    [sessions, profiles],
  );
  const trainingCompare = useMemo(() => {
    const within = (range: [string, string]) => {
      const a = sessions.filter(
        (s) => s.date >= range[0] && s.date <= range[1] && datedActivity(s),
      );
      return {
        days: new Set(a.map((s) => s.date)).size,
        minutes: a.reduce((n, s) => n + (s.durationMs ?? 0) / 60000, 0),
        count: a.length,
      };
    };
    return {
      previous: within(result.periods.previous),
      recent: within(result.periods.recent),
    };
  }, [sessions, result.periods]);
  return (
    <>
      <div className="page-heading compact-heading">
        <h1>최근 러닝의 변화</h1>
        <p className="subtle">
          최근 {result.periods.recent.join("–")} · 이전{" "}
          {result.periods.previous.join("–")}
        </p>
      </div>
      <section className="summary-comparison">
        <h3>비슷한 속도에서 심박이 달라졌나?</h3>
        <p className="fine">
          {pace(cfg.target)} /km 부근 ·{" "}
          {cfg.device === "all" ? "기기 혼합" : cfg.device}
        </p>
        <ComparisonHeadline result={result} />
        <ComparisonPlot result={result} onOpen={onOpen} compact />
        <Button variant="outline" onClick={() => onGrowth(cfg)}>
          비교 조건과 근거 보기 →
        </Button>
      </section>
      <section className="journal-section training-answer">
        <h2>운동량은 어떻게 달라졌나?</h2>
        <p>
          운동 일수 {trainingCompare.previous.days} →{" "}
          {trainingCompare.recent.days}일 · 운동시간{" "}
          {num(trainingCompare.previous.minutes)} →{" "}
          {num(trainingCompare.recent.minutes)}분
        </p>
        <p className="fine">
          같은 길이의 두 기간에서 품질 조건에 맞는 기록 기준입니다. 수행량
          변화이며 체력 향상 수치가 아닙니다.
        </p>
      </section>
      <section className="journal-section">
        <div className="section-heading">
          <h2>선택한 기록의 운동량</h2>
          <span className="subtle">가져온 {stats.count}회</span>
        </div>
        <div className="primary-stats">
          <div>
            <small>활동 일수</small>
            <strong>
              {new Set(sessions.filter(datedActivity).map((s) => s.date)).size}
              <em>일</em>
            </strong>
          </div>
          <div>
            <small>거리 · 사용 {stats.distanceSessions}회</small>
            <strong>
              {num(stats.distanceM === null ? null : stats.distanceM / 1000, 1)}
              <em>km</em>
            </strong>
          </div>
          <div>
            <small>운동시간 · 사용 {stats.durationSessions}회</small>
            <strong className="time-stat">{duration(stats.durationMs)}</strong>
          </div>
        </div>
        <div className="secondary-stats">
          <div>
            <span>전체 평균 페이스</span>
            <b>
              {pace(stats.pace)} <small>/km</small>
            </b>
          </div>
          <div>
            <span>기록 중앙 페이스</span>
            <b>
              {pace(stats.medianPace)} <small>/km</small>
            </b>
          </div>
          <div>
            <span>관측 평균 심박</span>
            <b>
              {num(stats.meanHr)} <small>bpm</small>
            </b>
          </div>
          <div>
            <span>최대 심박</span>
            <b>
              {num(stats.maxHr)} <small>bpm</small>
            </b>
          </div>
        </div>
        <details>
          <summary>원본 합계 보기 · 제외와 출처</summary>
          <p className="fine">
            삼성 CSV 원본 합계:{" "}
            {num(raw.distanceM === null ? null : raw.distanceM / 1000, 2)}km ·{" "}
            {duration(raw.durationMs)}. 가져온 {raw.count}회 중 거리 사용{" "}
            {stats.distanceSessions}회, 시간 사용 {stats.durationSessions}회,
            평균 페이스 사용 {stats.paceSessions}회. 짧거나 요약 확인이 필요한
            값은 기본 집계에서 보류합니다. 관측 심박은 상세 {stats.hrSessions}회
            · {num(stats.hrSec / 60, 1)}분의 시간가중 평균. 최대 심박 출처:{" "}
            {stats.maxSource}.
          </p>
        </details>
      </section>
      <section className="journal-section">
        <div className="section-heading">
          <h2>월별 거리</h2>
          <span className="subtle">최근 12개월 · km</span>
        </div>
        <div className="monthly-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={months}
              margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--rule)"
                vertical={false}
                strokeDasharray="2 5"
              />
              <XAxis
                type="number"
                dataKey="epoch"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) =>
                  new Date(v).toISOString().slice(2, 7).replace("-", ".")
                }
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={34}
                domain={[0, "auto"]}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="chart-tooltip">
                      {payload[0].payload.date.slice(0, 7)} ·{" "}
                      {num(payload[0].payload.distance, 1)}km ·{" "}
                      {payload[0].payload.days}일
                    </div>
                  ) : null
                }
              />
              <Bar
                dataKey="distance"
                fill="var(--accent)"
                maxBarSize={36}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="month-list">
          {months.map((m) => (
            <span key={m.date}>
              {m.date.slice(0, 7)} ·{" "}
              {m.count ? `${m.days}일 / ${m.count}회` : "기록 없음"}
              {m.partial ? " · 기록 기준 진행 중" : ""}
            </span>
          ))}
        </div>
      </section>
      <section className="journal-section">
        <h2>최근 러닝</h2>
        {sessions.slice(0, 3).map((s) => (
          <div key={s.id} className="recent-row">
            <div>
              <b>{s.date}</b>
              <p className="subtle">
                {num(s.distanceM === null ? null : s.distanceM / 1000, 2)}km ·{" "}
                {duration(s.durationMs)}
                {s.quality?.length ? " · 품질 안내 있음" : ""}
              </p>
            </div>
            <Button variant="ghost" onClick={() => onOpen(s.id)}>
              자세히 →
            </Button>
          </div>
        ))}
      </section>
    </>
  );
}
