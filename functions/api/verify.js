// Cloudflare Pages Function: /api/verify (POST)
// 邮箱质量初筛 —— 纯 CF 内部运行，不依赖任何第三方服务，零成本。
//
// 检测项：
//   1) 语法 (syntax)            —— 标准邮箱格式正则
//   2) 一次性域名 (disposable)  —— 本地名单（throwaway / 临时邮箱）
//   3) 角色账号 (role)          —— info@ / sales@ 等，可收信但优先级低
//   4) MX 记录 (mx)             —— 走 Cloudflare 1.1.1.1 DoH 查询，不连 25 端口、不做 SMTP 握手
//
// 设计原则（用户要求）：
//   - 不碰 25 端口，不连第三方 API，因此永远不会因为"额度/鉴权/网络"卡壳
//   - 任何异常（含 DoH 失败）都降级返回 HTTP 200 + 结果，绝不阻断前端
//
// 请求（单条）：{ "email": "x@y.com" }
// 请求（批量）：{ "emails": [...], "concurrency": 5 }   批量上限 50
//
// 返回（单条）：
//   { email, syntax, disposable, role, mx, mxHosts[], status, score, reason, degraded? }
//   status ∈ valid(可收信) / role(角色号) / risky(一次性) / invalid(格式错) / no_mx(无MX) / unknown(MX查询失败)
//   score  ∈ 0-100（越高越值得发）
// 返回（批量）：
//   { results:[...], degraded?, message? }

const DOH_ENDPOINT = 'https://1.1.1.1/dns-query';
const REQ_TIMEOUT = 8000;
const BATCH_LIMIT = 50;
const MAX_CONCURRENCY = 5;

// 常见一次性/临时邮箱域名（初筛用，覆盖主流服务即可）
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'sharklasers.com', 'grr.la',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'throwawaymail.com',
  'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com',
  'trashmail.com', 'trashmail.net', 'mailnesia.com', 'fakeinbox.com', 'mailcatch.com',
  'mintemail.com', 'spam4.me', 'spamgourmet.com', 'tempinbox.com', 'tempr.email', 'moakt.com',
  'emailondeck.com', 'mailtemp.net', 'tempmailo.com', 'disposablemail.com', 'fakemailgenerator.com',
  'mailhub.io', 'mailnesia.com', 'burnermail.io', 'temp-mail.io', 'dropmail.me', 'luxusmail.org',
  'armyspy.com', 'inboxbear.com', 'tempmailaddress.com', 'emailfake.com', 'fake-mail.cc'
]);
// 角色账号前缀（可收信但通常是公共邮箱，优先级低于个人名）
const ROLE = new Set([
  'info', 'sales', 'admin', 'contact', 'support', 'hello', 'office', 'service', 'team',
  'marketing', 'noreply', 'no-reply', 'billing', 'help', 'careers', 'hr', 'webmaster',
  'postmaster', 'accounts', 'enquiries', 'customer', 'feedback', 'press'
]);

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  const isBatch = Array.isArray(body.emails);
  if (!isBatch && !body.email) {
    return jsonError('缺少 email 或 emails[]', 400);
  }
  if (isBatch && body.emails.length > BATCH_LIMIT) {
    return jsonError(`批量上限 ${BATCH_LIMIT}，请分批验证（CF 函数有超时限制）`, 400);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT * (isBatch ? 6 : 1));

  try {
    if (isBatch) {
      return json(await screenBatch(body.emails, ctrl.signal, body.concurrency || MAX_CONCURRENCY));
    }
    return json(await screenOne(body.email, ctrl.signal));
  } catch (e) {
    if (e.name === 'AbortError') {
      return jsonError('邮箱初筛超时，请调小批量或稍后重试', 504);
    }
    return jsonError('邮箱初筛内部错误：' + String(e), 500);
  } finally {
    clearTimeout(timer);
  }
}

// 单条初筛（无第三方依赖）
async function screenOne(email, signal) {
  const e = (email || '').trim();
  if (!EMAIL_RE.test(e)) {
    return { email: e, syntax: false, disposable: false, role: false, mx: false, mxHosts: [], status: 'invalid', score: 0, reason: 'syntax' };
  }
  const [local, domain] = e.split('@');
  const disposable = DISPOSABLE.has(domain.toLowerCase());
  const role = ROLE.has(local.toLowerCase());

  let mxRes = { mx: false, hosts: [] };
  try {
    mxRes = await mxLookup(domain, signal);
  } catch {
    // DoH 失败不卡壳：标记 unknown，仍返回 200
    return {
      email: e, syntax: true, disposable, role, mx: null, mxHosts: [],
      status: 'unknown', score: 50, reason: 'mx_lookup_failed',
      degraded: true, message: 'MX 查询失败（网络），无法判定可收信状态'
    };
  }

  if (!mxRes.mx) {
    return { email: e, syntax: true, disposable, role, mx: false, mxHosts: [], status: 'no_mx', score: 10, reason: 'no_mx' };
  }

  // 有 MX：可收信
  let score = 90;
  let status = 'valid';
  if (disposable) { score = 20; status = 'risky'; }
  else if (role) { score = 70; status = 'role'; }

  return { email: e, syntax: true, disposable, role, mx: true, mxHosts: mxRes.hosts, status, score, reason: status };
}

// 批量初筛：带并发池（本地无额度限制，仅控制 DoH 并发数）
async function screenBatch(emails, signal, concurrency) {
  const out = new Array(emails.length);
  let idx = 0;
  let degraded = false;
  let message = null;

  await Promise.all(Array.from({ length: Math.min(concurrency, MAX_CONCURRENCY) }, async () => {
    while (true) {
      const cur = idx++;
      if (cur >= emails.length) break;
      const r = await screenOne(emails[cur], signal);
      out[cur] = r;
      if (r.degraded) { degraded = true; message = r.message || message; }
    }
  }));

  return { results: out, ...(degraded ? { degraded: true, message } : {}) };
}

// 通过 Cloudflare DoH 查询 MX 记录（1.1.1.1，JSON 模式）
async function mxLookup(domain, signal) {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`;
  const resp = await fetch(url, {
    headers: { accept: 'application/dns-json' },
    signal
  });
  if (!resp.ok) return { mx: false, hosts: [] };
  const j = await resp.json().catch(() => null);
  const answers = (j && j.Answer) || [];
  const hosts = answers
    .filter(a => a.type === 15)
    .map(a => String(a.data).replace(/\.$/, ''))
    .sort();
  return { mx: hosts.length > 0, hosts };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
function jsonError(msg, status) {
  return json({ error: msg }, status);
}
