# renseek 配置教程：DeepSeek 开发信 + 云端发信（Resend）

本教程对应「AI 开发信」与「邮件发送」功能。分三部分：
- **A. DEEPSEEK_KEY** → 让线上网页能 AI 生成开发信（设在 Cloudflare，密钥不进代码）
- **B. Resend + 自有域名** → 让线上网页直接发送邮件，无需本机 Gmail 绕墙（设在 Cloudflare，密钥不进代码）
- **C. Gmail 应用专用密码** → 在本地用 Gmail SMTP 免费群发（设在本地 `.env`，密钥不进 git）

> 推荐用 **B. Resend 云端发信**，稳定、不依赖本机网络、不翻墙。Gmail 方案留作备用。

---

## A. 配置 DEEPSEEK_KEY（Cloudflare 环境变量）

### 步骤 1：拿到 DeepSeek API Key
1. 打开 https://platform.deepseek.com 注册并登录
2. 左侧菜单点 **API Keys**（或右上角头像 → API Keys）
3. 点 **Create new key**，起个名字（如 `renseek`），点创建
4. **复制生成的 key**（只显示这一次，格式类似 `sk-xxxx...`）
5. ⚠️ 先去 **Top up / 充值** 充一点钱（比如 ¥10，能用很久）。**没余额调用会报 402 错误**。

### 步骤 2：填到 Cloudflare
1. 打开 https://dash.cloudflare.com 登录
2. 左侧 **Workers & Pages** → 找到你的项目 **renseek**（对应 renseek.ccwu.cc）
3. 进入项目 → 顶部 **Settings** → 左侧 **Environment variables**
4. 在 **Production** 标签页下点 **Add variable**
   - 变量名：`DEEPSEEK_KEY`
   - 值：粘贴你刚复制的 key
   - 点右侧 **Encrypt**（加密存储，推荐）
5. 保存

> 可选变量（不设则用默认）：
> - `DEEPSEEK_MODEL`：默认 `deepseek-chat`（想要更强推理可填 `deepseek-reasoner`）
> - `DEEPSEEK_BASE`：默认官方 `https://api.deepseek.com/v1`，一般不用改

### 步骤 3：重新部署（关键）
改完环境变量后，**必须重新部署一次**让 Functions 加载新变量：
- 进入项目 **Deployments** 标签 → 找到最新一次部署 → 点 **Redeploy**（或点右上角重试按钮）
- 等构建完成（1–3 分钟），`/api/draft` 才会读到你设置的 key

### 验证
部署完成后，在 renseek 网页随便搜一个客户 → 点「开发信」→「生成开发信」：
- 正常：几秒后主题+正文自动填充
- 若提示「服务端未配置 DEEPSEEK_KEY」：回步骤 2/3 检查变量名拼写、是否设在 Production、是否 Redeploy

---

## B. 配置 Resend 云端发信（Cloudflare 环境变量）

> 本方案通过 Cloudflare Pages Function 调用 Resend HTTPS API，绕开本机 Gmail 465 被墙、不稳定等问题。前提是你已经在 Resend 验证了自己的域名（如 `kuajing.space`）。

### 步骤 1：在 Resend 添加域名并验证 DNS
1. 打开 https://resend.com → 登录
2. 左侧 **Domains** → **Add domain**
3. 输入你的域名，如 `kuajing.space`（或子域 `mg.kuajing.space`）
4. Resend 会给出 DNS 记录：DKIM、SPF、MX、DMARC
5. 登录你的 DNS 服务商（如 DNSPod / Cloudflare），按 Resend 页面逐条添加记录
6. 返回 Resend 点 **"I've added the records"**，等状态变成 **Verified**

### 步骤 2：创建 Resend API Key
1. Resend 左侧 **API Keys** → **Create API Key**
2. 名称填 `lead-finder-cf`
3. 权限选 **Sending**（只发邮件，不要 Full Access）
4. 复制生成的 key（以 `re_` 开头）

### 步骤 3：填到 Cloudflare
1. 打开 https://dash.cloudflare.com → 你的 Pages 项目 **renseek**
2. **Settings** → **Environment variables**
3. 在 **Production** 标签页点 **Add variable**
   - 变量名：`RESEND_KEY`
   - 值：粘贴 `re_` 开头的 key
   - 点 **Encrypt** 加密存储
4. 保存

> 可选：发件邮箱默认是 `hello@kuajing.space`。你可以在前端开发信面板手动改发件人，或在 `functions/api/send.js` 里改 `defaultFrom`。

### 步骤 4：重新部署
进入 **Deployments** → 最新一次部署 → **Redeploy**，等构建完成。

