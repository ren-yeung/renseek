# 收信配置（方案 B：Resend 收信路由）

目标：让 `hello@kuajing.space` 能收信，客户回复直达你的真实邮箱。

> 方案 A（Reply-To）已写入 `functions/api/send.js` + 前端弹窗，客户点回复会直接进你填的收件箱。
> 方案 B 让 `hello@kuajing.space` 本身成为可收信的真实地址（即使客户端忽略 Reply-To 直接回 From，也能收到）。
> 两者互补，建议都做。

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

### 4. 建转发规则（Route）
- Resend → **Inbound / Routes** → **New Route**
- 匹配：`hello@kuajing.space`（或选 catch-all 收全部 `@kuajing.space`）
- 动作：**Forward to** `ycr13120902436@gmail.com`（也可改别的收件箱）
- 保存

## 注意事项
- 当前 `kuajing.space` 根域**没有任何 MX 记录**，所以加这条收信 MX 不会和现有服务冲突（发送仍走 Resend API，不受影响）。
- 开启后，**所有**发往 `@kuajing.space` 的邮件都会先到 Resend，再按 Route 转发到你 Gmail。
- 若以后该域名要接独立邮箱服务（如 Google Workspace），需改用子域收信（如 `inbound.kuajing.space`）以避免 MX 优先级冲突。
- 验证成功后可发一封测试信到 `hello@kuajing.space`，看是否出现在你 Gmail 里。
