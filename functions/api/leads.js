// Cloudflare Pages Function: /api/leads
// 客户管理数据库（Cloudflare D1，binding 名 DB）
//   GET    /api/leads?status=&q=   列出客户（可按跟进状态/关键词筛选）
//   POST   /api/leads              导入/新增客户（按 url upsert，重复导入只更新开发阶段字段，不覆盖跟进字段）
//   PUT    /api/leads              编辑客户（任意字段）
//   DELETE /api/leads?id=          删除客户
//
// 部署前提：在 Cloudflare Pages 后台「Settings → Functions → D1 database bindings」绑定一个名为 DB 的 D1 实例，
// 并执行 init-db.sql 建表。未绑定时返回友好提示。

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
  const status = (url.searchParams.get('status') || '').trim();
  const q = (url.searchParams.get('q') || '').trim();
  let sql = 'SELECT * FROM leads WHERE 1=1';
  const binds = [];
  if (status) { sql += ' AND status = ?'; binds.push(status); }
  if (q) {
    sql += ' AND (name LIKE ? OR url LIKE ? OR email LIKE ? OR social LIKE ?)';
    const like = '%' + q + '%';
    binds.push(like, like, like, like);
  }
  sql += ' ORDER BY (CASE status WHEN "待联系" THEN 0 WHEN "已联系" THEN 1 WHEN "已回复" THEN 2 WHEN "已成交" THEN 3 ELSE 9 END), created_at DESC';
  const { results } = await db.prepare(sql).bind(...binds).all();
  const rows = (results || []).map(normalizeRow);
  return json({ count: rows.length, results: rows });
}

async function handlePost(request, db) {
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  if (!b.url) return json({ error: '缺少 url' }, 400);
  const now = new Date().toISOString();
  const emailsArr = (b.emails && Array.isArray(b.emails) && b.emails.length)
    ? b.emails
    : (b.email ? [b.email] : []);
  const emailsJson = JSON.stringify(emailsArr);

  const existing = await db.prepare('SELECT id FROM leads WHERE url = ?').bind(b.url).first();
  if (existing) {
    // 已存在：只更新「开发阶段字段」，保留用户维护的跟进字段（status/note/draft）
    await db.prepare(
      `UPDATE leads SET name=?, type=?, score=?, email=?, emails=?, phone=?, social=?, mx=?, snippet=?, domain=?, email_status=?, email_score=?, updated_at=? WHERE url=?`
    ).bind(
      b.name || '', b.type || '', b.score || '', b.email || '', emailsJson,
      b.phone || '', b.social || '', (b.mx === undefined ? null : (b.mx ? 1 : 0)),
      b.snippet || '', b.domain || '', (b.email_status || ''), (b.email_score !== undefined ? b.email_score : null),
      now, b.url
    ).run();
    return json({ ok: true, id: existing.id, existed: true });
  }
  const { meta } = await db.prepare(
    `INSERT INTO leads (name,url,domain,type,score,email,emails,phone,social,mx,snippet,status,note,email_status,email_score,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    b.name || '', b.url, b.domain || '', b.type || '', b.score || '',
    b.email || '', emailsJson, b.phone || '', b.social || '',
    (b.mx === undefined ? null : (b.mx ? 1 : 0)), b.snippet || '',
    '待联系', '', (b.email_status || ''), (b.email_score !== undefined ? b.email_score : null), now, now
  ).run();
  return json({ ok: true, id: meta ? meta.last_row_id : null, existed: false });
}

async function handlePut(request, db) {
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  if (!b.id) return json({ error: '缺少 id' }, 400);
  const now = new Date().toISOString();
  const sets = [];
  const binds = [];
  const fields = ['name', 'url', 'domain', 'type', 'score', 'email', 'phone', 'social', 'status', 'note', 'draft_subject', 'draft_body', 'email_status', 'email_score'];
  fields.forEach(f => { if (f in b) { sets.push(`${f} = ?`); binds.push(b[f]); } });
  if (b.emails) { sets.push('emails = ?'); binds.push(JSON.stringify(b.emails)); }
  if (b.email_verify !== undefined) { sets.push('email_verify = ?'); binds.push(b.email_verify ? JSON.stringify(b.email_verify) : null); }
  if (b.mx !== undefined) { sets.push('mx = ?'); binds.push(b.mx ? 1 : 0); }
  if (!sets.length) return json({ error: '没有要更新的字段' }, 400);
  sets.push('updated_at = ?'); binds.push(now);
  binds.push(b.id);
  await db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true, id: b.id });
}

async function handleDelete(request, db) {
  const url = new URL(request.url);
  let id = url.searchParams.get('id');
  if (!id) {
    try { const b = await request.json(); id = b && b.id; } catch {}
  }
  if (!id) return json({ error: '缺少 id' }, 400);
  await db.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
  return json({ ok: true, id });
}

function normalizeRow(r) {
  let emails = [];
  try { emails = r.emails ? JSON.parse(r.emails) : (r.email ? [r.email] : []); } catch { emails = []; }
  let emailVerify = null;
  try { emailVerify = r.email_verify ? JSON.parse(r.email_verify) : null; } catch { emailVerify = null; }
  return {
    id: r.id,
    name: r.name, url: r.url, domain: r.domain, type: r.type, score: r.score,
    email: r.email, emails, phone: r.phone, social: r.social,
    mx: r.mx === null || r.mx === undefined ? null : !!r.mx,
    snippet: r.snippet, status: r.status || '待联系', note: r.note || '',
    draft_subject: r.draft_subject || '', draft_body: r.draft_body || '',
    email_status: r.email_status || '', email_score: (typeof r.email_score === 'number' ? r.email_score : (r.email_score ? parseInt(r.email_score, 10) : null)),
    email_verify: emailVerify,
    created_at: r.created_at, updated_at: r.updated_at
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
