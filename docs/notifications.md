# Uptimer 通知系统（Notifications）Wiki

本文档介绍 Uptimer 的通知系统（目前仅 Webhook 渠道）：事件模型、通道配置、Payload 发送方式、魔法变量模板系统、签名校验、以及常见排障。

适用范围：Worker（`apps/worker`）的通知派发逻辑 + Web 管理后台配置（`apps/web`）。

---

## 1. 概览

Uptimer 的通知系统目标：

- 当「监控状态发生关键变化」（UP->DOWN、DOWN->UP）或「事件/公告变化」（incident.\*）时，向外部系统（Webhook）发送通知。
- 支持每个渠道独立配置：请求方法、超时、headers、payload 格式、payload 模板（含魔法变量）、事件过滤（enabled_events）、可选签名。
- 支持幂等去重：同一事件对同一 channel 只会发送一次（以 `notification_deliveries` 唯一键实现）。

核心流程（简化）：

1. 系统产生事件（eventType + eventKey + payload）
2. 找到所有 active webhook channels
3. 对每个 channel：
   - 事件过滤（enabled_events）
   - 先“占坑”写入 `notification_deliveries`（幂等 claim）
   - 渲染模板（message_template/payload_template/header template）
   - 按 payload_type 组装 URL/body
   - fetch 发送（no-store + timeout）
   - 回写 `notification_deliveries` 成功/失败结果

---

## 2. 核心概念

### 2.1 Event Type（事件类型）

事件类型是一个字符串，用于表示“发生了什么”。当前支持（见 `packages/db/src/json.ts` 的 `notificationEventTypeSchema`）：

- `monitor.down`
- `monitor.up`
- `incident.created`
- `incident.updated`
- `incident.resolved`
- `maintenance.started`
- `maintenance.ended`
- `test.ping`（用于测试按钮）

### 2.2 Event Key / Event ID（幂等键）

`event_key`（也会出现在 payload 里的 `event_id`）用于幂等：

- 同一条事件对同一个 channel，只会发送一次。
- 通过 D1 表 `notification_deliveries` 的 UNIQUE(event_key, channel_id) 约束实现。

典型的 eventKey 形态：

- 监控：`monitor:<monitorId>:down|up:<timestamp>`
- 事件：`incident:<incidentId>:created|resolved:<...>`、`incident:<incidentId>:update:<updateId>`
- Test：`test:webhook:<channelId>:<now>`

注意：如果你在同一秒内重复点击 test，有可能命中同一个 eventKey，从而被幂等去重“跳过”。遇到这种情况等 1 秒再点即可。

### 2.3 Channel（通知渠道）

`notification_channels` 表的一条记录：

- `type`：目前只有 `webhook`
- `config_json`：Webhook 的配置（url/method/headers/payload_type/payload_template 等）
- `is_active`：是否启用

### 2.4 Delivery（投递记录）

`notification_deliveries` 记录每次“事件 x 渠道”的投递结果：

- `status`: `success` / `failed`
- `http_status`: 响应状态码（失败时可能为 null）
- `error`: 失败原因（例如超时、网络错误、HTTP 500 等）

---

## 3. 管理端 API（Admin）

通知渠道相关 API（见 `Application.md` 约定）：

- `GET /api/v1/admin/notification-channels`
- `POST /api/v1/admin/notification-channels`
- `PATCH /api/v1/admin/notification-channels/:id`
- `DELETE /api/v1/admin/notification-channels/:id`
- `POST /api/v1/admin/notification-channels/:id/test`

Test 接口会：

- 生成 `event = test.ping` 的测试 payload（带示例 monitor/state 字段）
- 发送 webhook
- 返回对应的 delivery 记录（用于排障）

---

## 4. Webhook 通道配置（config_json）

Webhook channel 的 `config_json` 由 Zod 校验（`packages/db/src/json.ts`）。

字段说明：

- `url`（必填）：Webhook URL，仅允许 `http://` 或 `https://`。
- `method`（可选，默认 `POST`）：`GET|POST|PUT|PATCH|DELETE|HEAD`。
- `headers`（可选）：对象 `{ "Header-Name": "value" }`。
  - 注意：header value 也会经过模板渲染（支持 `{{...}}` 与 `$MSG`）。
- `timeout_ms`（可选）：1~60000ms。
- `payload_type`（可选，默认 `json`）：
  - `json`：请求 body 为 JSON。
  - `param`：把 payload 展平成 query params（拼到 URL 上）。
  - `x-www-form-urlencoded`：请求 body 为 `application/x-www-form-urlencoded`（GET/HEAD 会退化为 query params）。
