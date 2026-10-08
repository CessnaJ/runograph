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
import { duration, num, pace } from "../core/format";
import type { Profile, Summary } from "../core/types";
import { Button } from "./ui/button";
export function Dashboard({
  sessions,
  profiles,
  onOpen,
}: {
  sessions: Summary[];
  profiles: Profile[];
  onOpen: (id: string) => void;
}) {
  const stats = useMemo(
    () => aggregate(sessions, profiles),
    [sessions, profiles],
  );
  const months = useMemo(() => {
    const grouped = new Map<
      string,
      { month: string; distance: number | null; count: number }
    >();
    for (const s of sessions) {
      const key = s.date.slice(0, 7);
      const row = grouped.get(key) ?? { month: key, distance: null, count: 0 };
      if (s.distanceM !== null)
        row.distance = (row.distance ?? 0) + s.distanceM / 1000;
      row.count++;
      grouped.set(key, row);
    }
    return [...grouped.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [sessions]);
  const own = new Set(sessions.map((s) => s.id));
  const observations = profiles
    .filter((p) => own.has(p.id))
    .flatMap((p) => p.observations.map((o) => ({ ...o, id: p.id })))
    .slice(0, 5);
  const currentMonth = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR RUNNING JOURNAL</p>
        <h1>
          쌓인 거리,
          <br />
          나의 리듬.
        </h1>
        <p className="subtle">선택한 기간의 기록을 한눈에 읽어보세요.</p>
      </div>
      <div className="primary-stats">
        <div>
          <small>러닝</small>
          <strong>
            {num(stats.count)}
            <em>회</em>
          </strong>
        </div>
        <div>
          <small>거리</small>
          <strong>
            {num(stats.distanceM === null ? null : stats.distanceM / 1000, 1)}
            <em>km</em>
          </strong>
        </div>
        <div>
          <small>운동 시간</small>
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
      <p className="fine">
        거리·시간은 CSV 요약값. 거리 결측 {stats.distanceMissing}회·시간 결측{" "}
        {stats.durationMissing}회는 해당 합계에서 제외합니다. 평균 페이스는
        시간과 거리가 모두 유효한 {stats.paceSessions}회에서 총 운동시간 ÷ 총
        거리. 관측 평균 심박은 상세 {stats.hrSessions}회 ·{" "}
        {num(stats.hrSec / 60, 1)}분을 시간 가중했습니다. 최대 심박 출처:{" "}
        {stats.maxSource}.
      </p>
      <section className="journal-section">
        <div className="section-heading">
          <h2>월마다 쌓인 거리</h2>
          <span className="subtle">km · 기록 당시 날짜</span>
        </div>
        <div className="monthly-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={months}
              margin={{ left: 0, right: 10, top: 12, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--rule)"
                vertical={false}
                strokeDasharray="2 5"
              />
              <XAxis
                dataKey="month"
                tickFormatter={(v) => String(v).slice(2).replace("-", ".")}
                tick={{ fontSize: 12, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                width={34}
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="chart-tooltip">
                      {payload[0].payload.month} ·{" "}
                      {num(payload[0].payload.distance, 1)} km ·{" "}
                      {payload[0].payload.count}회
                    </div>
                  ) : null
                }
              />
              <Bar
                dataKey="distance"
                fill="var(--accent)"
                radius={[3, 3, 0, 0]}
                maxBarSize={44}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="month-list">
          {months.map((m) => (
            <span key={m.month}>
              {m.month} · {m.count}회
              {m.month === currentMonth ? " · 진행 중" : ""}
            </span>
          ))}
        </div>
      </section>
      <section className="journal-section">
        <div className="section-heading">
          <h2>기록에서 관찰한 변화</h2>
          <span className="subtle">진단 없이, 관측값으로</span>
        </div>
        {observations.length ? (
          observations.map((o, i) => (
            <button
              className="observation-row"
              key={i}
              onClick={() => onOpen(o.id)}
            >
              <span>{sessions.find((s) => s.id === o.id)?.date}</span>
              <h3>{o.title}</h3>
              <p>{o.evidence}</p>
              <small className="subtle">러닝 상세에서 근거와 한계 보기 →</small>
            </button>
          ))
        ) : (
          <p className="empty-note">
            {profiles.some((p) => own.has(p.id))
              ? "선택한 기록에서 분석 조건에 맞는 변화가 발견되지 않았습니다. 기준 심박은 러닝 상세에서 직접 정할 수 있습니다."
              : "읽을 수 있는 상세 관측이 없어 변화 분석을 제공할 수 없습니다."}
          </p>
        )}
      </section>
      <section className="journal-section">
        <div className="section-heading">
          <h2>최근 러닝</h2>
        </div>
        {sessions.slice(0, 3).map((s) => (
          <div key={s.id} className="recent-row">
            <div>
              <b>{s.date}</b>
              <p className="subtle">
                {num(s.distanceM === null ? null : s.distanceM / 1000, 2)} km ·{" "}
                {duration(s.durationMs)}
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
