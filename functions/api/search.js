// Cloudflare Pages Function: /api/search
// 多源聚合（博查网页搜索 + Google 地图本地商家）+ 域名去重 + 联系方式提取 + A/B/C/D 评分
// BOCHA_KEY / SERPAPI_KEY 通过环境变量注入（Cloudflare Pages 控制台设 secret）

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

const CN_DOMAINS = new Set([
  '1688.com', 'alibaba.com', 'alibaba.cn', 'taobao.com', 'tmall.com', 'jd.com',
  'pinduoduo.com', 'zhihu.com', 'baidu.com', 'sina.com.cn', 'sohu.com', '163.com',
  'qq.com', 'weibo.com', 'weidian.com', 'made-in-china.com', 'hisupplier.com',
  'globalsources.com', 'ec21.com', 'tradekey.com', 'dhgate.com', 'aliexpress.com',
  'china.cn', 'chinan.cn', 'yiwu.cn', 'cantonfair.org.cn', 'madeinchina.com',
  'chinavasion.com', 'tomtop.com', 'banggood.com', 'lightinthebox.com', 'dx.com',
  'suning.com', 'dangdang.com', 'gome.com.cn', 'vip.com', 'joom.com'
]);

function isChinaSite(item) {
  const dom = domainOf(item.url || '').replace(/^www\./, '');
  if (CN_DOMAINS.has(dom)) return true;
  if (dom.endsWith('.cn')) return true;
  const text = ((item.name || '') + ' ' + (item.snippet || '') + ' ' + (item.siteName || '')).toLowerCase();
  const cnKw = [
    '1688', 'alibaba', 'made-in-china', 'made in china', 'china supplier', 'chinese manufacturer',
    'shenzhen', 'guangdong', 'yiwu', 'china factory', 'manufacturer in china', 'supplier from china',
    '中国', '中國', '阿里巴巴', '淘宝', '天貓', '天猫', '京东', '拼多多', '中国制造', '中国工厂',
    '厂家', '供应商'
  ];
  return cnKw.some(k => text.includes(k));
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

// 多语言买家信号词（用于 classify 评分）。
// 英文基础词始终生效（跨境站点常混用英文品牌词 / LinkedIn / Inc 等），再叠加目标语言本地词，
// 避免非英文搜索结果（如日语标题）因无英文买家词被误判为 B。
const BUYER_KW_BY_LANG = {
  English: ['distributor', 'promotional products', 'promotional', 'wholesale', 'gift', 'souvenir', 'event', 'agency', 'inc', 'llc', 'corp', 'company', 'based in', 'we supply', 'request a quote', 'get a quote', 'linkedin.com/company', 'reseller', 'dealer'],
  Spanish: ['distribuidor', 'productos promocionales', 'promocional', 'mayorista', 'venta al por mayor', 'regalo', 'souvenir', 'evento', 'agencia', 's.l.', 's.a.', 'empresa', 'solicitar cotización', 'solicitar presupuesto', 'revendedor', 'concesionario'],
  French: ['distributeur', 'produits promotionnels', 'promotionnel', 'grossiste', 'vente en gros', 'cadeau', 'souvenir', 'événement', 'agence', 's.a.r.l.', 's.a.s.', 'entreprise', 'demander un devis', 'revendeur', 'concessionnaire'],
  German: ['distributor', 'großhandel', 'grosshandel', 'werbeartikel', 'geschenk', 'souvenir', 'veranstaltung', 'agentur', 'gmbh', 'ug', 'ag', 'firma', 'anfrage', 'angebot anfordern', 'wiederverkäufer', 'händler'],
  Russian: ['дистрибьютор', 'оптовая', 'опт', 'рекламная продукция', 'сувенир', 'подарок', 'мероприятие', 'агентство', 'ооо', 'ао', 'компания', 'запросить кп', 'получить кп', 'реализатор', 'дилер'],
  Portuguese: ['distribuidor', 'atacado', 'produtos promocionais', 'promocional', 'presente', 'souvenir', 'evento', 'agência', 'ltda', 's.a.', 'empresa', 'solicitar orçamento', 'revendedor', 'concessionária'],
  Italian: ['distributore', 'ingrosso', 'prodotti promozionali', 'promozionale', 'regalo', 'souvenir', 'evento', 'agenzia', 's.r.l.', 's.p.a.', 'azienda', 'richiedi preventivo', 'rivenditore', 'concessionario'],
  Japanese: ['卸売業者', '卸売', '販促品', 'プロモーション', '販促', 'ギフト', '記念品', 'ノベルティ', '代理店', '会社', '見積もり', '販売', '小売', 'ディーラー', 'リセラー', '株式会社', '有限会社']
};

function classify(item) {
  // 优先把中国站/中国平台过滤掉
  if (isChinaSite(item))
    return { type: '工厂/竞争对手(建议排除)', score: 'D', note: '疑似中国站点/平台，已过滤' };

  const text = ((item.name || '') + ' ' + (item.snippet || '') + ' ' + (item.siteName || '')).toLowerCase();
  const dom = domainOf(item.url || '');
  const sellerKw = ['manufacturer', 'factory', 'hisupplier', 'oem', 'odm', 'supplier from china', 'china factory', 'from china'];
  const lang = (item.target || 'English').trim();
  const buyerKw = (BUYER_KW_BY_LANG.English.concat(BUYER_KW_BY_LANG[lang] || []))
    .map(k => k.toLowerCase());

  // 卖家优先：制造商/中国供应链一律标 D 剔除，不被买家词覆盖（避免中国工厂误判为 A）
  const isSeller = sellerKw.some(k => text.includes(k)) || dom.endsWith('.cn');
  if (isSeller)
    return { type: '工厂/竞争对手(建议排除)', score: 'D', note: '疑似制造商/中国供应链，剔除' };

  const isBuyer = buyerKw.some(k => text.includes(k));
  if (isBuyer)
    return { type: '潜在客户(经销商/定制商)', score: 'A', note: '疑似海外买家，优先开发' };
  return { type: '待确认', score: 'B', note: '需人工/LLM 复核' };
}

// ---------- 博查网页搜索 ----------
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

function bochaItemToResult(it, target) {
  const c = extractContacts((it.name || '') + ' ' + (it.snippet || ''));
  const cls = classify({ ...it, ...c, target });
  return {
    name: it.name || '',
    url: it.url || '',
    site: it.siteName || '',
    domain: domainOf(it.url || ''),
    snippet: (it.snippet || '').slice(0, 300),
    email: c.emails[0] || '',
    emails: c.emails,
    phone: c.phones[0] || '',
    social: c.social,
    type: cls.type,
    score: cls.score,
    note: cls.note,
    source: 'bocha'
  };
}

// ---------- Google 地图本地商家搜索（SerpAPI google_maps 引擎）----------
async function googleMapsSearch(q, key, n, gl) {
  try {
    const u = new URL('https://serpapi.com/search.json');
    u.searchParams.set('engine', 'google_maps');
    u.searchParams.set('q', q);
    u.searchParams.set('type', 'search');
    if (gl) u.searchParams.set('gl', gl);
    u.searchParams.set('api_key', key);
    const resp = await fetch(u.toString());
    const j = await resp.json();
    if (j.error) return [];
    return (j.local_results || []).slice(0, n);
  } catch {
    return [];
  }
}

function mapsItemToResult(it, target) {
  const name = it.name || it.title || '';
  const website = it.website || '';
  const url = website || ('https://www.google.com/maps/place/?q=place_id:' + encodeURIComponent(it.place_id || name || ''));
  const dom = website ? domainOf(website) : 'google.com';
  const snippet = [
    it.address,
    it.types && it.types.length ? it.types.join(', ') : '',
    (it.rating ? it.rating + '★' : '') + (it.reviews ? ' (' + it.reviews + ' 评)' : '')
  ].filter(Boolean).join(' · ');
  const c = extractContacts((name || '') + ' ' + snippet + ' ' + website);
  const cls = classify({ name: name, url, snippet, siteName: '', target });
  return {
    name: name,
    url,
    site: 'Google Maps',
    domain: dom,
    snippet: snippet.slice(0, 300),
    email: c.emails[0] || '',
    emails: c.emails,
    phone: it.phone || it.phone_number || c.phones[0] || '',
    social: c.social,
    type: cls.type,
    score: cls.score,
    note: cls.note,
    source: 'google_maps'
  };
}

// ---------- 去重 key ----------
function dedupKey(r) {
  if (r.source === 'google_maps' && r.domain === 'google.com') {
    return 'maps:' + (r.url.split('place_id:')[1] || r.name);
  }
  return r.domain;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const product = (url.searchParams.get('product') || 'custom lapel pins').trim();
  const country = (url.searchParams.get('country') || 'United States').trim();
  const exclude = (url.searchParams.get('exclude') || '').trim();
  const target = (url.searchParams.get('target') || 'English').trim();
  const n = Math.min(parseInt(url.searchParams.get('n') || '10', 10) || 10, 30);
  const source = (url.searchParams.get('source') || 'bocha').trim(); // bocha / google_maps / all

  const BUYER_TERMS = {
    English: { dist: 'distributor', promo: 'promotional products', wholesale: 'wholesale', buyBulk: 'buy bulk' },
    Spanish: { dist: 'distribuidor', promo: 'productos promocionales', wholesale: 'venta al por mayor', buyBulk: 'comprar al por mayor' },
    French: { dist: 'distributeur', promo: 'produits promotionnels', wholesale: 'vente en gros', buyBulk: 'acheter en gros' },
    German: { dist: 'Distributor', promo: 'Werbeartikel', wholesale: 'Großhandel', buyBulk: 'Großhandel kaufen' },
    Russian: { dist: 'дистрибьютор', promo: 'рекламная продукция', wholesale: 'оптовая продажа', buyBulk: 'покупать оптом' },
    Portuguese: { dist: 'distribuidor', promo: 'produtos promocionais', wholesale: 'atacado', buyBulk: 'comprar atacado' },
    Italian: { dist: 'distributore', promo: 'prodotti promozionali', wholesale: 'ingrosso', buyBulk: 'acquistare all ingrosso' },
    Japanese: { dist: '卸売業者', promo: '販促品', wholesale: '卸売', buyBulk: '大口買い' }
  };
  const t = BUYER_TERMS[target] || BUYER_TERMS.English;

  // 国家 -> Google 地理定位代码（提升 Google 地图召回精度）
  const GL_MAP = {
    'united states': 'us', 'usa': 'us', 'us': 'us', 'america': 'us',
    'germany': 'de', 'german': 'de', 'deutschland': 'de',
    'united kingdom': 'uk', 'uk': 'uk', 'england': 'uk', 'britain': 'uk',
    'france': 'fr', 'french': 'fr',
    'spain': 'es', 'spanish': 'es', 'españa': 'es', 'espana': 'es',
    'italy': 'it', 'italian': 'it', 'italia': 'it',
    'japan': 'jp', 'japanese': 'jp',
    'brazil': 'br', 'portuguese': 'br', 'brasil': 'br',
    'russia': 'ru', 'russian': 'ru',
    'australia': 'au', 'canada': 'ca', 'mexico': 'mx',
    'netherlands': 'nl', 'holland': 'nl'
  };
  const gl = GL_MAP[country.toLowerCase()] || '';

  // 校验所需 key
  const wantBocha = source === 'bocha' || source === 'all';
  const wantMaps = source === 'google_maps' || source === 'all';
  if (wantBocha && !env.BOCHA_KEY) {
    return new Response(
      JSON.stringify({ error: '缺少 BOCHA_KEY 环境变量（请在 Cloudflare Pages 控制台设置，并重新部署）' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  if (wantMaps && !env.SERPAPI_KEY) {
    return new Response(
      JSON.stringify({ error: '缺少 SERPAPI_KEY 环境变量（Google 地图来源需要，请在 Cloudflare Pages 控制台设置后重新部署）' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // 多买家词召回（博查用），Google 地图用更口语的本地检索词
  const bochaQueries = [
    `${product} ${t.dist} ${country} ${t.promo}`,
    `${product} ${t.wholesale} ${country} ${t.buyBulk}`
  ];
  const mapsQueries = [
    `${product} ${t.wholesale} ${country}`,
    `${product} ${t.promo} ${country}`
  ];

  // 当目标不是中国市场时，自动追加中国平台/供应链排除词，让博查尽量少召回中国站
  const isTargetingChina = target === 'Chinese' || country.toLowerCase() === 'china' || country.toLowerCase() === 'chinese';
  const autoExclude = isTargetingChina ? [] : ['china', 'chinese', '1688', 'alibaba', 'made-in-china', 'tmall', 'jd', 'taobao', 'pinduoduo', 'zhihu', 'baidu', 'sina', 'sohu'];
  const userExclude = (exclude || '').split(/[\s,，]+/).filter(Boolean);
  const allExcludes = [...new Set([...autoExclude, ...userExclude])];
  if (allExcludes.length) {
    const ex = allExcludes.join(' -');
    bochaQueries.forEach((q, i) => bochaQueries[i] = q + ' -' + ex);
  }

  try {
    const tasks = [];
    if (wantBocha) tasks.push(...bochaQueries.map(q => bochaSearch(q, env.BOCHA_KEY, n)));
    if (wantMaps) tasks.push(...mapsQueries.map(q => googleMapsSearch(q, env.SERPAPI_KEY, n, gl)));
    const fetchedLists = await Promise.all(tasks);

    const merged = [];
    const seen = new Set();
    fetchedLists.forEach((list, idx) => {
      const isMaps = wantMaps && idx >= (wantBocha ? bochaQueries.length : 0);
      (list || []).forEach(it => {
        const r = isMaps ? mapsItemToResult(it, target) : bochaItemToResult(it, target);
        const key = dedupKey(r);
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(r);
      });
    });

    const order = { A: 0, B: 1, C: 2, D: 3 };
    merged.sort((a, b) => (order[a.score] || 9) - (order[b.score] || 9));
    return new Response(
      JSON.stringify({ version: 'buyerkw-multi', query: (wantBocha ? bochaQueries : []).concat(wantMaps ? mapsQueries : []).join(' | '), count: merged.length, results: merged }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
