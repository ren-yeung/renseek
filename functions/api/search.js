// Cloudflare Pages Function: /api/search
// 替代本地 Node server，运行在 Cloudflare 边缘，BOCHA_KEY 通过环境变量注入（dashboard 设 secret）

function classify(item) {
  const text = ((item.name || '') + ' ' + (item.snippet || '') + ' ' + (item.siteName || '')).toLowerCase();
  const sellerKw = ['manufacturer', 'factory', 'china', 'made-in-china', 'hisupplier',
    'alibaba', 'kunshan', 'guangdong', 'shenzhen', 'from china', 'oem', 'odm'];
  const buyerKw = ['distributor', 'promotional products', 'promotional', 'gift', 'souvenir',
    'event', 'agency', 'inc', 'llc', 'corp', 'company', 'based in', 'wholesale'];
  const isSeller = sellerKw.some(k => text.includes(k));
  const isBuyer = buyerKw.some(k => text.includes(k));
  if (isSeller && !isBuyer) return { type: '工厂/竞争对手(建议排除)', score: 'C', note: '疑似制造商，关键词命中' };
  if (isBuyer && !isSeller) return { type: '潜在客户(经销商/定制商)', score: 'A', note: '疑似海外买家，优先开发' };
  return { type: '待确认', score: 'B', note: '需人工/LLM复核' };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const product = url.searchParams.get('product') || 'custom lapel pins';
  const country = url.searchParams.get('country') || 'United States';
  const exclude = url.searchParams.get('exclude') || '';
  const n = parseInt(url.searchParams.get('n') || '10', 10);

  // 买家导向词模板：从源头避开中国工厂
  let q = `${product} distributor ${country} promotional products`;
  if (exclude) q += ' -' + exclude.split(/[\s,，]+/).filter(Boolean).join(' -');

  const key = env.BOCHA_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: '缺少 BOCHA_KEY 环境变量（请在 Cloudflare Pages 控制台设置）' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  try {
    const resp = await fetch('https://api.bochaai.com/v1/web-search', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, summary: true, freshness: 'noLimit', count: n })
    });
    const j = await resp.json();
    const pages = (j && j.data && j.data.webPages && j.data.webPages.value) || [];
    const results = pages.map(p => ({
      name: p.name || '',
      url: p.url || '',
      site: p.siteName || '',
      snippet: (p.snippet || '').slice(0, 300),
      ...classify(p)
    }));
    return new Response(JSON.stringify({ query: q, count: results.length, results }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
