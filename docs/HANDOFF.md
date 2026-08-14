# 项目交接

## 当前项目状态

生产仍运行上一版本；全站优化已在本地完成并通过隔离验收，尚未部署。

## 已完成内容

- 永久巡检错误退避，匿名模式默认每轮 2 条；手动回填可安全放大至 50 条。
- 安装命令统一要求源码检查 `clear`；运行注册表增加 mtime 缓存与 ETag。
- 新增真实页面/详情 URL、URL 筛选、36 条分批加载与仓库收录预检。
- 修复移动端导航、抽屉焦点锁定/恢复、对比度、复制反馈、语言/主题首屏与 SEO 域名。
- 移除外部 Google 字体请求；Build、Lint、20 项测试和移动端浏览器回归通过。

## 修改文件

主要涉及 `app/plugin-hub.tsx`、`app/globals.css`、真实路由/API、`worker/plugin-registry.ts`、筛查逻辑和测试。

## 当前架构

Nginx/HTTPS → Next.js Standalone → 原子 JSON 注册表；systemd timer 每 30 分钟同步，公开预检只读取 GitHub 元数据和 `package.json`。

## 技术决策

- 仅 `screening.state=clear` 可展示固定提交安装命令。
- 永久不可检查项不再拖累整轮成功状态；临时错误 6 小时退避。
- 页面服务端直接读取当前注册表，取消 hydration 后的重复 API 请求。

## 已知问题

生产未配置 `GITHUB_TOKEN`；代码已降载保护，但首次 209 条源码回填会较慢。框架基础 JavaScript 仍约有 50KB Lighthouse 未使用估算，当前本地 Performance 为 100。

## 下一步

等待用户确认生产部署。部署前建议配置公开仓库只读 Token；上线后执行一次 `REGISTRY_SCAN_LIMIT=50` 的受控回填并复核其他站点。
