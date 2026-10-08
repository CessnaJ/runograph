import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  FileArchive,
  Leaf,
  Moon,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { aggregate } from "./core/metrics";
import { duration, issueLabel, num, pace } from "./core/format";
import {
  ANALYSIS_VERSION,
  compare,
  suggestComparison,
  type CompareConfig,
} from "./core/analysis";
import { summaryPace, usesSummary } from "./core/quality";
import type { GrowthView } from "./components/Growth";
import type {
  Dataset,
  Detail,
  EvidenceRef,
  Summary,
  WorkerResponse,
} from "./core/types";
const Dashboard = lazy(() =>
  import("./components/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Growth = lazy(() =>
  import("./components/Growth").then((m) => ({ default: m.Growth })),
);
const RunChart = lazy(() =>
  import("./components/RunChart").then((m) => ({ default: m.RunChart })),
);
type Tab = "summary" | "runs" | "growth";
function initialTab(): Tab {
  return location.hash === "#runs"
    ? "runs"
    : location.hash === "#growth"
      ? "growth"
      : "summary";
}
function downloadReport(
  data: Dataset,
  sessions: Summary[],
  urls: Set<string>,
  activeConfig: CompareConfig | null,
) {
  const ids = new Set(sessions.map((s) => s.id));
  const profiles = data.profiles.filter((p) => ids.has(p.id));
  const report = {
    app: "runograph",
    calculationVersion: ANALYSIS_VERSION,
    inputRevision: data.revision ?? 0,
    generatedAt: new Date().toISOString(),
    scope: "선택한 기간",
    basis: {
      distance: "CSV 요약",
      duration: "CSV 운동시간",
      meanHeartRate: "상세 관측 구간 시간가중",
      pace: "유효 운동시간 / 동일 기록의 거리",
    },
    aggregate: aggregate(sessions, profiles),
    rawAggregate: aggregate(sessions, profiles, true),
    comparisons: (["heart", "pace"] as const).map((question) => {
      const c = compare(
        sessions,
        profiles,
        activeConfig?.question === question
          ? activeConfig
          : suggestComparison(sessions, profiles, question),
        true,
        data.revision ?? 0,
      );
      return {
        question,
        target: c.config.target,
        width: c.config.width,
        elapsedRangeSec: [c.config.elapsedFrom, c.config.elapsedTo],
        matchedPhaseStartsSec: c.config.phases.map((p) => p * 300),
        deviceFilter:
          c.config.device === "all"
            ? "mixed"
            : c.config.device === "출처 미상"
              ? "unknown"
              : "single-local-group",
        periods: c.periods,
        status: c.state,
        difference: c.state === "insufficient" ? null : c.difference,
        previous: {
          value: c.previous.value,
          runs: c.previous.count,
          effectiveRuns: c.previous.effective,
          weightedSeconds: c.previous.sec,
        },
        recent: {
          value: c.recent.value,
          runs: c.recent.count,
          effectiveRuns: c.recent.effective,
          weightedSeconds: c.recent.sec,
        },
        reasons: c.reason,
        sensitivity: c.sensitivity,
      };
    }),
    sessions: sessions.map((s) => ({
      date: s.date,
      durationMs: s.durationMs,
      distanceM: s.distanceM,
      meanHeartRateBpm: s.meanHr,
      maxHeartRateBpm: s.maxHr,
      detailStatus: s.status,
      quality: s.issues.map(issueLabel),
      summaryInclusion: s.inclusion ?? "default",
      growthExcluded: s.growthExcluded ?? false,
    })),
    limitations: [
      "결측과 긴 공백은 보간하지 않음",
      "기기·날씨·경사 등 조건을 통제하지 않음",
      "의료 진단 또는 운동 처방이 아님",
      "날짜와 건강 수치를 포함한 개인용 리포트",
    ],
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  urls.add(url);
  const link = document.createElement("a");
  link.href = url;
  link.download = "runograph-report.json";
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    urls.delete(url);
  }, 1000);
}
export default function App() {
  const [data, setData] = useState<Dataset | null>(null),
    [tab, setTab] = useState<Tab>(initialTab),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState({ phase: "", percent: 0 }),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(""),
    [query, setQuery] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [reportOpen, setReportOpen] = useState(false),
    [growthConfig, setGrowthConfig] = useState<CompareConfig | null>(null),
    [growthView, setGrowthView] = useState<GrowthView>("heart"),
    [focus, setFocus] = useState<EvidenceRef | undefined>(),
    [qualityFilter, setQualityFilter] = useState("all"),
    [order, setOrder] = useState("latest"),
    [theme, setTheme] = useState(
      () =>
        localStorage.getItem("runograph-theme") ??
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
  const reportUrls = useRef(new Set<string>());
  const returnTo = useRef<{ tab: Tab; scroll: number }>({
    tab: "runs",
    scroll: 0,
  });
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0),
    input = useRef<HTMLInputElement>(null),
    current = useRef({ import: 0, detail: 0 });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("runograph-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#191b18" : "#fffefa");
  }, [theme]);
  useEffect(() => {
    const fn = () => setTab(initialTab());
    addEventListener("hashchange", fn);
    return () => removeEventListener("hashchange", fn);
  }, []);
  useEffect(
    () => () => {
      worker.current?.terminate();
      for (const url of reportUrls.current) URL.revokeObjectURL(url);
      reportUrls.current.clear();
    },
    [],
  );
  const sessions = useMemo(
    () =>
      data?.sessions.filter(
        (s) =>
          (!from || s.date >= from) &&
          (!to || s.date <= to) &&
          (!query ||
            s.date.includes(query) ||
            `${(s.distanceM ?? 0) / 1000}`.includes(query)),
      ) ?? [],
    [data, from, to, query],
  );
  const selected = data?.sessions.find((s) => s.id === selectedId),
    profile = data?.profiles.find((p) => p.id === selectedId);
  const listedSessions = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            qualityFilter === "all" ||
            (qualityFilter === "review"
              ? (s.quality ?? []).some((q) => q.action === "review")
              : s.offsetMs !== null &&
                !s.growthExcluded &&
                (data?.profiles
                  .find((p) => p.id === s.id)
                  ?.windows?.reduce((n, w) => n + w.sec, 0) ?? 0) >= 180),
        )
        .sort((a, b) =>
          order === "latest" ? b.startMs - a.startMs : a.startMs - b.startMs,
        ),
    [sessions, data, qualityFilter, order],
  );
  function reset() {
    for (const url of reportUrls.current) URL.revokeObjectURL(url);
    reportUrls.current.clear();
    worker.current?.terminate();
    worker.current = null;
    sequence.current++;
    current.current = { import: 0, detail: 0 };
    setData(null);
    setBusy(false);
    setError("");
    setDetail(null);
    setDetailError("");
    setSelectedId(null);
    setDetailLoading(false);
    setQuery("");
    setFrom("");
    setTo("");
    setReportOpen(false);
    setGrowthConfig(null);
    setGrowthView("heart");
    setFocus(undefined);
    setQualityFilter("all");
    setOrder("latest");
    if (input.current) input.current.value = "";
  }
  function importFile(file: File) {
    reset();
    setBusy(true);
    setProgress({ phase: "파일 목록 확인 중", percent: 0 });
    const requestId = ++sequence.current;
    current.current.import = requestId;
    const next = new Worker(
      new URL("./worker/analyzer.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = next;
    next.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "PROGRESS" && msg.requestId === current.current.import)
        setProgress({ phase: msg.phase, percent: msg.percent });
      else if (
        msg.type === "DATA" &&
        msg.requestId === current.current.import
      ) {
        setData(msg.data);
        setBusy(false);
        setTab("summary");
        location.hash = "summary";
      } else if (
        msg.type === "DETAIL" &&
        msg.requestId === current.current.detail
      ) {
        setDetail(msg.detail);
        setDetailLoading(false);
      } else if (msg.type === "ERROR") {
        if (msg.requestId === current.current.import) {
          setError(msg.message);
          setBusy(false);
          next.terminate();
          worker.current = null;
        } else if (msg.requestId === current.current.detail) {
          setDetailError(msg.message);
          setDetailLoading(false);
        }
      }
    };
    next.onerror = () => {
      setBusy(false);
      setDetailLoading(false);
      setError(
        "분석 작업이 중단되었습니다. 메모리가 부족할 수 있습니다. 다른 탭을 닫고 ZIP을 다시 선택해 주세요.",
      );
      next.terminate();
      worker.current = null;
    };
    next.postMessage({ type: "IMPORT", requestId, file });
  }
  function openRun(id: string, evidence?: EvidenceRef) {
    if (tab !== "runs" || selectedId === null)
      returnTo.current = { tab, scroll: window.scrollY };
    setFocus(evidence);
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setTab("runs");
    location.hash = "runs";
    setDetailLoading(true);
    const requestId = ++sequence.current;
    current.current.detail = requestId;
    worker.current?.postMessage({ type: "DETAIL", requestId, id });
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function backFromRun() {
    const back = returnTo.current;
    setSelectedId(null);
    setDetail(null);
    setFocus(undefined);
    current.current.detail = 0;
    setTab(back.tab);
    location.hash = back.tab;
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        window.scrollTo({ top: back.scroll, behavior: "instant" }),
      ),
    );
  }
  function updateSession(id: string, updates: Partial<Summary>) {
    setData((old) =>
      old
        ? {
            ...old,
            revision: (old.revision ?? 0) + 1,
            sessions: old.sessions.map((s) =>
              s.id === id ? { ...s, ...updates } : s,
            ),
          }
        : old,
    );
  }
  function changeTab(value: Tab) {
    setTab(value);
    location.hash = value;
    setReportOpen(false);
    if (value === "runs" && selectedId === null) setDetail(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return (
    <div
      className={`app-shell ${tab === "runs" && selected ? "is-detail" : ""}`}
    >
      <header className="app-header">
        <button
          className="wordmark"
          onClick={() => changeTab("summary")}
          aria-label="runograph 요약"
        >
          <img src="/icons/icon.svg" alt="" width="26" height="26" />
          runograph<span> / 러닝 기록장</span>
        </button>
        <div className="header-actions">
          {data && (
            <Button
              variant="ghost"
              className="icon-button"
              aria-label="데이터 초기화"
              onClick={reset}
            >
              <RotateCcw size={18} />
            </Button>
          )}
          <Button
            variant="ghost"
            className="icon-button"
            aria-label={theme === "light" ? "어두운 모드" : "밝은 모드"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </Button>
        </div>
      </header>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        aria-label="삼성헬스 ZIP 선택"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importFile(file);
        }}
      />
      {!data ? (
        <main className="import-page">
          <div className="import-topline">
            <Leaf size={16} />
            <span>기록은 기기 안에 머무릅니다</span>
          </div>
          <p className="eyebrow">A QUIETER WAY TO READ YOUR RUNS</p>
          <h1>
            달린 만큼,
            <br />
            선명하게.
          </h1>
          <p className="intro-copy">
            삼성헬스의 러닝 기록을
            <br />
            조금 더 차분하게 읽는 방법.
          </p>
          <div className="import-art" aria-hidden="true">
            <svg viewBox="0 0 500 140" fill="none">
              <path
                d="M0 111 L25 110 L44 101 L67 105 L87 84 L110 95 L136 64 L153 70 L175 46 L190 75 L215 64 L236 32 L260 51 L280 28 L306 41 L328 19 L350 35 L374 18 L394 32 L415 19 L437 24 L460 10 L485 22 L500 17"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M0 125H500M0 75H500M0 25H500"
                stroke="var(--rule)"
                strokeDasharray="2 8"
              />
            </svg>
            <span>기록을 읽기 전의 빈 페이지</span>
          </div>
          {busy ? (
            <div className="import-progress" role="status">
              <div>
                <b>{progress.phase}</b>
                <span>{progress.percent ? `${progress.percent}%` : ""}</span>
              </div>
              <progress value={progress.percent} max="100" />
              <p className="fine">
                운동 CSV와 연결된 러닝 JSON만 읽고 있습니다.
              </p>
              <Button variant="outline" onClick={reset}>
                <X size={16} />
                분석 취소
              </Button>
            </div>
          ) : (
            <>
              <Button
                className="select-file"
                onClick={() => input.current?.click()}
              >
                <FileArchive size={18} />
                삼성헬스 ZIP 선택
                <ArrowUpRight size={18} />
              </Button>
              <p className="fine">
                서버 전송 없이 브라우저에서 분석합니다.
                <br />
                ZIP 원본과 건강 데이터는 저장하지 않습니다.
              </p>
            </>
          )}
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <div className="import-steps">
            <span>
              <Check size={14} />
              요약
            </span>
            <span>
              <Check size={14} />
              러닝 상세
            </span>
            <span>
              <Check size={14} />
              성장 비교
            </span>
          </div>
          <details className="import-help">
            <summary>ZIP은 어디에서 받나요?</summary>
            <p>
              삼성헬스 → 설정 → 개인 데이터 다운로드에서 내보낸 원본 ZIP을
              선택하세요. 메뉴 이름은 앱 버전에 따라 다를 수 있습니다.
            </p>
            <p>
              압축을 풀 필요가 없습니다. 새로고침하거나 탭을 닫으면 파일을 다시
              선택해야 합니다. 512 MB 이하 파일을 지원하며, 휴대폰에서는 다른
              탭을 닫고 분석해 주세요.
            </p>
          </details>
          <details className="import-help">
            <summary>홈 화면에 앱으로 추가하기</summary>
            <p>
              Android에서는 브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를,
              iPhone에서는 Safari 공유 메뉴의 홈 화면에 추가를 선택하세요. 메뉴
              이름과 지원 여부는 브라우저에 따라 다릅니다.
            </p>
            <p>
              앱을 열려면 인터넷 연결이 필요합니다. 기록은 저장하지 않으므로
              다시 열 때 ZIP을 선택해 주세요.
            </p>
          </details>
          <p className="fine">
            GPS·사진·프로필은 분석하지 않습니다. 외부 분석·오류 수집 서비스를
            사용하지 않습니다. 그래프 위의 선은 화면 소개용 도형이며 분석 수치가
            아닙니다.
          </p>
        </main>
      ) : (
        <>
          <nav className="main-tabs" aria-label="주요 화면">
            {(["summary", "runs", "growth"] as const).map((value) => (
              <button
                key={value}
                aria-current={tab === value ? "page" : undefined}
                onClick={() => changeTab(value)}
              >
                {value === "summary"
                  ? "요약"
                  : value === "runs"
                    ? "러닝"
                    : "성장"}
              </button>
            ))}
          </nav>
          <main className="journal-main">
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            {!(tab === "runs" && selected) && (
              <details className="global-filters">
                <summary>
                  {from || to || query ? "필터 적용 중" : "전체 기록"} ·{" "}
                  {sessions.length}회 <span>기간·검색</span>
                </summary>
                <div className="filter-fields">
                  <label>
                    시작 날짜
                    <input
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    끝 날짜
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                  <label className="search-field">
                    기록 검색
                    <input
                      placeholder="날짜 또는 거리 (km)"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFrom("");
                      setTo("");
                      setQuery("");
                    }}
                  >
                    필터 초기화
                  </Button>
                </div>
              </details>
            )}
            {data.warnings.length > 0 && !(tab === "runs" && selected) && (
              <details className="quality-warnings">
                <summary>처리 안내 {data.warnings.length}건</summary>
                {data.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            <Suspense
              fallback={
                <div className="loading-panel" role="status">
                  화면 준비 중…
                </div>
              }
            >
              {tab === "summary" &&
                (sessions.length ? (
                  <Dashboard
                    sessions={sessions}
                    profiles={data.profiles}
                    revision={data.revision ?? 0}
                    onOpen={openRun}
                    onGrowth={(cfg) => {
                      setGrowthConfig(cfg);
                      setGrowthView("heart");
                      changeTab("growth");
                      window.scrollTo({ top: 0, behavior: "instant" });
                    }}
                  />
                ) : (
                  <p className="empty-note">
                    선택한 기간에 러닝 기록이 없습니다.
                  </p>
                ))}
              {tab === "growth" &&
                (sessions.length ? (
                  <Growth
                    sessions={sessions}
                    profiles={data.profiles}
                    revision={data.revision ?? 0}
                    onOpen={openRun}
                    config={growthConfig}
                    onConfig={setGrowthConfig}
                    view={growthView}
                    onView={setGrowthView}
                    onExclude={(id, excluded) =>
                      updateSession(id, { growthExcluded: excluded })
                    }
                  />
                ) : (
                  <p className="empty-note">
                    선택한 기간에 러닝 기록이 없습니다.
                  </p>
                ))}
              {tab === "runs" &&
                (selected ? (
                  <>
                    <Button
                      variant="ghost"
                      className="back-button"
                      onClick={backFromRun}
                    >
                      <ArrowLeft size={16} />
                      {returnTo.current.tab === "growth"
                        ? "비교로 돌아가기"
                        : returnTo.current.tab === "summary"
                          ? "요약으로 돌아가기"
                          : "러닝 목록"}
                    </Button>
                    <div className="run-heading">
                      <h1>{selected.date}</h1>
                      <div className="run-summary">
                        <span>
                          {num(
                            selected.distanceM === null
                              ? null
                              : selected.distanceM / 1000,
                            2,
                          )}{" "}
                          km
                        </span>
                        <span>운동시간 {duration(selected.durationMs)}</span>
                        <span>
                          {pace(summaryPace(selected))} /km
                          {summaryPace(selected) === null &&
                          selected.durationMs &&
                          selected.distanceM
                            ? " · 요약 확인 필요"
                            : ""}
                        </span>
                      </div>
                      <p className="fine">
                        삼성 CSV 요약 · {selected.deviceGroup ?? "출처 미상"}
                        {selected.offsetMs === null
                          ? " · UTC 날짜 / 시간대 미확인"
                          : ""}
                      </p>
                    </div>
                    {detailLoading ? (
                      <div className="loading-chart" role="status">
                        상세 관측을 읽고 있습니다…
                      </div>
                    ) : detail ? (
                      <RunChart
                        key={detail.id}
                        detail={detail}
                        profile={profile}
                        focus={focus}
                      />
                    ) : (
                      <div className="empty-note">
                        {detailError ||
                          "이 기록에는 읽을 수 있는 상세 관측이 없습니다."}
                      </div>
                    )}
                    <section className="quality-warnings">
                      <details>
                        <summary>품질·원본 값과 분석 사용 설정</summary>
                        <p className="fine">
                          삼성 원본: {duration(selected.durationMs)} ·{" "}
                          {num(
                            selected.distanceM === null
                              ? null
                              : selected.distanceM / 1000,
                            2,
                          )}{" "}
                          km · 페이스{" "}
                          {pace(
                            selected.durationMs !== null && selected.distanceM
                              ? selected.durationMs / selected.distanceM
                              : null,
                          )}{" "}
                          /km · 요약 심박 {num(selected.meanHr)} bpm. 원본을
                          보정하지 않습니다.
                        </p>
                        {selected.quality?.map((q, i) => (
                          <p key={i}>
                            {q.evidence}
                            {q.from !== undefined
                              ? ` (${Math.round(q.from)}–${Math.round(q.to ?? q.from)}초)`
                              : ""}
                          </p>
                        ))}
                        {!selected.quality?.length && (
                          <p>추가 품질 안내가 없습니다.</p>
                        )}
                        <label className="check-setting">
                          <input
                            type="checkbox"
                            checked={selected.inclusion === "exclude"}
                            onChange={(e) =>
                              updateSession(selected.id, {
                                inclusion: e.target.checked
                                  ? "exclude"
                                  : "default",
                              })
                            }
                          />
                          요약 운동량에서 이 기록 제외
                        </label>
                        {selected.quality?.some(
                          (q) => q.code === "short-record",
                        ) && (
                          <label className="check-setting">
                            <input
                              type="checkbox"
                              checked={selected.inclusion === "include"}
                              onChange={(e) =>
                                updateSession(selected.id, {
                                  inclusion: e.target.checked
                                    ? "include"
                                    : "default",
                                })
                              }
                            />
                            짧은 기록을 유효한 분할 운동으로 포함
                          </label>
                        )}
                        <label className="check-setting">
                          <input
                            type="checkbox"
                            checked={selected.growthExcluded ?? false}
                            onChange={(e) =>
                              updateSession(selected.id, {
                                growthExcluded: e.target.checked,
                              })
                            }
                          />
                          성장 비교에서 이 러닝 제외
                        </label>
                        <p className="fine">
                          읽을 수 없는 값이나 관측 공백은 설정으로 유효 데이터가
                          되지 않습니다. 상세 분석과 요약 운동량은 각각
                          판단합니다.
                        </p>
                      </details>
                    </section>
                  </>
                ) : (
                  <>
                    <div className="page-heading compact-heading">
                      <h1>러닝 기록</h1>
                    </div>
                    <div className="list-controls">
                      <label>
                        데이터 상태
                        <select
                          aria-label="기록 품질 필터"
                          value={qualityFilter}
                          onChange={(e) => setQualityFilter(e.target.value)}
                        >
                          <option value="all">전체</option>
                          <option value="eligible">비교에 사용 가능</option>
                          <option value="review">확인 필요</option>
                        </select>
                      </label>
                      <label>
                        순서
                        <select
                          aria-label="기록 정렬"
                          value={order}
                          onChange={(e) => setOrder(e.target.value)}
                        >
                          <option value="latest">최신순</option>
                          <option value="oldest">과거순</option>
                        </select>
                      </label>
                    </div>
                    <div className="run-list">
                      {listedSessions.map((s) => (
                        <button
                          key={s.id}
                          className="run-row"
                          onClick={() => openRun(s.id)}
                        >
                          <div className="run-date">
                            {s.date}
                            <small>
                              {duration(s.durationMs)} · 심박 {num(s.meanHr)}{" "}
                              bpm ·{" "}
                              {s.status === "ready"
                                ? "상세 관측 있음"
                                : s.status === "missing"
                                  ? "상세 없음"
                                  : s.status === "limited"
                                    ? "분석 제한"
                                    : "상세 확인 필요"}
                              {!usesSummary(s, "pace")
                                ? " · 요약 확인 필요"
                                : ""}
                              {s.growthExcluded ? " · 성장 제외" : ""}
                            </small>
                          </div>
                          <div className="run-distance">
                            {num(
                              s.distanceM === null ? null : s.distanceM / 1000,
                              2,
                            )}
                            <small>km</small>
                          </div>
                          <div className="run-pace">
                            {pace(summaryPace(s))}
                            <small>/km</small>
                          </div>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                    </div>
                    {!listedSessions.length && (
                      <p className="empty-note">조건에 맞는 기록이 없습니다.</p>
                    )}
                  </>
                ))}
            </Suspense>
            <footer className="journal-footer">
              <div>
                <Button
                  variant="outline"
                  onClick={() => setReportOpen(!reportOpen)}
                >
                  리포트 다운로드
                </Button>
                <Button variant="ghost" onClick={() => input.current?.click()}>
                  다른 ZIP 선택
                </Button>
              </div>
              {reportOpen && (
                <div className="report-info">
                  <p>
                    선택한 기간의 날짜·운동량·심박 수치·계산 기준을 JSON으로
                    저장합니다. 이름·원본 파일명·UUID·GPS는 포함하지 않습니다.
                    건강 수치가 있는 파일이므로 개인용으로 보관해 주세요.
                  </p>
                  <Button
                    onClick={() => {
                      downloadReport(
                        data,
                        sessions,
                        reportUrls.current,
                        growthConfig,
                      );
                      setReportOpen(false);
                    }}
                  >
                    JSON 저장
                  </Button>
                </div>
              )}
              <p>
                기록은 이 탭의 메모리에만 있습니다.
                <br />
                분석은 관찰을 돕습니다. 의료 진단이나 운동 처방을 제공하지
                않습니다.
              </p>
            </footer>
          </main>
        </>
      )}
    </div>
  );
}
