import Link from "next/link";
import { cookies } from "next/headers";

export default async function NotFound() {
  const english = (await cookies()).get("dsh-plugin-hub-lang")?.value === "en";
  return (
    <main className="status-page">
      <span className="section-kicker">404</span>
      <h1>{english ? "No plugin here" : "这里没有插件"}</h1>
      <p>{english ? "The link may have expired, or this plugin has not been listed yet." : "链接可能已经失效，或者这个插件还没有被收录。"}</p>
      <form className="hero-search" action="/plugins" method="get">
        <label className="search-field">
          <span>/</span>
          <input name="q" aria-label={english ? "Search plugins" : "搜索插件"} placeholder={english ? "Search the catalog" : "搜索插件目录"} />
        </label>
        <button className="primary-button" type="submit">{english ? "Search" : "搜索"}</button>
      </form>
      <div className="status-page__actions">
        <Link className="primary-button" href="/plugins">{english ? "Browse catalog" : "返回插件目录"}</Link>
        <Link className="secondary-button" href="/">{english ? "Back home" : "返回首页"}</Link>
      </div>
    </main>
  );
}
