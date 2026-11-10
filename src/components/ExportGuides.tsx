import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import {
  EXPORT_GUIDES,
  PHONE_APPS,
  type ExportApp,
  type ExportPhone,
} from "../core/exportGuides";
import { Button } from "./ui/button";

function ExportGuideDialog({
  app,
  onClose,
  onChooseFile,
}: {
  app: ExportApp;
  onClose: () => void;
  onChooseFile: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const fileId = useId();
  const guide = EXPORT_GUIDES[app];

  useEffect(() => {
    const panel = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    panel?.showModal();
    closeButton.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      panel?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="export-guide-dialog"
      aria-labelledby={titleId}
      aria-describedby={fileId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        // Keep links reachable and wrap within the dialog across browser tab preferences.
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), a[href]",
          ),
        ).filter((element) => element.getClientRects().length > 0);
        if (!controls.length) return;
        const current = controls.findIndex(
          (element) => element === document.activeElement,
        );
        const next =
          current < 0
            ? event.shiftKey
              ? controls.length - 1
              : 0
            : (current + (event.shiftKey ? -1 : 1) + controls.length) %
              controls.length;
        event.preventDefault();
        controls[next].focus();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="export-guide-panel">
        <header className="export-guide-heading">
          <div>
            <p className="eyebrow">기록 내보내기</p>
            <h2 id={titleId}>{guide.name}에서 가져오기</h2>
          </div>
          <Button
            ref={closeButton}
            variant="ghost"
            className="icon-button"
            aria-label="내보내기 안내 닫기"
            onClick={onClose}
          >
            <X size={20} />
          </Button>
        </header>
        <div className="export-guide-body">
          <ol className="export-guide-steps">
            {guide.steps.map((step, index) => (
              <li key={step}>
                <span aria-hidden="true">{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
          <div className="export-guide-file" id={fileId}>
            <b>선택할 파일</b>
            <p>{guide.file}</p>
          </div>
          <p className="export-guide-note">{guide.note}</p>
          <a
            className="export-guide-link"
            href={guide.link.href}
            target="_blank"
            rel="noreferrer"
          >
            {guide.link.label}
            <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
        <footer className="export-guide-footer">
          <Button
            onClick={() => {
              onClose();
              onChooseFile();
            }}
          >
            파일 선택하기 <ArrowRight size={16} />
          </Button>
          <p className="fine">파일은 이 기기에서만 읽어요.</p>
        </footer>
      </div>
    </dialog>
  );
}

export function ExportGuides({ onChooseFile }: { onChooseFile: () => void }) {
  const [phone, setPhone] = useState<ExportPhone | null>(null);
  const [app, setApp] = useState<ExportApp | null>(null);
  const appsId = useId();

  return (
    <section className="export-guides" aria-label="앱별 내보내기 안내">
      <h2>사용하는 휴대폰을 골라주세요.</h2>
      <p className="export-guides-intro">
        앱에서 기록을 내보내는 방법을 안내해요.
      </p>
      <div
        className="export-phone-choices"
        role="group"
        aria-label="사용하는 휴대폰"
      >
        {(
          [
            ["iphone", "아이폰"],
            ["galaxy", "갤럭시"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            type="button"
            className="export-phone-choice"
            aria-pressed={phone === id}
            aria-controls={appsId}
            onClick={() => setPhone(id)}
          >
            {name}
            {phone === id && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div id={appsId} aria-live="polite">
        {phone && (
          <div className="export-apps">
            <p className="export-apps-label">
              사용하는 앱을 선택하면 안내가 열려요.
            </p>
            <div className="export-app-choices">
              {PHONE_APPS[phone].map((id) => (
                <button
                  key={id}
                  type="button"
                  className="export-app-choice"
                  aria-label={`${EXPORT_GUIDES[id].name} 내보내기 안내`}
                  aria-haspopup="dialog"
                  onClick={(event) => {
                    event.currentTarget.focus();
                    setApp(id);
                  }}
                >
                  <span>{EXPORT_GUIDES[id].name}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                  <small>{EXPORT_GUIDES[id].hint}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {app && (
        <ExportGuideDialog
          app={app}
          onClose={() => setApp(null)}
          onChooseFile={onChooseFile}
        />
      )}
    </section>
  );
}
