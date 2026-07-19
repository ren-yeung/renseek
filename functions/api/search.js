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
  'suning.com', 'dangdang.com', 'gome.com.cn', 'vip.com', 'joom.com',
  'hktdc.com', 'hktdc.org', 'ecplaza.net', 'chemnet.com',
  'ccwto.com', 'cnweike.com', 'itinr.com', 'yellowscholars.com',
  'manufacturer.com', 'topchinasupplier.com', 'chinasuppliers.com',
  'chinasourcing.com', 'sourcingmap.com', 'chinese168.com',
  'ecvv.com', 'eastday.com', 'china.org.cn', 'shangmuguan.com'
]);

function isChinaSite(item) {
  let dom = domainOf(item.url || '');
  // 统一去掉常见子域名前缀，只保留主域名+二级域名
  dom = dom.replace(/^(?:www|m|mobile|wap|en|cn|ru|de|fr|es|pt|it|jp|kr|ar|th|vn|id|my|tr|nl|pl|sv|da|no|fi|cs|hu|ro|uk|bg|el|he|hi|ms|tl|zh|zh-cn|zh-hk|zh-tw)\./i, '');
  if (CN_DOMAINS.has(dom)) return true;
  if (dom.endsWith('.cn')) return true;
  // 子域名检测：xxx.made-in-china.com → 匹配 made-in-china.com
  for (const base of CN_DOMAINS) {
    if (dom.endsWith('.' + base)) return true;
  }
  const text = ((item.name || '') + ' ' + (item.snippet || '') + ' ' + (item.siteName || '')).toLowerCase();
  const cnKw = [
    '1688', 'alibaba', 'made-in-china', 'made in china', 'china supplier', 'chinese manufacturer',
    'shenzhen', 'guangdong', 'yiwu', 'china factory', 'manufacturer in china', 'supplier from china',
    '中国', '中國', '阿里巴巴', '淘宝', '天貓', '天猫', '京东', '拼多多', '中国制造', '中国工厂',
    '厂家', '供应商', '中国制造网', '制造网', '厂家直销', '工厂直销', '批发', '批发价',
    '全球速卖通', '环球资源', '中国供应商', '外贸邦', '外贸圈'
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

// ---------- Google Custom Search（Goggle CSE，网页搜索）----------
async function googleCseSearch(q, key, cx, n) {
  try {
    const u = new URL('https://www.googleapis.com/customsearch/v1');
    u.searchParams.set('key', key);
    u.searchParams.set('cx', cx);
    u.searchParams.set('q', q);
    u.searchParams.set('num', Math.min(n, 10)); // Google CSE 单次最多 10 条
    const resp = await fetch(u.toString());
    const j = await resp.json();
    if (j.error) {
      console.error('Google CSE API error:', JSON.stringify(j.error));
      return { error: j.error };
    }
    if (!j.items) return [];
    return j.items;
  } catch (e) {
    console.error('Google CSE fetch error:', String(e));
    return [];
  }
}

function googleCseItemToResult(it, target) {
  const c = extractContacts((it.title || '') + ' ' + (it.snippet || ''));
  const cls = classify({ name: it.title || '', url: it.link || '', snippet: it.snippet || '', siteName: it.displayLink || '', target });
  return {
    name: it.title || '',
    url: it.link || '',
    site: it.displayLink || '',
    domain: domainOf(it.link || ''),
    snippet: (it.snippet || '').slice(0, 300),
    email: c.emails[0] || '',
    emails: c.emails,
    phone: c.phones[0] || '',
    social: c.social,
    type: cls.type,
    score: cls.score,
    note: cls.note,
    source: 'google_cse'
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

// ---------- OpenStreetMap / Overpass（免费，原生带 email/website/phone）----------
// 价值：地图类结果直接给出邮箱（Google 地图结果常缺邮箱），免 key，补充 renseek「地图源无邮箱」的空白。
// 仅按国家 bbox 跑，且仅取「带 email 的礼品/纪念品/文具/促销类实体店」——正是徽章/定制礼品的买家。
const COUNTRY_BBOX = {
  'united states': [24.3963, 49.3844, -125.0, -66.9346],
  'usa': [24.3963, 49.3844, -125.0, -66.9346],
  'us': [24.3963, 49.3844, -125.0, -66.9346],
  'america': [24.3963, 49.3844, -125.0, -66.9346],
  'germany': [47.27, 55.05, 5.87, 15.04],
  'german': [47.27, 55.05, 5.87, 15.04],
  'deutschland': [47.27, 55.05, 5.87, 15.04],
  'united kingdom': [49.96, 58.64, -8.16, 1.75],
  'uk': [49.96, 58.64, -8.16, 1.75],
  'england': [49.96, 58.64, -8.16, 1.75],
  'britain': [49.96, 58.64, -8.16, 1.75],
  'france': [41.33, 51.07, -9.54, 9.56],
  'french': [41.33, 51.07, -9.54, 9.56],
  'spain': [35.95, 43.79, -18.45, 4.32],
  'spanish': [35.95, 43.79, -18.45, 4.32],
  'españa': [35.95, 43.79, -18.45, 4.32],
  'espana': [35.95, 43.79, -18.45, 4.32],
  'italy': [35.49, 47.09, 6.63, 18.48],
  'italian': [35.49, 47.09, 6.63, 18.48],
  'italia': [35.49, 47.09, 6.63, 18.48],
  'japan': [24.25, 45.55, 122.94, 153.99],
  'japanese': [24.25, 45.55, 122.94, 153.99],
  'brazil': [-33.75, 5.27, -73.99, -33.74],
  'portuguese': [-33.75, 5.27, -73.99, -33.74],
  'brasil': [-33.75, 5.27, -73.99, -33.74],
  'russia': [41.19, 81.86, 19.64, 179.99],
  'russian': [41.19, 81.86, 19.64, 179.99],
  'australia': [-43.63, -10.67, 113.34, 153.61],
  'canada': [41.67, 83.12, -141.0, -52.62],
  'mexico': [14.54, 32.72, -118.36, -86.71],
  'netherlands': [50.75, 53.51, 3.31, 7.22],
  'holland': [50.75, 53.51, 3.31, 7.22]
};

// 多个公共镜像轮询，抗单点故障/限流
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter'
];

async function overpassSearch(product, bbox, n) {
  const [s, nLat, w, e] = bbox;
  const shopRe = 'gift|souvenir|stationery|pawnbroker|bookmaker|copyshop|photo|variety_store|trade';
  const q = `[out:json][timeout:25];
(
  node["shop"~"${shopRe}"]["email"]( ${s},${w},${nLat},${e});
  way["shop"~"${shopRe}"]["email"]( ${s},${w},${nLat},${e});
);
out body ${Math.min(n, 40)};`;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q)
      });
      if (!resp.ok) continue;
      const j = await resp.json();
      const els = (j && j.elements) || [];
      if (els.length) return els;
    } catch { continue; }
  }
  return [];
}

