import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";

const PublicApp = lazy(() => import("./App").then((module) => ({ default: module.App })));
const AdminApp = lazy(() => import("./Admin").then((module) => ({ default: module.Admin })));

class RouteErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="loading-page" role="alert">
          <p>页面暂时无法打开，请重新加载后重试。</p>
          <button type="button" className="paper-button" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<div className="loading-page" role="status"><span>正在加载页面</span></div>}>
          <Routes>
            <Route path="/admin" element={<AdminApp />} />
            <Route path="*" element={<PublicApp />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
