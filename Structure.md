# Structure.md: Repository Structure (Uptimer)

本文定义 Uptimer 仓库的目录结构、模块边界与命名约定，用于初始化与后续协作一致性。

---

## 1. 顶层目录（规划）

```
.
├─ apps/
│  ├─ web/                      # Cloudflare Pages: React + Vite 前端（管理后台 + 公共状态页）
│  └─ worker/                   # Cloudflare Workers: Hono API + scheduled 监控引擎
├─ packages/
│  ├─ shared/                   # 共享类型/常量/Zod schema（前后端共用）
│  └─ db/                       # Drizzle schema 与 DB 访问封装（供 worker 使用）
├─ docs/                        # 可选：更多设计文档（如 ADR、运维手册）
├─ .github/workflows/           # CI/CD（Pages + Worker 部署、迁移）
├─ Application.md               # 应用技术规格（已敲定）
├─ Structure.md                 # 本文件
├─ Plan.md                      # 交付计划
├─ AGENTS.md                    # 代码助手/协作约定
└─ UptimeFlare/                 # 参考项目（仅用于查 API/调用方式；不要在此处开发）
```

说明：

- 本仓库采用 monorepo 结构，便于共享类型与统一依赖。
- `UptimeFlare/` 仅作为 Cloudflare API/Workers 用法参考；本项目实现应以 `Application.md` 为准。

---

## 2. Worker（后端）结构

```
apps/worker/
├─ wrangler.toml                # Worker 配置（D1 binding、cron triggers、compatibility）
├─ migrations/                  # D1 SQL migrations（wrangler d1 migrations apply）
└─ src/
   ├─ index.ts                  # Hono app：路由注册 + export default
   ├─ env.ts                    # Env interface（D1 binding、secrets）
   ├─ middleware/
   │  ├─ auth.ts                # Admin Bearer Token 鉴权
   │  └─ errors.ts              # 统一错误响应
   ├─ routes/
   │  ├─ public.ts              # /api/v1/public/*
   │  └─ admin.ts               # /api/v1/admin/*
   ├─ scheduler/
   │  ├─ scheduled.ts           # scheduled() 入口（Cron tick）
   │  ├─ lock.ts                # D1 locks lease
   │  └─ retention.ts           # 清理任务（每日）
   ├─ monitor/
   │  ├─ http.ts                # HTTP check（禁缓存、断言、超时）
   │  ├─ tcp.ts                 # TCP check（cloudflare:sockets）
   │  └─ state-machine.ts       # 连续成功/失败阈值、UP/DOWN 切换
   ├─ notify/
   │  ├─ webhook.ts             # Webhook dispatch（可选签名、超时）
   │  └─ dedupe.ts              # notification_deliveries 幂等
   └─ db/
      ├─ client.ts              # Drizzle + D1 client
      └─ queries.ts             # 聚合查询（status/latency/uptime）
```

约定：

- 所有对外 API 均从 `routes/` 进入；非路由逻辑沉到对应模块（monitor/scheduler/notify/db）。
- `scheduled()` 入口仅负责编排流程与日志；探测实现与 DB 写入在模块内完成。

---

## 3. Web（前端）结构

```
apps/web/
├─ public/
├─ index.html
├─ vite.config.ts
└─ src/
   ├─ main.tsx
   ├─ app/
   │  ├─ router.tsx             # React Router 路由表
   │  └─ queryClient.ts         # TanStack Query 配置
   ├─ api/
   │  ├─ client.ts              # fetch 封装（baseUrl、错误处理）
   │  └─ types.ts               # 前端 API 类型（优先从 packages/shared 导入）
   ├─ pages/
   │  ├─ StatusPage.tsx         # 公共状态页
   │  ├─ AdminLogin.tsx         # 可选（仅 Token 输入/保存到 localStorage）
   │  └─ AdminDashboard.tsx
   ├─ features/
   │  ├─ monitors/              # 监控项 CRUD UI
   │  ├─ incidents/             # 事件管理 UI
   │  └─ notifications/         # 通知渠道 UI
   ├─ components/
   ├─ styles/
   └─ utils/
```

约定：

- 与后端共享的类型与 schema 优先从 `packages/shared` 导入，避免前后端“各写一套”。
- API 请求统一走 `api/client.ts`；不要在组件内散落裸 `fetch`。

---

## 4. Shared/DB 包结构

```
packages/shared/
└─ src/
   ├─ constants.ts              # 枚举/常量（status、event type）
   ├─ schemas.ts                # Zod schemas（API input/output、DB json 字段）
   └─ types.ts                  # TypeScript 类型（由 schema 推导）

packages/db/
└─ src/
   ├─ schema.ts                 # Drizzle table schema（与 migrations 一致）
   └─ index.ts                  # 导出 db helpers
```

约定：

- DB schema（Drizzle）与 D1 migrations（SQL）必须同步变更；任何 schema 改动必须伴随新增 migration。
- `config_json`、`*_json` 字段统一使用 Zod 做运行时校验。

---

## 5. 命名与边界规则

- 路由：
  - Public: `/api/v1/public/*`
  - Admin: `/api/v1/admin/*`
- 时间字段：
  - 对外 API 与 D1 存储统一使用 unix seconds（INTEGER），字段名以 `*_at` 结尾。
- 状态字段：
  - DB/接口统一用 `up|down|maintenance|paused|unknown`；延迟统一用 `latency_ms`。
- 不允许在 `apps/web` 直接依赖 Worker 运行时 API（如 `cloudflare:sockets`）。
- 不允许修改 `UptimeFlare/` 作为实现的一部分（除非明确要求）。
