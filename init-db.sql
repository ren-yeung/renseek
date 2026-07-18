-- 客户管理数据库建表脚本（Cloudflare D1）
-- 用法：
--   方式 A（CLI）：npx wrangler d1 execute renseek --file=init-db.sql --remote
--   方式 B（后台）：在 Cloudflare Dashboard → D1 → 你的库 → Query 里粘贴执行
--
-- 前提：已在 Cloudflare Pages 项目绑定名为 DB 的 D1 实例（Settings → Functions → D1 database bindings）。

CREATE TABLE IF NOT EXISTS leads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  url           TEXT UNIQUE,
  domain        TEXT,
  type          TEXT,
  score         TEXT,
  email         TEXT,
  emails        TEXT,        -- JSON 数组字符串，如 ["a@x.com","b@y.com"]
  phone         TEXT,
  social        TEXT,
  mx            INTEGER,      -- 1=可收信, 0=无MX, NULL=未检测
  snippet       TEXT,
  status        TEXT DEFAULT '待联系',   -- 待联系/已联系/已回复/已成交
  note          TEXT,
  draft_subject TEXT,
  draft_body    TEXT,
  created_at    TEXT,
  updated_at    TEXT
);

-- 常用索引（加速管理页筛选/搜索）
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
