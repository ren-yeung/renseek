// Cloudflare Pages Function: /api/templates
// 开发信模板（Cloudflare D1，binding 名 DB）
//   GET    /api/templates          列出全部（默认模板在前）
//   POST   /api/templates          新建模板（body 不含 id）
//   PUT    /api/templates          更新模板（body 含 id；is_default:true 时先把其他置 0）
//   DELETE /api/templates?id=      删除模板
//
// 部署前提：在 Cloudflare Pages 后台「Settings → Functions → D1 database bindings」绑定名为 DB 的 D1 实例，
// 并执行 init-db.sql（含 templates 表）建表。未绑定时返回友好提示。

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) {
    return json({ error: '服务端未配置 D1 数据库（binding 名应为 DB）。请在 Cloudflare Pages 后台绑定 D1 并执行 init-db.sql 建表后重新部署。' }, 500);
  }
  const method = request.method;
  try {
    if (method === 'GET') return await handleGet(request, db);
    if (method === 'POST') return await handlePost(request, db);
    if (method === 'PUT') return await handlePut(request, db);
    if (method === 'DELETE') return await handleDelete(request, db);
    return new Response('Method Not Allowed', { status: 405 });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

async function handleGet(request, db) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (id) {
    const row = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
    if (!row) return json({ error: '模板不存在' }, 404);
    return json({ template: normalizeRow(row) });
  }
  const { results } = await db.prepare(
    'SELECT * FROM templates ORDER BY is_default DESC, updated_at DESC, id DESC'
  ).all();
  const rows = (results || []).map(normalizeRow);
  return json({ count: rows.length, results: rows });
}

async function handlePost(request, db) {
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  if (!b.name || !b.name.trim()) return json({ error: '缺少模板名称 name' }, 400);
  const now = new Date().toISOString();
  const { meta } = await db.prepare(
    `INSERT INTO templates (name, brand, sender, product, selling, company, whatsapp, reply_to, from_addr, body_tpl, is_default, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    b.name.trim(), b.brand || '', b.sender || '', b.product || '', b.selling || '',
    b.company || '', b.whatsapp || '', b.reply_to || '', b.from_addr || '', b.body_tpl || '',
    b.is_default ? 1 : 0, now, now
  ).run();
  const id = meta ? meta.last_row_id : null;
  // 若新建即设为默认，清掉其他默认
  if (b.is_default && id) {
    await db.prepare('UPDATE templates SET is_default = 0 WHERE id != ?').bind(id).run();
  }
  return json({ ok: true, id });
}

async function handlePut(request, db) {
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  if (!b.id) return json({ error: '缺少 id' }, 400);
  const existing = await db.prepare('SELECT id FROM templates WHERE id = ?').bind(b.id).first();
  if (!existing) return json({ error: '模板不存在' }, 404);

  const now = new Date().toISOString();
  const sets = [];
  const binds = [];
  const fields = ['name', 'brand', 'sender', 'product', 'selling', 'company', 'whatsapp', 'reply_to', 'from_addr', 'body_tpl'];
  fields.forEach(f => { if (f in b) { sets.push(`${f} = ?`); binds.push(b[f] == null ? '' : b[f]); } });
  if (!sets.length) return json({ error: '没有要更新的字段' }, 400);
  sets.push('updated_at = ?'); binds.push(now);
  binds.push(b.id);
  await db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  if (b.is_default) {
    await db.prepare('UPDATE templates SET is_default = 0 WHERE id != ?').bind(b.id).run();
    await db.prepare('UPDATE templates SET is_default = 1 WHERE id = ?').bind(b.id).run();
  }
  return json({ ok: true, id: b.id });
}

async function handleDelete(request, db) {
  const url = new URL(request.url);
  let id = url.searchParams.get('id');
  if (!id) {
    try { const b = await request.json(); id = b && b.id; } catch {}
  }
  if (!id) return json({ error: '缺少 id' }, 400);
  // 删除前若它是默认，清掉标记（is_default 字段随行删除）
  await db.prepare('DELETE FROM templates WHERE id = ?').bind(id).run();
  return json({ ok: true, id });
}

function normalizeRow(r) {
  return {
    id: r.id,
    name: r.name || '',
    brand: r.brand || '',
    sender: r.sender || '',
    product: r.product || '',
    selling: r.selling || '',
    company: r.company || '',
    whatsapp: r.whatsapp || '',
    reply_to: r.reply_to || '',
    from_addr: r.from_addr || '',
    body_tpl: r.body_tpl || '',
    is_default: r.is_default === 1 || r.is_default === true
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
