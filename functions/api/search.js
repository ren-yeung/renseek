// Cloudflare Pages Function: /api/search
// 多买家词召回 + 域名去重 + 联系方式提取 + A/B/C/D 评分
// BOCHA_KEY 通过环境变量注入（Cloudflare Pages 控制台设 secret）

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function extractContacts(text) {
  const emails = (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
    .map(e => e.toLowerCase())
    .filter(e => !/(@example|@yourdomain|@domain|@email|@test)/i.test(e));
  const phones = (text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g) || [])
    .map(p => p.trim())
    .filter(p => p.replace(/\D/g, '').length >= 7);
  const social = [];
  const li = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s"'<>]+/i);
  if (li) social.push(li[0]);
  return {
    emails: [...new Set(emails)].slice(0, 5),
    phones: [...new Set(phones)].slice(0, 3),
    social: social[0] || ''
  };
}

function classify(item) {
  const text = ((item.name || '') + ' ' + (item.snippet || '') + ' ' + (item.siteName || '')).toLowerCase();
  const dom = domainOf(item.url || '');
  const sellerKw = ['manufacturer', 'factory', 'made-in-china', 'hisupplier', 'alibaba',
    'oem', 'odm', 'supplier from china', 'china factory', 'shenzhen', 'guangdong', 'china wholesale', 'from china'];
  const buyerKw = ['distributor', 'promotional products', 'promotional', 'wholesale', 'gift',
    'souvenir', 'event', 'agency', 'inc', 'llc', 'corp', 'company', 'based in', 'we supply',
    'request a quote', 'get a quote', 'linkedin.com/company', 'reseller', 'dealer'];

  // 卖家优先：制造商/中国供应链一律标 D 剔除，不被买家词覆盖（避免中国工厂误判为 A）
  const isSeller = sellerKw.some(k => text.includes(k)) || dom.endsWith('.cn');
  if (isSeller)
    return { type: '工厂/竞争对手(建议排除)', score: 'D', note: '疑似制造商/中国供应链，剔除' };

  const isBuyer = buyerKw.some(k => text.includes(k));
  if (isBuyer)
    return { type: '潜在客户(经销商/定制商)', score: 'A', note: '疑似海外买家，优先开发' };
  return { type: '待确认', score: 'B', note: '需人工/LLM 复核' };
}

async function bochaSearch(q, key, n) {
  try {
    const resp = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, summary: true, freshness: 'noLimit', count: n })
    });
    const j = await resp.json();
    return (j && j.data && j.data.webPages && j.data.webPages.value) || [];
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const product = (url.searchParams.get('product') || 'custom lapel pins').trim();
  const country = (url.searchParams.get('country') || 'United States').trim();
  const exclude = (url.searchParams.get('exclude') || '').trim();
  const n = Math.min(parseInt(url.searchParams.get('n') || '10', 10) || 10, 30);

  const key = env.BOCHA_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: '缺少 BOCHA_KEY 环境变量（请在 Cloudflare Pages 控制台设置，并重新部署）' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // 多个买家导向词变体，提高召回（两次搜索合并去重）
  let queries = [
    `${product} distributor ${country} promotional products`,
    `${product} wholesale ${country} buy bulk`
  ];
  if (exclude) {
    const ex = exclude.split(/[\s,，]+/).filter(Boolean).join(' -');
    queries = queries.map(q => q + ' -' + ex);
  }

  try {
    const fetched = await Promise.all(queries.map(q => bochaSearch(q, key, n)));
    const merged = [];
    const seen = new Set();
    for (const list of fetched) {
      for (const it of list) {
        const dom = domainOf(it.url);
        if (!dom || seen.has(dom)) continue;
        seen.add(dom);
        const c = extractContacts((it.name || '') + ' ' + (it.snippet || ''));
        const cls = classify({ ...it, ...c });
        merged.push({
          name: it.name || '',
          url: it.url || '',
          site: it.siteName || '',
          domain: dom,
          snippet: (it.snippet || '').slice(0, 300),
          email: c.emails[0] || '',
          emails: c.emails,
          phone: c.phones[0] || '',
          social: c.social,
          type: cls.type,
          score: cls.score,
          note: cls.note
        });
      }
    }
    const order = { A: 0, B: 1, C: 2, D: 3 };
    merged.sort((a, b) => (order[a.score] || 9) - (order[b.score] || 9));
    return new Response(
      JSON.stringify({ query: queries.join(' | '), count: merged.length, results: merged }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
