-- 客户管理新增「客户来源 / 客户类型（搜索词 + 中文）」字段
-- 仅对「已存在的线上库」执行一次（新建库直接用 init-db.sql 已含这些列）。
-- 执行方式：
--   方式 A（CLI）：npx wrangler d1 execute renseek --file=migrate-source.sql --remote
--   方式 B（后台）：Cloudflare Dashboard → D1 → renseek → Query 粘贴执行
-- 若重复执行报错 "duplicate column"，说明已加过，忽略即可。

ALTER TABLE leads ADD COLUMN source TEXT;          -- 客户来源渠道（自建SearXNG / 博查AI / 谷歌CSE / 谷歌地图 / OSM地图 / 全部）
ALTER TABLE leads ADD COLUMN search_term TEXT;     -- 客户类型：搜索词原文
ALTER TABLE leads ADD COLUMN search_term_cn TEXT;  -- 客户类型：搜索词中文翻译
