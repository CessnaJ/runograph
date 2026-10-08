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
          <h1>화면을 다시 준비할게요.</h1>
          <p className="subtle">
            앱 파일을 읽지 못했거나 화면 처리 중 오류가 생겼습니다. 새로고침 후
            ZIP을 다시 선택해 주세요.
          </p>
          <Button onClick={() => location.reload()}>새로고침</Button>
        </main>
      );
    return this.props.children;
  }
}