- `message_template`（可选）：用于生成最终 `message` 字符串（可在 payload/header 中使用 `{{message}}` 或 `$MSG`）。
- `payload_template`（可选）：用于“自定义最终发送 payload”。
  - `payload_type=json`：可以是任意 JSON 值（object/array/string/number/bool/null）。其中所有字符串字段会进行模板替换。
  - `payload_type=param` 或 `x-www-form-urlencoded`：必须是“扁平对象”，且 value 只能是 string/number/boolean/null（Zod 会强校验）。
- `enabled_events`（可选）：事件白名单数组。
  - 不填：接收所有事件。
  - 填了：只接收列表内事件。
  - 特例：`test.ping` 无论是否在白名单内，都会被允许（方便测试）。
- `signing`（可选）：签名配置
  - `enabled: boolean`
  - `secret_ref: string`：引用 Worker 的 secret 名称（必须在 Worker env 中存在对应字符串）。

---

## 5. Payload 的三种构建模式

Uptimer 最终发送出去的 payload 取决于你是否配置了 `payload_template`，以及 `payload_type`。

### 5.1 默认 payload（最兼容）

当满足以下条件时：

- `payload_type = json`
- 且 **未设置** `payload_template`

则 Uptimer 会“原样发送系统默认 payload”。

优点：

- 结构稳定、字段齐全（包含 `event/event_id/timestamp/monitor/state/...`）
- 数字字段保持数字类型（例如 monitor.id、state.http_status）

### 5.2 自定义 payload（payload_template）

当你设置了 `payload_template` 时：

- 最终发送出去的 JSON（或 params/form）就是“模板渲染后的结果”。
- 系统不会自动把 `event/event_id/...` 注入到你模板里；如果你需要这些字段，请在模板里显式写出来。

例如（JSON 模板）：

```json
{
  "event": "{{event}}",
  "event_id": "{{event_id}}",
  "text": "{{message}}",
  "monitor_name": "{{monitor.name}}"
}
```

### 5.3 非 JSON 的默认最小 payload

当满足以下条件时：

- `payload_type != json`
- 且 **未设置** `payload_template`

Uptimer 会发送一个“最小扁平 payload”（适合 query/form）：

- `event`
- `event_id`
- `timestamp`
- `message`

---

## 6. 魔法变量（模板系统）

Uptimer 支持在以下位置使用模板：

- `message_template`
- `payload_template` 中的所有字符串字段
- `headers` 中的所有 value

### 6.1 语法

- `{{path.to.field}}`：按路径取值
- 支持数组下标：`{{checks[0].latency_ms}}`
- 兼容 `$MSG`：替换为渲染后的 `message`（偏 UptimeFlare 风格）

### 6.2 内置变量（vars）

每次派发都会构建一份 vars，主要包含：

- `event`：事件类型（字符串）
- `event_id`：事件幂等键（字符串）
- `timestamp`：unix seconds（number）
- `channel.id` / `channel.name`
- `payload`：系统原始 payload（整包）
- 以及：系统原始 payload（如果是对象）会被“展开”到顶层 vars（例如原始 payload 有 `monitor`，则可直接 `{{monitor.name}}`）
- `default_message`：系统默认消息（根据 eventType 生成）
- `message`：最终消息
  - 若配置了 `message_template`，会先用它渲染（可引用 `{{default_message}}` 或 `$MSG`）。

### 6.3 缺失字段的行为

- 如果路径不存在/取不到值：替换为空字符串。

### 6.4 安全限制

为避免原型链污染类风险，模板路径中会拒绝访问以下 key：

- `__proto__`
- `prototype`
- `constructor`

### 6.5 类型说明（重要）

模板替换本质是字符串替换：

- `payload_template` 中被替换的字符串字段，最终一定是“字符串”。
- 例如 `"id": "{{monitor.id}}"` 最终会变成 `"id": "12"`（字符串），而不是数字 12。

如果你的接收端强依赖数字类型，建议：

1. 使用默认 payload（不设置 payload_template），或
2. 在接收端做类型转换。

---

## 7. payload_type 详解

### 7.1 payload_type = json

- body：`JSON.stringify(payload)`
- 默认会设置 header：`Content-Type: application/json`
  - 说明：某些 webhook 接收端会严格要求这个值必须“精确等于 application/json”，因此 Uptimer 默认不再附加 `charset=utf-8`。
- 如果你在 `headers` 里手动写了 `Content-Type`，Uptimer 不会覆盖。

### 7.2 payload_type = param

- 把 payload（必须是扁平对象）转换成 query params，拼到 `url` 上。
- 不发送 request body。

### 7.3 payload_type = x-www-form-urlencoded

- 对 POST/PUT/PATCH/DELETE：
  - body：`new URLSearchParams(flat).toString()`
  - 默认会设置 header：`Content-Type: application/x-www-form-urlencoded`
