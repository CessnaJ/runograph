import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="app-shell import-page">
          <h1>화면을 불러오지 못했어요</h1>
          <p className="subtle">
            새로고침한 뒤 ZIP 파일을 다시 선택해 주세요. 불러온 기록은
            새로고침하면 사라져요.
          </p>
          <Button onClick={() => location.reload()}>새로고침</Button>
        </main>
      );
    return this.props.children;
  }
}
