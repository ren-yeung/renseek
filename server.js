const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BOCHA_URL = 'https://api.bochaai.com/v1/web-search';

// 轻量买家/卖家初筛（规则版，预留接 LLM 智能判定）
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

function buildQuery(product, country, exclude) {
  // 买家导向词模板：避免搜出中国工厂
  let q = `${product} distributor ${country} promotional products`;
  if (exclude) q += ' -' + exclude.split(/[\s,，]+/).filter(Boolean).join(' -');
  return q;
}

async function searchBocha(query, count = 10) {
  const key = process.env.BOCHA_KEY;
  if (!key) throw new Error('缺少 BOCHA_KEY 环境变量');
  const resp = await fetch(BOCHA_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, summary: true, freshness: 'noLimit', count })
  });
  const j = await resp.json();
  const pages = (j && j.data && j.data.webPages && j.data.webPages.value) || [];
  return pages.map(p => ({
    name: p.name || '',
    url: p.url || '',
    site: p.siteName || '',
    snippet: (p.snippet || '').slice(0, 300),
    ...classify(p)
  }));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/index'))) {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (req.url.startsWith('/api/search')) {
    const u = new URL(req.url, 'http://localhost');
    const product = u.searchParams.get('product') || 'custom lapel pins';
    const country = u.searchParams.get('country') || 'United States';
    const exclude = u.searchParams.get('exclude') || '';
    const n = parseInt(u.searchParams.get('n') || '10', 10);
    const query = buildQuery(product, country, exclude);
    try {
      const results = await searchBocha(query, n);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ query, count: results.length, results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '0.0.0.0', () => console.log('Lead finder running: http://localhost:' + PORT));