function overpassItemToResult(el, target) {
  const tags = el.tags || {};
  const name = tags.name || '';
  const website = tags.website || tags['contact:website'] || '';
  const email = (tags.email || tags['contact:email'] || '').toLowerCase();
  const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';
  if (!name && !website) return null;
  const url = website || ('https://www.openstreetmap.org/' + (el.type === 'node' ? 'node/' : 'way/') + el.id);
  const dom = website ? domainOf(website) : ('osm-' + el.type + '-' + el.id);
  const snippet = [tags.shop, tags['addr:city'], tags['addr:country']].filter(Boolean).join(' · ');
  const cls = classify({ name: name, url, snippet, siteName: 'OpenStreetMap', target, emails: email ? [email] : [] });
  if (cls.score === 'D') return null; // 中国站/工厂剔除
  return {
    name, url, site: 'OpenStreetMap', domain: dom, snippet: snippet.slice(0, 300),
    email: email || '', emails: email ? [email] : [],
    phone: phone || '', social: '',
    type: '潜在客户(经销商/定制商)', score: 'A', note: 'OSM 礼品/纪念品类实体店，自带邮箱',
    source: 'overpass'
  };
}

// ---------- SearXNG 元搜索（自建，通过 Clash 代理访问 Google 等）----------
// 价值：一个接口聚合 Google / Bing / DuckDuckGo 等引擎，无需各自申请 API Key，
// 替代已弃用的 Google CSE「搜索整个网络」功能。
const SEARXNG_URL_DEFAULT = 'https://searxng.kuajing.space';
const SEARXNG_LANG_MAP = {
  English: 'en', Spanish: 'es', French: 'fr', German: 'de',
  Russian: 'ru', Portuguese: 'pt', Italian: 'it', Japanese: 'ja'
};

