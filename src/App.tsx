import { deviceLabel } from "./core/copy";
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
import {
  clearSavedRuns,
  commitSavedRuns,
  discardGeneration,
  loadSavedDetail,
  loadSavedRuns,
  updateSavedData,
} from "./core/storage";
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
const RunComparison = lazy(() =>
  import("./components/RunComparison").then((m) => ({
    default: m.RunComparison,
  })),
);
type Tab = "summary" | "runs" | "growth" | "compare";
function initialTab(): Tab {
  return location.hash === "#runs"
    ? "runs"
    : location.hash === "#compare"
      ? "compare"
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
    [pairIds, setPairIds] = useState<[string, string]>(["", ""]),
    [pairDetails, setPairDetails] = useState<[Detail, Detail] | null>(null),
    [pairLoading, setPairLoading] = useState(false),
    [pairError, setPairError] = useState(""),
    [savedGeneration, setSavedGeneration] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [saveProgress, setSaveProgress] = useState(""),
    [storageError, setStorageError] = useState(""),
    [forgetOpen, setForgetOpen] = useState(false),
    [deleting, setDeleting] = useState(false),
    [restoring, setRestoring] = useState(true),
    [theme, setTheme] = useState(
      () =>
        localStorage.getItem("runograph-theme") ??
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
    );
  const reportUrls = useRef(new Set<string>());
  const forgetPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (forgetOpen) {
      forgetPanel.current?.focus();
      forgetPanel.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    }
  }, [forgetOpen]);
  const savingGeneration = useRef<string | null>(null);
  const latestData = useRef(data);
  latestData.current = data;
  const returnTo = useRef<{ tab: Tab; scroll: number }>({
    tab: "runs",
    scroll: 0,
  });
  const worker = useRef<Worker | null>(null),
    sequence = useRef(0),
    input = useRef<HTMLInputElement>(null),
    current = useRef({ import: 0, detail: 0, pair: 0, save: 0 });
  useEffect(() => {
    let cancelled = false;
    const version = sequence.current;
    loadSavedRuns()
      .then((saved) => {
        if (cancelled || sequence.current !== version || !saved) return;
        setData(saved.data);
        setSavedGeneration(saved.generation);
        setTab("summary");
        location.hash = "summary";
      })
      .catch((error) => {
        if (!cancelled)
          setStorageError(
            error instanceof Error && error.message.includes("계산 버전")
              ? error.message
              : "이 브라우저의 기기 보관을 읽을 수 없어요. ZIP은 계속 불러올 수 있어요.",
          );
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (savedGeneration && data)
      void updateSavedData(savedGeneration, data).catch(() =>
        setStorageError("변경한 분석 설정을 기기에 저장하지 못했어요."),
      );
  }, [data, savedGeneration]);
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
      if (savingGeneration.current)
        void discardGeneration(savingGeneration.current).catch(() => {});
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
    current.current = { import: 0, detail: 0, pair: 0, save: 0 };
    if (savingGeneration.current)
      void discardGeneration(savingGeneration.current).catch(() => {});
    savingGeneration.current = null;
    setSaving(false);
    setSavedGeneration(null);
    setPairIds(["", ""]);
    setPairDetails(null);
    setPairLoading(false);
    setPairError("");
    setStorageError("");
    setForgetOpen(false);
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
    setProgress({ phase: "ZIP 안의 파일을 확인하고 있어요", percent: 0 });
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
        msg.type === "PAIR" &&
        msg.requestId === current.current.pair
      ) {
        setPairDetails(msg.details);
        setPairLoading(false);
      } else if (
        msg.type === "SAVE_PROGRESS" &&
        msg.requestId === current.current.save
      ) {
        setSaveProgress(`${msg.count} / ${msg.total}회 보관 중`);
      } else if (
        msg.type === "SAVED" &&
        msg.requestId === current.current.save
      ) {
        const snapshotData = latestData.current;
        if (snapshotData)
          void (async () => {
            try {
              const previous = await loadSavedRuns().catch(() => undefined);
              if (msg.requestId !== current.current.save) return;
              await commitSavedRuns({
                formatVersion: 1,
                analysisVersion: ANALYSIS_VERSION,
                generation: msg.generation,
                savedAt: new Date().toISOString(),
                data: snapshotData,
              });
              if (msg.requestId !== current.current.save) {
                await discardGeneration(msg.generation).catch(() => {});
                return;
              }
              savingGeneration.current = null;
              setSavedGeneration(msg.generation);
              setSaving(false);
              if (previous && previous.generation !== msg.generation)
                await discardGeneration(previous.generation).catch(() => {});
            } catch {
              if (msg.requestId !== current.current.save) return;
              setSaving(false);
              setStorageError(
                "기기 보관을 마치지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요.",
              );
              await discardGeneration(msg.generation).catch(() => {});
              savingGeneration.current = null;
            }
          })();
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
        } else if (msg.requestId === current.current.pair) {
          setPairError(msg.message);
          setPairLoading(false);
        } else if (msg.requestId === current.current.save) {
          setSaving(false);
          setStorageError(msg.message);
          savingGeneration.current = null;
        }
      }
    };
    next.onerror = () => {
      if (worker.current !== next) return;
      setBusy(false);
      setDetailLoading(false);
      setPairLoading(false);
      setSaving(false);
      if (savingGeneration.current)
        void discardGeneration(savingGeneration.current).catch(() => {});
      savingGeneration.current = null;
      setError(
        "기록을 읽는 도중 멈췄어요. 기기의 메모리가 부족할 수 있어요. 다른 탭을 닫고 ZIP 파일을 다시 선택해 주세요.",
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
    if (worker.current)
      worker.current.postMessage({ type: "DETAIL", requestId, id });
    else if (savedGeneration)
      void loadSavedDetail(savedGeneration, id)
        .then((saved) => {
          if (current.current.detail !== requestId) return;
          setDetail(saved ?? null);
          setDetailError(
            saved
              ? ""
              : "이 기록의 시간별 측정값이 없어요. 원본 ZIP을 다시 선택해 주세요.",
          );
          setDetailLoading(false);
        })
        .catch(() => {
          if (current.current.detail === requestId) {
            setDetailError(
              "보관한 측정값을 읽지 못했어요. ZIP을 다시 선택해 주세요.",
            );
            setDetailLoading(false);
          }
        });
    else {
      setDetailLoading(false);
      setDetailError("측정값을 다시 읽으려면 ZIP을 선택해 주세요.");
    }
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
  function selectPair(ids: [string, string]) {
    setPairIds(ids);
    setPairDetails(null);
    setPairError("");
    const requestId = ++sequence.current;
    current.current.pair = requestId;
    if (!ids[0] || !ids[1]) {
      setPairLoading(false);
      return;
    }
    setPairLoading(true);
    if (worker.current)
      worker.current.postMessage({ type: "PAIR", requestId, ids });
    else if (savedGeneration)
      void Promise.all(ids.map((id) => loadSavedDetail(savedGeneration, id)))
        .then((details) => {
          if (current.current.pair !== requestId) return;
          if (details[0] && details[1])
            setPairDetails(details as [Detail, Detail]);
          else
            setPairError(
              "선택한 기록의 시간별 측정값이 없어요. 원본 ZIP을 다시 선택해 주세요.",
            );
          setPairLoading(false);
        })
        .catch(() => {
          if (current.current.pair === requestId) {
            setPairError(
              "보관한 측정값을 읽지 못했어요. ZIP을 다시 선택해 주세요.",
            );
            setPairLoading(false);
          }
        });
    else {
      setPairLoading(false);
      setPairError("측정값을 다시 읽으려면 ZIP을 선택해 주세요.");
    }
  }
  function startComparison(id: string) {
    selectPair([id, ""]);
    changeTab("compare");
  }
  function saveLocally() {
    if (!worker.current || !data || saving) return;
    const generation = crypto.randomUUID();
    savingGeneration.current = generation;
    setSaving(true);
    setStorageError("");
    setSaveProgress("러닝 기록을 기기에 보관하고 있어요…");
    const requestId = ++sequence.current;
    current.current.save = requestId;
    worker.current.postMessage({ type: "SAVE", requestId, generation });
  }
  async function forgetSaved() {
    if (deleting) return;
    setDeleting(true);
    try {
      await clearSavedRuns();
      reset();
    } catch {
      setStorageError(
        "기기 보관을 지우지 못했어요. 브라우저의 사이트 데이터 설정에서 지울 수 있어요.",
      );
    } finally {
      setDeleting(false);
    }
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
              aria-label="불러온 기록 지우기"
              onClick={() => (savedGeneration ? setForgetOpen(true) : reset())}
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
      {forgetOpen && (
        <section
          className="storage-panel"
          role="alertdialog"
          aria-label="기기 보관 삭제 확인"
          ref={forgetPanel}
          tabIndex={-1}
        >
          <h2>기기에 보관한 러닝을 지울까요?</h2>
          <p>
            보관한 기록과 현재 화면을 지워요. 다시 보려면 원본 ZIP이 필요해요.
          </p>
          <div className="pair-actions">
            <Button disabled={deleting} onClick={() => void forgetSaved()}>
              {deleting ? "기기 보관을 지우고 있어요…" : "기기에서 지우고 닫기"}
            </Button>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setForgetOpen(false)}
            >
              취소
            </Button>
          </div>
        </section>
      )}
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        aria-label="삼성헬스 ZIP 불러오기"
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
            <span>기록을 서버로 보내지 않아요</span>
          </div>
          <p className="eyebrow">삼성헬스 러닝 기록</p>
          <h1>
            뛰고 난 뒤,
            <br />
            기록을 돌아보세요.
          </h1>
          <p className="intro-copy">
            이번 러닝의 전후반을 살펴보고,
            <br />
            지난 러닝을 골라 나란히 비교하세요.
          </p>
          {busy ? (
            <div className="import-progress" role="status">
              <div>
                <b>{progress.phase}</b>
                <span>{progress.percent ? `${progress.percent}%` : ""}</span>
              </div>
              <progress value={progress.percent} max="100" />
              <p className="fine">파일이 크면 시간이 걸릴 수 있어요.</p>
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
                삼성헬스 ZIP 불러오기
                <ArrowUpRight size={18} />
              </Button>
              <p className="fine">
                선택한 파일은 이 기기에서만 읽어요.
                <br />
                불러온 뒤 이 기기에 보관할 수 있어요.
              </p>
            </>
          )}
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          {restoring && (
            <p role="status" className="fine">
              기기에 보관한 러닝을 확인하고 있어요…
            </p>
          )}
          {storageError && (
            <p role="alert" className="fine">
              {storageError}
            </p>
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
              지난 기록과 비교
            </span>
          </div>
          <details className="import-help">
            <summary>ZIP은 어디에서 받나요?</summary>
            <p>
              삼성헬스의 설정에서 ‘개인 데이터 다운로드’를 찾아보세요.
              다운로드한 ZIP 파일을 그대로 선택하면 돼요. 메뉴 이름은 앱 버전에
              따라 달라질 수 있어요.
            </p>
            <p>
              압축을 풀지 않아도 돼요. 512 MB 이하의 ZIP 파일을 읽을 수 있어요.
              기기에 보관하지 않은 기록은 새로고침하면 다시 선택해야 해요.
            </p>
          </details>
          <details className="import-help">
            <summary>홈 화면에 앱으로 추가하기</summary>
            <p>
              Android에서는 브라우저 메뉴에서 ‘앱 설치’나 ‘홈 화면에 추가’를
              선택해 주세요. iPhone에서는 Safari의 공유 메뉴에서 ‘홈 화면에
              추가’를 선택해 주세요.
            </p>
            <p>
              지원 여부는 브라우저마다 달라요. 앱을 다시 열려면 인터넷 연결과
              보관하지 않은 기록은 ZIP 파일도 필요해요.
            </p>
          </details>
          <p className="fine">
            GPS·사진·프로필은 읽지 않아요. 사용 기록이나 오류도 외부로 보내지
            않아요.
          </p>
          <details className="import-help">
            <summary>기기 보관 관리</summary>
            <p>
              이 브라우저에 보관한 기록과 중단된 보관 데이터를 모두 지울 수
              있어요.
            </p>
            <Button variant="outline" onClick={() => setForgetOpen(true)}>
              기기 보관 지우기
            </Button>
          </details>
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
                    : "분석"}
              </button>
            ))}
          </nav>
          <main className="journal-main">
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            {tab !== "compare" && !(tab === "runs" && selected) && (
              <details className="global-filters">
                <summary>
                  {from || to || query ? "찾은 기록" : "전체 기록"} ·{" "}
                  {sessions.length}회 <span>기간·검색 설정</span>
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
                    전체 기록 보기
                  </Button>
                </div>
              </details>
            )}
            {data.warnings.length > 0 && !(tab === "runs" && selected) && (
              <details className="quality-warnings">
                <summary>기록 확인 안내 {data.warnings.length}건</summary>
                {data.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            <Suspense
              fallback={
                <div className="loading-panel" role="status">
                  화면을 준비하고 있어요…
                </div>
              }
            >
              {tab === "summary" &&
                (sessions.length ? (
                  <Dashboard
                    sessions={sessions}
                    profiles={data.profiles}
                    onOpen={openRun}
                    onCompare={startComparison}
                    onGrowth={() => {
                      setGrowthConfig(null);
                      setGrowthView("heart");
                      changeTab("growth");
                      window.scrollTo({ top: 0, behavior: "instant" });
                    }}
                  />
                ) : (
                  <p className="empty-note">
                    이 조건에 맞는 러닝이 없어요. 기간이나 검색어를 바꿔보세요.
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
                    이 조건에 맞는 러닝이 없어요. 기간이나 검색어를 바꿔보세요.
                  </p>
                ))}
              {tab === "compare" && (
                <RunComparison
                  sessions={data.sessions}
                  ids={pairIds}
                  details={pairDetails}
                  loading={pairLoading}
                  error={pairError}
                  onSelect={selectPair}
                  onOpen={openRun}
                  onBack={() => changeTab("summary")}
                />
              )}
              {tab === "runs" &&
                (selected ? (
                  <>
                    <Button
                      variant="ghost"
                      className="back-button"
                      onClick={backFromRun}
                    >
                      <ArrowLeft size={16} />
                      {returnTo.current.tab === "growth" ||
                      returnTo.current.tab === "compare"
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
                            ? " · 시간·거리 확인 필요"
                            : ""}
                        </span>
                      </div>
                      <p className="fine">
                        삼성헬스에 저장된 요약 ·{" "}
                        {deviceLabel(selected.deviceGroup)}
                        {selected.offsetMs === null
                          ? " · 시간대 정보가 없어 UTC 날짜로 표시"
                          : ""}
                      </p>
                    </div>
                    {detailLoading ? (
                      <div className="loading-chart" role="status">
                        시간별 측정값을 읽고 있어요…
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
                          "시간별 측정값을 읽을 수 없어 그래프를 보여드리지 못해요."}
                      </div>
                    )}
                    <section className="quality-warnings">
                      <Button
                        variant="outline"
                        onClick={() => startComparison(selected.id)}
                      >
                        이 러닝과 다른 기록 비교 →
                      </Button>
                      <details>
                        <summary>원본·분석 설정</summary>
                        <p className="fine">
                          삼성헬스 원본: {duration(selected.durationMs)} ·{" "}
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
                          /km · 요약 평균 심박 {num(selected.meanHr)} bpm. 원본
                          값은 변경하지 않아요.
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
                          <p>시간·거리에서 확인할 문제는 없어요.</p>
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
                          총 거리·운동시간 계산에서 제외
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
                            분할 기록으로 합계에 포함
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
                          지난 기록과 비교할 때 제외
                        </label>
                        <p className="fine">
                          요약값에 문제가 있어도 시간별 측정값은 비교에 쓸 수
                          있어요. 측정되지 않은 값은 채우지 않아요.
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
                        기록 상태
                        <select
                          aria-label="기록 상태 필터"
                          value={qualityFilter}
                          onChange={(e) => setQualityFilter(e.target.value)}
                        >
                          <option value="all">전체</option>
                          <option value="eligible">비교 구간 있는 기록</option>
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
                                ? "시간별 측정값 있음"
                                : s.status === "missing"
                                  ? "시간별 측정값 없음"
                                  : s.status === "limited"
                                    ? "일부 분석만 완료"
                                    : "측정값을 읽지 못함"}
                              {!usesSummary(s, "pace")
                                ? " · 시간·거리 확인 필요"
                                : ""}
                              {s.growthExcluded ? " · 비교에서 제외" : ""}
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
                      <p className="empty-note">
                        이 조건에 맞는 러닝이 없어요. 기록 상태나 검색 조건을
                        바꿔보세요.
                      </p>
                    )}
                  </>
                ))}
            </Suspense>
            <footer className="journal-footer">
              <section className="storage-panel" aria-label="기기 보관">
                <h2>
                  {savedGeneration
                    ? "이 기기에 보관 중이에요"
                    : "다음에도 바로 열어보세요"}
                </h2>
                <p className="fine">
                  러닝 날짜·운동량·심박·시간별 측정값을 이 브라우저에 보관해요.
                  원본 ZIP·GPS·사진·프로필은 보관하지 않아요. 공용 기기에서는
                  보관하지 마세요.
                </p>
                {savedGeneration ? (
                  <Button variant="ghost" onClick={() => setForgetOpen(true)}>
                    기기 보관 지우기
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      disabled={saving || !worker.current}
                      onClick={saveLocally}
                    >
                      {saving ? saveProgress : "이 기기에 러닝 보관"}
                    </Button>
                    <p className="fine">
                      선택하면 이전에 보관한 러닝을 현재 기록으로 바꿔요. 새
                      ZIP의 자동 병합은 하지 않아요.
                    </p>
                  </>
                )}
                {saving && (
                  <p role="status" className="fine">
                    보관이 끝나면 다음에 열 때 자동으로 불러와요.
                  </p>
                )}
                {storageError && <p role="alert">{storageError}</p>}
              </section>
              <div>
                <Button
                  variant="outline"
                  onClick={() => setReportOpen(!reportOpen)}
                >
                  분석 결과 저장
                </Button>
                <Button variant="ghost" onClick={() => input.current?.click()}>
                  다른 ZIP 선택
                </Button>
              </div>
              {reportOpen && (
                <div className="report-info">
                  <p>
                    현재 선택한 기록의 날짜·운동량·심박과 비교 조건을 저장해요.
                    파일 형식은 JSON이에요. 이름·기기 ID·GPS는 포함하지 않지만
                    건강 수치가 있으니 공유 전에 내용을 확인해 주세요.
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
                    JSON 파일로 저장
                  </Button>
                </div>
              )}
              <p>
                {savedGeneration
                  ? "보관한 기록은 이 브라우저에서 다시 볼 수 있어요. 사이트 데이터를 지우면 보관도 사라져요."
                  : "기기에 보관하지 않으면 새로고침할 때 ZIP이 다시 필요해요."}
                <br />
                기록의 변화를 보여드려요. 건강 상태를 진단하거나 운동을
                처방하지는 않아요.
              </p>
            </footer>
          </main>
        </>
      )}
    </div>
  );
}
