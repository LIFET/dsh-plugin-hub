# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

（推断，来自既有站点与多轮优化对话，非本轮新访谈）使用 DeepSeek Harness 的开发者，在把第三方插件装进本机之前，需要先核对仓库、manifest 和静态检查证据。

## Product Purpose

社区插件目录与安装证据索引。成功标准：用户能搜到插件、看懂检查走到哪一步、复制到锁定 commit 的安装命令，并判断该不该装。

## Positioning

只读公开 GitHub 元数据和声明入口源码，不执行第三方代码；只有源码检查通过才给出钉死 commit 的正式安装命令。

## Operating Context

浏览器访问 https://apiu.cc。安装发生在用户本机的 `dsh` / `npx @deepseek-ai/dsh`。数据每 30 分钟同步。双语（中/英）与浅色/深色主题是既有能力。

## Capabilities and Constraints

- 路由：`/`、`/plugins`、`/plugin/:owner/:repo`、`/rank`、`/submit`、`/guide`、JSON API
- 搜索、分类、作者、证据、收藏、排序、安装命令复制、仓库预检均须保留
- 域名仅 `apiu.cc`，不启用 www
- 本轮用户绑定视觉约束：推倒现有视觉、重新设计、简洁、黑白配色
- 不改变筛查规则与数据协议

## Brand Commitments

- 名称：DSH 插件资源站 / DSH Plugin Hub
- 作者：岚叔；与 DeepSeek AI 无隶属关系
- 用户本轮明确：简洁，黑白配色；由设计方完成重设计

## Evidence on Hand

- 线上真实注册表（约 600+ 插件）
- `app/plugin-hub.tsx`、`app/globals.css` 为现有实现
- 不得编造下载量、官方背书或安全保证

## Product Principles

- 先证据，后安装
- 任务界面优先，不做营销站
- 不执行用户仓库里的代码
- 视觉服务扫描，不服务装饰

## Accessibility & Inclusion

中英双语。对比度须满足正文可读。状态不能只靠颜色。