### 验证
部署后，在网页搜客户 → 点「开发信」→ 生成或手动填写主题正文 → 点 **「云端发送」**：
- 正常：提示 `✅ 已发送，Resend ID：xxxxx`
- 若提示「未配置 RESEND_KEY」：检查变量名拼写、是否 Production、是否 Redeploy
- 若 Resend 报错：检查域名是否已 Verified、DNS 记录是否完整

---

## C. 配置 Gmail 应用专用密码（本地 `.env`）

> 这个密码只给本地群发脚本用，**不用在 Cloudflare 设**。

### 步骤 1：开启 Gmail 两步验证（2FA）
Gmail 必须先开 2FA 才能生成「应用专用密码」。
1. 打开 https://myaccount.google.com/security
2. 找到 **两步验证（2-Step Verification）** → 开启并完成验证

### 步骤 2：生成 16 位应用专用密码（App Password）
1. 仍在 https://myaccount.google.com/security
2. 向下找到 **应用专用密码（App passwords）**（开完 2FA 才会出现）
   - 或直接访问 https://myaccount.google.com/apppasswords
3. 输入一个应用名称（如 `renseek` 或 `Outreach`）→ 点 **创建**
4. 弹出 **16 位密码**（显示成 `abcd efgh ijkl mnop` 这种 4×4 分组）
5. **整段复制**，稍后去掉空格填入 `.env`

> 注意：应用专用密码 ≠ 你的 Gmail 登录密码。它是 16 位字母、专给第三方 SMTP 用。

### 步骤 3：写本地 `.env` 文件
在 `lead-finder` 目录下（和 `send-outreach.mjs` 同级）新建文件 `.env`，内容如下：

```ini
GMAIL_USER=你的邮箱@gmail.com
GMAIL_PASS=abcdefghijklmnop
FROM_NAME=你的品牌名或姓名（可选，留空则用邮箱发件）
DELAY_MS=3000
CSV_FILE=leads.csv
```

- `GMAIL_PASS` 填**去掉空格**的 16 位密码（如 `abcdefghijklmnop`）
- `.env` 已被 `.gitignore` 忽略，**不会提交到 git**，密钥安全
- `DELAY_MS=3000` 表示每封间隔 3 秒，避免被 Gmail 限流（默认即可）

### 步骤 4：安装依赖（只需一次）
在 `lead-finder` 目录下打开终端（Node 环境），运行：

```bash
npm i nodemailer csv-parse dotenv
```

### 步骤 5：导出客户 CSV
在 renseek 网页：
1. 搜索客户 → 点「批量生成开发信（A/B）」（或单条生成后点「保存」）
2. 点「导出我的客户 CSV」→ 保存为 **`leads.csv`**，放到 `lead-finder` 目录（和 `.env`、脚本同级）

### 步骤 6：运行群发
在 `lead-finder` 目录终端运行：

```bash
node send-outreach.mjs
```

- 脚本自动读取 `leads.csv` 中「邮箱 + 开发信主题 + 正文」都非空、且未发过的行
- 通过 Gmail SMTP（端口 465）逐封发送，每封间隔 `DELAY_MS`
- 已发送记录写入 `.sent.log`，**下次运行自动跳过，防重复发**
- 发送量受 Gmail 免费额度约束（普通 Gmail 约 500 封/天），别一次性塞太多

---

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| 生成开发信提示「未配置 DEEPSEEK_KEY」 | 变量名拼错 / 设在 Build 而不是 Production / 没 Redeploy |
| 调 DeepSeek 报 402 | 没充值，去 platform.deepseek.com 充值 |
| 点「云端发送」提示未配置 RESEND_KEY | 变量名拼错 / 没设在 Production / 没 Redeploy |
| 云端发送 Resend 报域名未验证 | 回 Resend 检查域名状态是否 Verified、DNS 记录是否完整 |
| 群发报「请先配置 GMAIL_USER / GMAIL_PASS」 | `.env` 没建或字段名拼错、没放在 `lead-finder` 目录 |
| Gmail 发信报 535 认证失败 | App Password 填错（带了空格 / 用了登录密码）；确认已开 2FA |
| 群发报找不到 leads.csv | 导出的 CSV 没放到脚本同目录，或文件名不是 `leads.csv` |
| 显示「可发送 0 行」 | CSV 里「开发信主题」列为空——先批量生成开发信再导出 |

---

## 发送流程总览

**推荐：云端发送（Resend）**
```
网页搜客户 → 批量生成开发信 → 点「云端发送」→ Cloudflare Function → Resend 发出
```

**备用：本地 Gmail 群发**
```
网页搜客户 → 批量生成开发信 → 导出我的客户 CSV
        ↓
本地 .env 配好 Gmail → node send-outreach.mjs → Gmail 免费群发
```

单发（不发群发）：网页点「开发信」→「用 Gmail 发送」→ 拉起 Gmail 撰写页 → 发送。
