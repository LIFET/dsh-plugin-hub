# 项目交接

## 当前项目状态

详情页、扫描 409、缓存与 SEO 修复已部署到 `https://apiu.cc`。生产 release 为 `20260816T154113-c5ac44a`（`main` `c5ac44a`）；上一版 `20260815T031300-58d6add` 与注册表备份均保留。

## 已完成内容

- 修复源码筛查永远无法 `clear`：改用 GitHub commit 根目录树识别 README、锁文件和 manifest；匿名巡检按 API 预算从每轮 2 条提升为 7 条。
- 仓库预检改为分客户端限流 + 共享 GitHub 预算，校验/缓存命中不耗上游预算；请求体流式限长并采用可信反代来源。
- Next.js 升级至 16.3.1，生产依赖审计为 0 漏洞；补齐 CSP、HSTS、robots、sitemap、404、错误边界和轻量 OG 图。
- 首页仅下发 6 条精选数据，排行仅下发约 40 条，提交/指南不再携带完整目录；卡片与导航改为真实链接。
- 修复语言/主题首屏、双语标题、320px 导航截断、移动端收录步骤过高、抽屉焦点与滚动、状态文案及响应式布局。
- 加固 Nginx 与 systemd 权限、内存和命名空间边界。

## 修改文件

涉及页面与样式、注册表/筛查、仓库预检、部署配置、依赖、SEO 资源和对应测试；未改业务数据源协议。

## 当前架构

Nginx/HTTPS → Next.js Standalone → 原子 JSON 注册表；systemd timer 每 30 分钟同步，站点从 GitHub 只读公开元数据和文本，不执行第三方代码。

## 验收结果

Build/TypeScript、Lint、26 项测试、`npm audit --omit=dev`、差异格式及单窗口 320/390/1440px 浏览器回归通过。目标机 `systemd-analyze verify`、`nginx -t`、候选端口 Smoke、HTTPS/TLS、公开 Cron 404 与其他 3 个站点回归通过。受控同步检查 7 条、收录 4 条，当前共 221 条；首次产出 1 条 `clear`，其安装命令已固定到检查提交。

## 已知问题

生产已配置仅限公开仓库只读的 Fine-grained `GITHUB_TOKEN`，GitHub API 额度为 5,000 次/小时；Token 于 2026-11-13 到期。

## 下一步

保持每 30 分钟自动同步，并在 2026-11-13 前轮换 `GITHUB_TOKEN`。站点域名维持 `apiu.cc`，不启用 www 前缀。
