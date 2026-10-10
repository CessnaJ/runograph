import { recap } from "../core/review";
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
import { dayNumber, trainingRows } from "../core/analysis";
import { datedActivity, summaryPace } from "../core/quality";
import { duration, elapsed, num, pace } from "../core/format";
import type { EvidenceRef, Profile, Summary } from "../core/types";
import { Button } from "./ui/button";
export function Dashboard({
  sessions,
  profiles,
  onOpen,
  onGrowth,
  onCompare,
}: {
  sessions: Summary[];
  profiles: Profile[];
  onOpen: (id: string, focus?: EvidenceRef) => void;
  onGrowth: () => void;
  onCompare: (id: string) => void;
}) {
  const latest = [...sessions].sort((a, b) => b.startMs - a.startMs)[0];
  const halves = profiles.find((p) => p.id === latest.id)?.halves;
  const answer = recap(halves);
  const stats = useMemo(
    () => aggregate(sessions, profiles),
    [sessions, profiles],
  );
  const raw = useMemo(
    () => aggregate(sessions, profiles, true),
    [sessions, profiles],
  );
  const anchor = [...sessions]
    .sort((a, b) => b.startMs - a.startMs)
    .find((s) => s.offsetMs !== null)?.date;
  const periods = useMemo(() => {
    const t = dayNumber(anchor ?? latest.date);
    const date = (day: number) =>
      new Date(day * 86400000).toISOString().slice(0, 10);
    return {
      previous: [date(t - 55), date(t - 28)] as [string, string],
      recent: [date(t - 27), date(t)] as [string, string],
    };
  }, [anchor, latest.date]);
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
      previous: within(periods.previous),
      recent: within(periods.recent),
    };
  }, [sessions, periods]);
  return (
    <>
      <div className="page-heading compact-heading">
        <p className="eyebrow">최근 러닝 · {latest.date}</p>
        <h1>이번 러닝 돌아보기</h1>
      </div>
      <section className="run-recap" aria-label="최근 러닝 복기">
        <div className="recap-stats">
          <div>
            <strong>
              {num(
                latest.distanceM === null ? null : latest.distanceM / 1000,
                2,
              )}
            </strong>
            <span>km</span>
          </div>
          <div>
            <strong>{duration(latest.durationMs)}</strong>
            <span>운동시간</span>
          </div>
          <div>
            <strong>{pace(summaryPace(latest))}</strong>
            <span>/km</span>
          </div>
        </div>
        {answer && halves ? (
          <>
            <p className="recap-context">전반에 비해 후반은</p>
            <h2>
              {answer.pace}.<br />
              {answer.heart}.
            </h2>
            <div className="half-readout">
              <span>
                전반 <b>{pace(1000 / halves.first.speed)}</b> /km ·{" "}
                {num(halves.first.hr)} bpm
              </span>
              <span>
                후반 <b>{pace(1000 / halves.last.speed)}</b> /km ·{" "}
                {num(halves.last.hr)} bpm
              </span>
            </div>
            <p className="fine">
              시작 후 {elapsed(halves.from)}–{elapsed(halves.to)} 구간을 같은
              길이로 나눠 비교했어요.
            </p>
            <Button
              onClick={() =>
                onOpen(latest.id, {
                  id: latest.id,
                  from: halves.from,
                  to: halves.to,
                })
              }
            >
              이 구간 그래프 보기 →
            </Button>
          </>
        ) : (
          <>
            <h2>이번 기록의 흐름을 살펴보세요.</h2>
            <p className="subtle">
              전후반 비교에는 시작 5분 이후, 각 절반에 5분 이상과 충분한
              심박·속도 측정이 필요해요.
            </p>
            <Button onClick={() => onOpen(latest.id)}>
              러닝 그래프 보기 →
            </Button>
          </>
        )}
        {latest.quality?.some((q) => q.action === "review") && (
          <p className="fine">
            저장된 시간·거리에 확인할 내용이 있어요. 상세에서 원본을 볼 수
            있어요.
          </p>
        )}
      </section>
      <section className="journal-section compare-entry">
        <h2>지난 러닝과 나란히 보기</h2>
        <p className="subtle">
          같은 코스나 비슷한 목적으로 달린 기록을 직접 골라보세요.
        </p>
        <Button
          variant="outline"
          disabled={sessions.length < 2}
          onClick={() => onCompare(latest.id)}
        >
          비교할 러닝 고르기 →
        </Button>
        {sessions.length < 2 && (
          <p className="fine">러닝이 2개 이상이면 비교할 수 있어요.</p>
        )}
      </section>
      <section className="journal-section training-answer">
        <h2>최근 4주, {trainingCompare.recent.days}일 달렸어요.</h2>
        <p>
          달린 날 {trainingCompare.previous.days} →{" "}
          {trainingCompare.recent.days}일 · 운동시간{" "}
          {num(trainingCompare.previous.minutes)} →{" "}
          {num(trainingCompare.recent.minutes)}분
        </p>
        <p className="fine">
          최근 {periods.recent.join("–")} · 이전 {periods.previous.join("–")}
        </p>
      </section>
      <details className="journal-details">
        <summary>전체 합계·월별 거리</summary>
        <section className="journal-section">
          <div className="section-heading">
            <h2>선택한 기록 한눈에</h2>
            <span className="subtle">러닝 {stats.count}회</span>
          </div>
          <div className="primary-stats">
            <div>
              <small>달린 날</small>
              <strong>
                {
                  new Set(sessions.filter(datedActivity).map((s) => s.date))
                    .size
                }
                <em>일</em>
              </strong>
            </div>
            <div>
              <small>총 거리 · {stats.distanceSessions}회</small>
              <strong>
                {num(
                  stats.distanceM === null ? null : stats.distanceM / 1000,
                  1,
                )}
                <em>km</em>
              </strong>
            </div>
            <div>
              <small>총 운동시간 · {stats.durationSessions}회</small>
              <strong className="time-stat">
                {duration(stats.durationMs)}
              </strong>
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
              <span>러닝별 중앙 페이스</span>
              <b>
                {pace(stats.medianPace)} <small>/km</small>
              </b>
            </div>
            <div>
              <span>측정된 평균 심박</span>
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
            <summary>원본 합계와 계산에 쓴 기록</summary>
            <p className="fine">
              전체 평균 페이스는 총 시간 ÷ 총 거리예요. 러닝별 중앙 페이스는
              러닝별 페이스를 느린 순서대로 놓았을 때 가운데 값이에요.
            </p>
            <p className="fine">
              삼성헬스 원본 합계:{" "}
              {num(raw.distanceM === null ? null : raw.distanceM / 1000, 2)}km ·{" "}
              {duration(raw.durationMs)}. 전체 {raw.count}회 중 거리 계산에{" "}
              {stats.distanceSessions}회, 시간 계산에 {stats.durationSessions}
              회, 평균 페이스 계산에 {stats.paceSessions}회를 썼어요. 1분
              미만이거나 시간·거리를 확인해야 하는 기록은 합계에서 뺐어요. 평균
              심박은 {stats.hrSessions}회에서 측정된 {num(stats.hrSec / 60, 1)}
              분을 바탕으로 계산했어요.{" "}
              {stats.maxHr === null
                ? "최대 심박 측정값은 없어요."
                : `최대 심박은 ${stats.maxSource}에서 가져왔어요.`}
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
                {m.partial ? " · 마지막 기록까지" : ""}
              </span>
            ))}
          </div>
        </section>
      </details>
      <section className="journal-section">
        <h2>최근 러닝</h2>
        {sessions.slice(0, 3).map((s) => (
          <div key={s.id} className="recent-row">
            <div>
              <b>{s.date}</b>
              <p className="subtle">
                {num(s.distanceM === null ? null : s.distanceM / 1000, 2)}km ·{" "}
                {duration(s.durationMs)}
                {s.quality?.length ? " · 확인할 내용 있음" : ""}
              </p>
            </div>
            <Button variant="ghost" onClick={() => onOpen(s.id)}>
              기록 보기 →
            </Button>
          </div>
        ))}
      </section>
      <Button variant="ghost" className="analysis-entry" onClick={onGrowth}>
        여러 기록의 추세 분석 →
      </Button>
    </>
  );
}