- 对 GET/HEAD：
  - 无法发送 body，会自动退化为 query params

---

## 8. Webhook 签名（signing）

当 `signing.enabled = true` 时，Uptimer 会在发送请求时附加：

- `X-Uptimer-Timestamp: <unix seconds>`
- `X-Uptimer-Signature: sha256=<hmac>`

签名计算：

- `message = "<timestamp>.<rawBody>"`
- `hmac = HMAC_SHA256_HEX(secret, message)`

注意：

- `rawBody` 是“实际发送的 body 字符串”。
- 如果请求没有 body（例如 GET 或 payload_type=param），rawBody 可能是空字符串。
- secret 仅从 Worker env 的 `secret_ref` 读取，不会从 DB 读取。

一个接收端校验（Node.js 伪码）：

```js
import crypto from 'node:crypto';

function verify(req, secret) {
  const ts = req.headers['x-uptimer-timestamp'];
  const sig = req.headers['x-uptimer-signature']; // sha256=...
  const rawBody = req.rawBody ?? '';

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');

  return sig === `sha256=${expected}`;
}
```

---

## 9. 常用配置示例

### 9.1 Apprise（Vercel wrapper）+ ntfy

Apprise wrapper 通常期望字段名为 `urls`（不是 `url`）：

```json
{
  "url": "https://vrian-apprise.vercel.app/notify",
  "method": "POST",
  "payload_type": "json",
  "payload_template": {
    "urls": "ntfys://vriancaontfy",
    "body": "$MSG"
  }
}
```

如果你需要把事件信息也带过去：

```json
{
  "url": "https://vrian-apprise.vercel.app/notify",
  "method": "POST",
  "payload_type": "json",
  "message_template": "[{{event}}] {{monitor.name}} => {{state.status}}\n$MSG",
  "payload_template": {
    "urls": "ntfys://vriancaontfy",
    "body": "{{message}}"
  }
}
```

### 9.2 query param webhook（GET）

```json
{
  "url": "https://example.com/webhook",
  "method": "GET",
  "payload_type": "param",
  "payload_template": {
    "event": "{{event}}",
    "monitor": "{{monitor.name}}",
    "msg": "{{message}}"
  }
}
```

### 9.3 x-www-form-urlencoded（POST）

```json
{
  "url": "https://example.com/webhook",
  "method": "POST",
  "payload_type": "x-www-form-urlencoded",
  "payload_template": {
    "event": "{{event}}",
    "msg": "{{message}}"
  }
}
```

---

## 10. 排障指南（Test 没收到 / 通知不触发）

### 10.1 先看 Test API 的返回

点击管理后台的 Test（或调用 API）：

- `POST /api/v1/admin/notification-channels/:id/test`

返回里会带：

- `delivery.status`
- `delivery.http_status`
- `delivery.error`

常见错误：

- `HTTP 400/415`：接收端不接受 content-type / body 结构。
- `Timeout after XXXXms`：接收端慢/网络不通。
- `Signing secret not configured: XXX`：开启 signing 但没有配置对应 secret。

### 10.2 常见“配置看起来对，但不工作”的原因

- `payload_template` 字段名写错：接收端字段名不对（例如 Apprise wrapper 需要 `urls`，不是 `url`）。
- `Content-Type` 过于严格：某些接收端要求必须是 `application/json`（不接受 `application/json; charset=utf-8`）。
  - Uptimer 默认已兼容；如果你手动写 headers，注意别写错。
- 开启了 `enabled_events`，但事件类型不在白名单里。
  - 注意：test.ping 永远允许；但真实事件会被过滤。
- channel `is_active = false`：未启用。
- 幂等去重：同一个 eventKey 已经发过一次了，会直接跳过。
  - Test 在同一秒内重复点击可能复现。

### 10.3 直接查 D1 记录

你可以在本地用 wrangler 查：

```bash
wrangler d1 execute uptimer --local --command="SELECT * FROM notification_deliveries ORDER BY created_at DESC LIMIT 20;"
```

---

## 11. 当前实现的边界（已知限制）

- 目前仅支持 Webhook 渠道（没有 email/telegram 等内置渠道）。
- JSON 模板替换是“字符串替换”，动态值会变成字符串（详见 6.5）。
- payload_template 的 JSON 深度有上限（默认最大深度 32），过深会被置为 null。

---

## 12. 相关实现位置（给开发者）

- Webhook 派发：`apps/worker/src/notify/webhook.ts`
- 幂等去重：`apps/worker/src/notify/dedupe.ts`
- 模板系统：`apps/worker/src/notify/template.ts`
- Schema（config_json 校验）：`packages/db/src/json.ts`
- Test endpoint：`apps/worker/src/routes/admin.ts`
