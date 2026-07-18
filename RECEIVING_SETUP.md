# 收信配置（方案 B：Resend Inbound Webhook 转发）

目标：让 `hello@kuajing.space` 能收信，客户回复（即使不通过 Reply-To）也能被转发到真实邮箱。

> 方案 A（Reply-To）已写入 `functions/api/send.js` + 前端弹窗，客户点回复会直接进你填的收件箱。
> 方案 B 让 `hello@kuajing.space` 本身成为可收信地址，通过 Resend Webhook 把收到的邮件内容转发到你的 Gmail。
> 两者互补，建议都做。

## 已实现
- `functions/api/receive-email.js`：Cloudflare Pages Function，接收 Resend `email.received` webhook，自动转发给 `ycr13120902436@gmail.com`（可在 CF 环境变量用 `FORWARD_TO` 覆盖）。

## 步骤

### 1. 在 Resend 开启收信
- 登录 https://resend.com → **Domains** → `kuajing.space`
- 打开 **Receiving** 开关
- 页面会显示一条「收信 MX 记录」，值通常为 `inbound-smtp.us-east-1.amazonaws.com`（**以页面显示为准**）

### 2. 在 DNSPod 添加收信 MX
- 登录 DNSPod → `kuajing.space`
- 添加记录：
  - 主机记录：`@`
  - 记录类型：`MX`
  - 记录值：（复制第 1 步 Resend 显示的收信 MX 值）
  - 优先级：`10`
  - TTL：默认
- 保存

### 3. 回 Resend 验证
- 在 Resend 域名页点 **I've added the record** / 验证（通常几分钟，最多 72 小时）
- 等 MX 变成 **Verified**（绿）再继续下一步

### 4. 创建 Resend API Key（需要 Receiving 权限）
- 你之前的 Key 可能只有 **Sending** 权限。
- Resend → **API Keys** → **Create API Key**
- 权限勾选 **Sending + Receiving**（或直接用 Full Access）
- 复制 Key，到 Cloudflare Pages 环境变量 **替换** 原来的 `RESEND_KEY`
- （可选）添加环境变量 `FORWARD_TO` 填写你希望的转发邮箱（不填则默认 `ycr13120902436@gmail.com`）
- **重新部署** Cloudflare Pages 以加载新环境变量

### 5. 在 Resend 添加 Webhook
- Resend → **Webhooks** → **Add Webhook**
- Endpoint URL：你的 CF Pages 部署地址 + `/api/receive-email`
  - 例如：`https://renseek.pages.dev/api/receive-email`（请换成你的真实域名）
- Event type：勾选 `email.received`
- 保存

### 6. 测试
- 从任意邮箱发一封信到 `hello@kuajing.space`
- 等几秒，查看 `ycr13120902436@gmail.com` 是否收到标题为 `Fwd: ...` 的转发邮件
- 也可以在 Resend 后台 **Emails → Receiving** 看到收到的邮件记录

## 注意事项
- 当前 `kuajing.space` 根域**没有任何 MX 记录**，所以加这条收信 MX 不会和现有服务冲突（发送仍走 Resend API，不受影响）。
- 开启后，**所有**发往 `@kuajing.space` 的邮件都会先到 Resend，再触发你的 webhook 转发。
- 若以后该域名要接独立邮箱服务（如 Google Workspace），需改用子域收信（如 `inbound.kuajing.space`）以避免 MX 优先级冲突。
- 安全建议：生产环境可给 webhook 加签名验证（需 `RESEND_WEBHOOK_SECRET`），当前实现先保证能跑通，后续可再加。
