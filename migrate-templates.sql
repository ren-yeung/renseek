-- 仅对线上已存在的 renseek 库追加 templates 表（避免重跑 init-db.sql 的 ALTER 报错）
-- 用法：npx wrangler d1 execute renseek --file=migrate-templates.sql --remote
CREATE TABLE IF NOT EXISTS templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  brand       TEXT,
  sender      TEXT,
  product     TEXT,
  selling     TEXT,
  company     TEXT,
  whatsapp    TEXT,
  reply_to    TEXT,
  from_addr   TEXT,
  body_tpl    TEXT,
  is_default  INTEGER DEFAULT 0,
  created_at  TEXT,
  updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_templates_default ON templates(is_default DESC);
