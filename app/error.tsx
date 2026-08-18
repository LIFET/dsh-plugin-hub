"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("DSH Plugin Hub route error", error.digest || "unknown");
  }, [error]);
  const english = typeof document !== "undefined" && document.documentElement.lang.startsWith("en");

  return (
    <main className="status-page">
      <p>ERROR</p>
      <h1>{english ? "This page could not load" : "页面暂时无法加载"}</h1>
      <p>{english ? "Something went wrong while reading data. Please try again." : "数据读取出现异常，请稍后重试。"}</p>
      <div className="status-page__actions">
        <button className="primary-button" type="button" onClick={reset}>{english ? "Reload" : "重新加载"}</button>
        <Link className="secondary-button" href="/">{english ? "Back home" : "返回首页"}</Link>
      </div>
    </main>
  );
}
