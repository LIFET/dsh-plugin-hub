"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("DSH Plugin Hub route error", error.digest || "unknown");
  }, [error]);

  return (
    <main className="status-page">
      <span className="section-kicker">ERROR</span>
      <h1>页面暂时无法加载</h1>
      <p>数据读取出现异常，请稍后重试。</p>
      <div className="status-page__actions">
        <button className="primary-button" type="button" onClick={reset}>重新加载</button>
        <Link className="secondary-button" href="/">返回首页</Link>
      </div>
    </main>
  );
}