async function searxngSearch(q, baseUrl, n, target) {
  try {
    const u = new URL(baseUrl.replace(/\/+$/, '') + '/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'json');
    u.searchParams.set('categories', 'general');
    u.searchParams.set('language', SEARXNG_LANG_MAP[target] || 'en');
    u.searchParams.set('pageno', '1');
    const resp = await fetch(u.toString(), {
      headers: { 'Accept': 'application/json' }
    });
    if (!resp.ok) {
      console.error('SearXNG HTTP ' + resp.status);
      return [];
    }
    const j = await resp.json();
    return (j.results || []).slice(0, n);
  } catch (e) {
    console.error('SearXNG fetch error: ' + String(e));
    return [];
  }
}

function searxngItemToResult(it, target) {
  const c = extractContacts((it.title || '') + ' ' + (it.content || ''));
  const cls = classify({
    name: it.title || '',
    url: it.url || '',
    snippet: it.content || '',
    siteName: domainOf(it.url || ''),
    target
  });
  return {
    name: it.title || '',
    url: it.url || '',
    site: domainOf(it.url || ''),
    domain: domainOf(it.url || ''),
    snippet: (it.content || '').slice(0, 300),
    email: c.emails[0] || '',
    emails: c.emails,
    phone: c.phones[0] || '',
    social: c.social,
    type: cls.type,
    score: cls.score,
    note: cls.note,
    source: 'searxng'
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
  const source = (url.searchParams.get('source') || 'bocha').trim(); // bocha / google_maps / google_cse / searxng / all

  // 可选参数：自定义搜索词列表（来自扩词助手），替换默认的 bochaQueries/mapsQueries
  let queries = [];
  try {
    const qs = url.searchParams.get('queries');
    if (qs) queries = JSON.parse(qs);
  } catch { /* 忽略解析错误，沿用默认搜索词 */ }

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
  const bbox = COUNTRY_BBOX[country.toLowerCase()];
  const wantOverpass = (source === 'google_maps' || source === 'all') && !!bbox;

  // 校验所需 key
  const wantBocha = source === 'bocha' || source === 'all';
  const wantMaps = source === 'google_maps' || source === 'all';
  const wantCse = source === 'google_cse' || source === 'all';
  const wantSearxng = source === 'searxng' || source === 'all';
  const searxngUrl = (env.SEARXNG_URL || SEARXNG_URL_DEFAULT).replace(/\/+$/, '');
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
  if (wantCse && (!env.GOOGLE_CSE_KEY || !env.GOOGLE_CSE_CX)) {
    return new Response(
      JSON.stringify({ error: '缺少 GOOGLE_CSE_KEY 或 GOOGLE_CSE_CX 环境变量（请在 Cloudflare Pages 控制台设置后重新部署）' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  // 多买家词召回（博查用），Google 地图用更口语的本地检索词
  // 当提供了自定义 queries 参数（来自扩词助手），直接使用用户选择的搜索词
  let bochaQueries, mapsQueries;
  if (queries && queries.length > 0) {
    bochaQueries = [...queries];
    mapsQueries = [...queries];
  } else {
    bochaQueries = [
      `${product} ${t.dist} ${country} ${t.promo}`,
      `${product} ${t.wholesale} ${country} ${t.buyBulk}`
    ];
    mapsQueries = [
      `${product} ${t.wholesale} ${country}`,
      `${product} ${t.promo} ${country}`
    ];
  }

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
    if (wantOverpass) tasks.push(overpassSearch(product, bbox, n));
    if (wantCse) tasks.push(...bochaQueries.map(q => googleCseSearch(q, env.GOOGLE_CSE_KEY, env.GOOGLE_CSE_CX, n)));
    if (wantSearxng) tasks.push(...bochaQueries.map(q => searxngSearch(q, searxngUrl, n, target)));
    const fetchedLists = await Promise.all(tasks);

    const bochaLen = wantBocha ? bochaQueries.length : 0;
    const mapsLen = wantMaps ? mapsQueries.length : 0;
    const overLen = wantOverpass ? 1 : 0;
    const cseLen = wantCse ? bochaQueries.length : 0;
    const searxngLen = wantSearxng ? bochaQueries.length : 0;
    const merged = [];
    const seen = new Set();
    let cseError = null;
    fetchedLists.forEach((list, idx) => {
      const isMaps = wantMaps && idx >= bochaLen && idx < bochaLen + mapsLen;
      const isOver = wantOverpass && idx >= bochaLen + mapsLen && idx < bochaLen + mapsLen + overLen;
      const isCse = wantCse && idx >= bochaLen + mapsLen + overLen && idx < bochaLen + mapsLen + overLen + cseLen;
      const isSearxng = wantSearxng && idx >= bochaLen + mapsLen + overLen + cseLen;
      if (!Array.isArray(list)) {
        if (isCse && list && list.error) {
          cseError = list.error;
        }
        return;
      }
      list.forEach(it => {
        let r;
        if (isMaps) r = mapsItemToResult(it, target);
        else if (isOver) r = overpassItemToResult(it, target);
        else if (isCse) r = googleCseItemToResult(it, target);
        else if (isSearxng) r = searxngItemToResult(it, target);
        else r = bochaItemToResult(it, target);
        if (!r) return;
        const key = dedupKey(r);
        if (!key) return;
        if (seen.has(key)) {
          // 同域名重复：新结果有联系方式而旧没有则补全（避免 Google 地图有站无邮箱、OSM 有邮箱被丢弃）
          const prev = merged.find(x => dedupKey(x) === key);
          if (prev) {
            if (!prev.email && r.email) prev.email = r.email;
            if ((!prev.emails || !prev.emails.length) && r.emails && r.emails.length) prev.emails = r.emails;
            if (!prev.phone && r.phone) prev.phone = r.phone;
            if (!prev.social && r.social) prev.social = r.social;
          }
          return;
        }
        seen.add(key);
        merged.push(r);
      });
    });

    const order = { A: 0, B: 1, C: 2, D: 3 };
    merged.sort((a, b) => (order[a.score] || 9) - (order[b.score] || 9));
    const resp = { version: 'buyerkw-multi+osm+searxng', query: (wantBocha ? bochaQueries : []).concat(wantMaps ? mapsQueries : []).concat(wantOverpass ? ['[Overpass OSM ' + country + ']'] : []).concat(wantSearxng ? ['[SearXNG]'] : []).join(' | '), count: merged.length, results: merged };
    if (cseError) {
      resp.cseError = cseError;
      resp.cseErrorNote = 'Google CSE 返回了错误，请检查控制台设置。常见原因：CSE 未启用"搜索整个网络"或 API 密钥未开通 Custom Search API。';
    }
    return new Response(
      JSON.stringify(resp),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
