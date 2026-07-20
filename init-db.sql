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

-- ===== 开发信模板表（多套发件人资料，供生成开发信时选用） =====
CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                 -- 模板名称
  brand       TEXT,                          -- 品牌名
  sender      TEXT,                          -- 发件人姓名
  product     TEXT,                          -- 产品
  selling     TEXT,                          -- 卖点 / 公司信息（MOQ/交期/定制/价格等）
  company     TEXT,                          -- 公司信息（公司名/官网）
  whatsapp    TEXT,                          -- WhatsApp 号码（可带 wa.me 链接）
  reply_to    TEXT,                          -- 回复接收邮箱（Reply-To）
  from_addr   TEXT,                          -- 发件邮箱 / 显示名（From）
  body_tpl    TEXT,                          -- 可选正文模板，支持占位符 {{company}} {{website}} {{product}} {{whatsapp}} {{sender}} {{brand}} {{company_info}}
  is_default  INTEGER DEFAULT 0,             -- 1=默认模板
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_templates_default ON templates(is_default DESC);

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
