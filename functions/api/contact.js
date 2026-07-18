// Cloudflare Pages Function: /api/contact?url=...&rev=1
// 深度富集联系方式（$0 自建组合）：
//   ① 深挖官网：首页 + /contact + /about 等子页，抓 mailto: 链接、还原 [at]/[dot] 反混淆写法
//   ③ DoH 查 MX：用 Cloudflare 1.1.1.1 判断该域名能否收信（过滤死邮箱/摆设域）
//   ② 反向搜邮(rev=1)：用博查搜 "@domain" 找全网被列出的企业邮箱（消耗博查额度，仅按需触发）
// 失败也返回 200，避免前端卡死

const UA = 'Mozilla/5.0 (compatible; renseek-bot/1.0)';

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

async function fetchText(target, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const resp = await fetch(target, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA }
    });
    clearTimeout(timer);
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    clearTimeout(timer);
    return '';
  }
}

const BAD_EMAIL = /(@example|@yourdomain|@domain\b|@email\b|@test|@sentry|@2x|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.svg$|\.css$|\.js$)/i;

// 从一段 HTML 中抠邮箱：① mailto: 链接（最可靠） ② 去标签后反混淆 [at]/[dot] 再正则
function emailsFromHtml(html) {
  const set = new Set();
  // 1) mailto:
  (html.match(/mailto:([^"'?>\s]+)/gi) || []).forEach(m => {
    const e = decodeURIComponent(m.replace(/^mailto:/i, '')).toLowerCase().trim();
    if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e) && !BAD_EMAIL.test(e)) set.add(e);
  });
  // 2) 纯文本 + 括号类反混淆（[at]/(at)/{at} 与 [dot]/(dot)/{dot}，误报极低）
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const de = text
    .replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi, '@')
    .replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi, '.');
  (de.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).forEach(raw => {
    const e = raw.toLowerCase();
    if (!BAD_EMAIL.test(e)) set.add(e);
  });
  return [...set];
}

function phonesFromHtml(html) {
  const text = html.replace(/<[^>]+>/g, ' ');
  return [...new Set(
    (text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g) || [])
      .map(p => p.trim())
      .filter(p => p.replace(/\D/g, '').length >= 7 && p.replace(/\D/g, '').length <= 15)
  )];
}

function socialFromHtml(html) {
  const li = html.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s"'<>]+/i);
  return li ? li[0] : '';
}

// 从首页 HTML 找 contact/about 类子页链接（绝对化）
function findSubpages(html, baseUrl) {
  const links = new Set();
  (html.match(/href\s*=\s*["']([^"']+)["']/gi) || []).forEach(h => {
    const m = h.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m) return;
    const href = m[1];
    if (/(contact|about|kontakt|impressum|reach|get-in-touch|connect)/i.test(href)) {
      try { links.add(new URL(href, baseUrl).href); } catch {}
    }
  });
  return [...links].slice(0, 3);
}

// ③ DoH 查 MX：判断域名能否收信
async function checkMX(domain) {
  if (!domain) return { mx: null, mxHost: '' };
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: 'application/dns-json' }
    });
    const j = await r.json();
    const ans = (j.Answer || []).filter(a => a.type === 15);
    return {
      mx: ans.length > 0,
      mxHost: ans[0] ? String(ans[0].data).split(' ').pop().replace(/\.$/, '') : ''
    };
  } catch {
    return { mx: null, mxHost: '' };
  }
}

// ② 反向搜邮：用博查搜 "@domain" 找全网被列出的该公司邮箱（消耗博查额度）
async function reverseEmailSearch(domain, key) {
  if (!domain || !key) return [];
  try {
    const resp = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `"@${domain}"`, summary: true, freshness: 'noLimit', count: 10 })
    });
    const j = await resp.json();
    const pages = (j && j.data && j.data.webPages && j.data.webPages.value) || [];
    const blob = pages.map(p => (p.name || '') + ' ' + (p.snippet || '') + ' ' + (p.summary || '')).join(' ');
    const found = (blob.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
      .map(e => e.toLowerCase())
      .filter(e => e.endsWith('@' + domain) && !BAD_EMAIL.test(e));
    return [...new Set(found)];
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  const rev = url.searchParams.get('rev') === '1';
  if (!target) {
    return new Response(JSON.stringify({ error: '缺少 url 参数' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const domain = domainOf(target);
  const emailSet = new Set();
  const phoneSet = new Set();
  let social = '';
  let pagesFetched = 0;

  try {
    // ① 首页
    const home = await fetchText(target, 8000);
    if (home) {
      pagesFetched++;
      emailsFromHtml(home).forEach(e => emailSet.add(e));
      phonesFromHtml(home).forEach(p => phoneSet.add(p));
      social = socialFromHtml(home) || social;

      // 跟进 contact/about 子页
      const subs = findSubpages(home, target);
      const subHtmls = await Promise.all(subs.map(s => fetchText(s, 6000)));
      subHtmls.forEach(h => {
        if (!h) return;
        pagesFetched++;
        emailsFromHtml(h).forEach(e => emailSet.add(e));
        phonesFromHtml(h).forEach(p => phoneSet.add(p));
        social = social || socialFromHtml(h);
      });
    }

    // ② 反向搜邮（仅 rev=1）
    let revCount = 0;
    if (rev) {
      const revEmails = await reverseEmailSearch(domain, env.BOCHA_KEY);
      revEmails.forEach(e => emailSet.add(e));
      revCount = revEmails.length;
    }

    // ③ MX
    const { mx, mxHost } = await checkMX(domain);

    // 本域邮箱优先排序
    const emails = [...emailSet].sort((a, b) => {
      const ad = a.endsWith('@' + domain) ? 0 : 1;
      const bd = b.endsWith('@' + domain) ? 0 : 1;
      return ad - bd;
    }).slice(0, 10);

    return new Response(JSON.stringify({
      url: target, domain,
      emails,
      phones: [...phoneSet].slice(0, 5),
      social,
      mx, mxHost,
      rev, revCount, pagesFetched
    }), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({
      url: target, domain, emails: [], phones: [], social: '', mx: null, mxHost: '', error: String(e)
    }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
