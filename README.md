# renseek — 外贸徽章客户开发器

基于博查(Bocha)搜索 API + Cloudflare Pages 的海外客户开发工具。网页载体，输入产品/国家即返回潜在买家名单，自动初筛工厂/竞争对手。

## 结构
- `public/index.html` — 前端页面（表单 + 结果表格 + CSV 导出）
- `functions/api/search.js` — Cloudflare Pages Function，调用博查 API 并初筛
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
5. **Custom domains** 中添加 `renseek.ccwu.cc`，Cloudflare 会自动在 DNS 加记录（域名已在 CF 托管，无需手动改 NS）
6. 等待证书签发（几分钟），访问 https://renseek.ccwu.cc

## 说明
- 搜索词默认使用买家导向模板 `{产品} distributor {国家} promotional products -{排除词}`，从源头减少中国工厂结果
- 初筛为规则版（关键词命中），后续可接入 LLM 做智能评分与开发信生成
- 博查 key 仅存于服务端/环境变量，不会暴露到前端
