# AGENTS.md: Working Agreement for Uptimer

本文件用于指导代码助手/自动化代理在本仓库内工作的方式与约定（避免反复沟通、减少返工）。

---

## 参考项目：UptimeFlare（“老大哥”）

本仓库内的 `UptimeFlare/` 目录用于参考 Cloudflare Workers / Pages / D1 的用法与性能思路。

约束：
- 可以学习其思路与 API 用法，但**不要复制其业务逻辑/架构实现**，避免被其实现方式“带偏”。
- 除非用户明确要求，否则不要修改 `UptimeFlare/` 目录。

---

## MUST READ FIRST（强制）

在执行任何“写入/重构/生成代码/修改配置/运行破坏性命令”之前，必须先阅读并理解以下文档：
- `AGENTS.md`（本文件）
- `Application.md`（产品规格与技术约束）
- `Structure.md`（目录结构与模块边界）
- `Plan.md`（里程碑与验收标准）
- `API-Reference.md`（Cloudflare/D1/出站探测等 API 参考）

如果尚未阅读或内容与当前任务冲突：先停止实现，先对齐文档与需求，再继续。

---

## 0. Codex Skills（本机环境）

说明：如果你以 Codex CLI/类似代理运行，本机可能已安装可复用的 “Skills”（存放在 `SKILL.md`）。当用户明确点名某个 skill，或任务明显匹配某个 skill 描述时，必须使用对应 skill 的流程。

本机已知可用 skills（路径为本机路径）：
- `create-plan`：用户明确要求“计划/Plan”时使用。(`C:/Users/User/.codex/skills/create-plan/SKILL.md`)
- `skill-creator`：创建/更新 skills 时使用。(`C:/Users/User/.codex/skills/.system/skill-creator/SKILL.md`)
- `skill-installer`：安装 curated skill 或从 repo 安装 skills 时使用。(`C:/Users/User/.codex/skills/.system/skill-installer/SKILL.md`)

执行约定（简版）：
- 先打开对应 `SKILL.md`，只读到足够执行该任务为止；避免一次性读入大量参考文件。
- 若 skill 提供脚本/模板，优先复用而不是手写大段内容。
- 未找到/无法读取 skill 文件时，简要说明并用最佳替代方案继续推进。

---

## 1. 项目事实（先读这些）

- 产品规格：`Application.md`
- 目录结构与边界：`Structure.md`
- 交付计划：`Plan.md`
- 参考项目：`UptimeFlare/`（仅用于查 Cloudflare API/Workers 用法；不要借鉴其架构/实现，更不要复制其业务逻辑）

---

## 2. 已敲定技术选型（不要引入替代方案）

- Frontend (Pages)：React + Vite + TypeScript + Tailwind + React Router + TanStack Query + Recharts
- Backend (Workers)：TypeScript + Hono + Zod
- DB：Cloudflare D1 + Drizzle ORM；迁移用 Wrangler D1 migrations（SQL migrations）
- Auth：Admin Bearer Token（存于 Workers Secret）

如果要引入新依赖/新服务（Queues、DO、R2 等），必须先在 PR/变更说明中写清“为什么必须要引入、替代方案为何不行、影响面”。

---

## 3. 仓库规则（重要）

- 不要修改 `UptimeFlare/` 目录（除非我明确要求）。
- 所有对外接口必须符合 `Application.md` 的 API 约定（路径、时间字段、错误格式）。
- 所有输入必须用 Zod 做运行时校验；不要信任来自客户端/DB 的 JSON 字段。
- 所有 DB 写入必须参数化（Drizzle 或 D1 prepared statements），禁止拼接 SQL。
- 监控探测必须禁用缓存（HTTP check 必须显式 no-store，并设置 `cf.cacheTtlByStatus` 不缓存）。

---

## 4. 实现优先级（MVP）

严格按 `Plan.md` 从 Phase 0 -> Phase 7 推进：
- 先 Worker + D1 跑通（含 scheduled）再做完整 UI
- 先 HTTP/TCP 与状态机正确性，再谈多地域与高级分析

---

## 5. 开发/提交标准（Definition of Done）

每次变更至少满足：
- 变更范围小且聚焦（不要“一次性大改”）
- 本地能跑通基础命令（如果已存在脚本）：
  - `pnpm -r lint`
  - `pnpm -r typecheck`
  - `pnpm -r test`（若已建立）
- D1 schema 变更必须伴随新增 migration（不要修改旧 migration）
- 关键行为变更必须补充最小测试或可复现实例（至少给出 curl/步骤）

---

## 6. 安全基线（必须遵守）

- Monitor target 属于受控 SSRF 能力：必须限制协议，并默认拒绝私网/保留地址段；端口不限制（允许 1-65535）。具体规则以 `Application.md` 为准。
- Admin Token 只能放在 Workers Secrets 或 `.dev.vars`（本地）；禁止写入 Git、D1 或前端代码。
- Webhook 如启用签名，签名 secret 只能引用 secret（不要落库）。

---

## 7. 变更说明要求（对我输出时）

请在说明中包含：
- 你做了什么（1–3 行）
- 为什么这么做（关键约束/风险）
- 影响到哪些路径/模块（文件路径）
- 我如何验证（命令或操作步骤）
