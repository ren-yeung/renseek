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

-- 邮箱质量初筛结果（本地 CF DoH 检测，无第三方依赖）
-- 注意：下面 3 条 ALTER 只需对「已存在的线上库」执行一次；
--   新建库（直接跑本文件建表）可忽略，因为下方建表语句已包含这些列。
--   若重复执行报错 "duplicate column"，说明已加过，忽略即可。
ALTER TABLE leads ADD COLUMN email_status TEXT;     -- valid/role/risky/invalid/no_mx/unknown
ALTER TABLE leads ADD COLUMN email_score  INTEGER;  -- 0-100，越高越值得发
ALTER TABLE leads ADD COLUMN email_verify TEXT;     -- JSON：每个邮箱的检测明细 {email:{...}}

-- 常用索引（加速管理页筛选/搜索）
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

-- ===== 若从零新建库，可直接用下面这个完整建表（含初筛字段）替代开头 CREATE TABLE =====
-- CREATE TABLE IF NOT EXISTS leads (
--   id            INTEGER PRIMARY KEY AUTOINCREMENT,
--   name          TEXT,
--   url           TEXT UNIQUE,
--   domain        TEXT,
--   type          TEXT,
--   score         TEXT,
--   email         TEXT,
--   emails        TEXT,
--   phone         TEXT,
--   social        TEXT,
--   mx            INTEGER,
--   snippet       TEXT,
--   status        TEXT DEFAULT '待联系',
--   note          TEXT,
--   draft_subject TEXT,
--   draft_body    TEXT,
--   email_status  TEXT,
--   email_score   INTEGER,
--   email_verify  TEXT,
--   created_at    TEXT,
--   updated_at    TEXT
-- );
