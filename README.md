# renseek — 外贸徽章客户开发器

基于博查(Bocha)搜索 API + Cloudflare Pages 的海外客户开发工具。网页载体，输入产品/国家即返回潜在买家名单，自动初筛工厂/竞争对手。

## 结构
- `public/index.html` — 前端页面（表单 + 结果表格 + 联系方式 + 我的客户 CRM + CSV 导出）
- `functions/api/search.js` — Cloudflare Pages Function，多买家词召回 + 域名去重 + 联系方式提取 + A/B/C/D 评分
- `functions/api/contact.js` — 按需抓取目标官网，深度提取邮箱/电话/社媒
- `functions/api/draft.js` — 用 DeepSeek 生成英文开发信（主题+正文），密钥走 `DEEPSEEK_KEY` 环境变量
- `send-outreach.mjs` — 本地 Node 脚本，读取导出的 CSV（含开发信列）经 Gmail SMTP 免费群发（避开 Cloudflare 出站 TCP 限制）
- `server.js` — 本地开发用的 Node 服务（非部署必需）
- `wrangler.toml` — Cloudflare Pages 配置

## 本地运行
```bash
export BOCHA_KEY='你的博查key'
node server.js
# 打开 http://localhost:3000
```

## 部署到 Cloudflare Pages（自定义域 renseek.ccwu.cc）
1. 把本仓库推到 GitHub `ren-yeung/renseek`
2. 登录 Cloudflare Dashboard → **Workers & Pages** → **Create** → 选 **Pages** → 连接 GitHub 仓库 `renseek`
3. 构建设置：
   - Framework preset：**None**
   - Build command：留空
   - Output directory：**`public`**
4. 部署完成后进入项目 **Settings → Environment variables**，添加：
   - 变量名 `BOCHA_KEY`，值填你的博查 key（建议设为加密变量）
   - 变量名 `DEEPSEEK_KEY`，值填你的 DeepSeek API key（开发信生成功能需要，建议设为加密变量）
   - 可选：`DEEPSEEK_MODEL`（默认 `deepseek-chat`，可用 `deepseek-reasoner`）、`DEEPSEEK_BASE`（默认官方 `https://api.deepseek.com/v1`）
5. **Custom domains** 中添加 `renseek.ccwu.cc`，Cloudflare 会自动在 DNS 加记录（域名已在 CF 托管，无需手动改 NS）
6. 等待证书签发（几分钟），访问 https://renseek.ccwu.cc

## 说明
- 搜索词默认使用两个买家导向变体（`distributor … promotional products` + `wholesale … buy bulk`），合并后按域名去重，从源头减少中国工厂结果并提高召回
- 评分细化：A=疑似海外买家(优先开发) / B=待确认(需人工或 LLM 复核) / D=工厂/竞争对手(建议排除)
- 每条结果自动从摘要提取邮箱/电话/社媒；点「深挖」可抓取对方官网做深度提取
- 「我的客户」面板用浏览器 localStorage 沉淀客户，支持跟进状态(待联系/已联系/已回复/已成交)与备注，可单独导出 CSV
- 初筛为规则版（关键词命中），后续可接入 LLM 做智能评分与开发信生成
- 博查 key 仅存于服务端/环境变量，不会暴露到前端

## 更新日志
- v2：多买家词变体召回 + 域名去重 + 摘要联系方式提取 + A/B/C/D 评分 + 官网深挖接口 `/api/contact` + 「我的客户」本地 CRM（localStorage 沉淀与跟进状态）
- v3：新增 **AI 开发信**——DeepSeek 生成英文开发信（`/api/draft`）；前端「开发信」面板支持单条生成/复制/「用 Gmail 发送」(拉起撰写页) + 批量生成 A/B 类 + 导出 CSV 含开发信列；附本地群发脚本 `send-outreach.mjs`（Gmail SMTP 免费群发，绕开 Cloudflare 出站 TCP 限制）
