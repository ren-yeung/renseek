// Cloudflare Pages Function: /api/translate  (POST)
// 用 DeepSeek 把「产品、目标国家、排除词」中检测到中文的字段翻译成英文搜索词
// 密钥从环境变量读取：DEEPSEEK_KEY（必填）、DEEPSEEK_BASE（可选）、DEEPSEEK_MODEL（可选）

const CHINESE_RE = /[\u4e00-\u9fa5]/;

function hasChinese(text) {
  return CHINESE_RE.test(text || '');
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const key = env.DEEPSEEK_KEY;
  if (!key) {
    return new Response(
      JSON.stringify({ error: '服务端未配置 DEEPSEEK_KEY（请在 Cloudflare 环境变量设置）' }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求体不是合法 JSON' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  const { product = '', country = '', exclude = '', target = 'English' } = body;
  const targetLang = (target || 'English').trim();

  // 把前端传过来的语言名映射成中文语言名，便于在 Prompt 里明确指示目标语言
  const LANG_NAMES = {
    English: '英语',
    Spanish: '西班牙语',
    French: '法语',
    German: '德语',
    Russian: '俄语',
    Portuguese: '葡萄牙语',
    Italian: '意大利语',
    Japanese: '日语'
  };
  const langName = LANG_NAMES[targetLang] || targetLang;

  // 只有目标语言为英语且未检测到中文时，才直接返回原值，避免无意义的 API 调用
  if (targetLang === 'English' && !hasChinese(product) && !hasChinese(country) && !hasChinese(exclude)) {
    return new Response(
      JSON.stringify({ product, country, exclude, target: targetLang, langName, translated: false }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const base = (env.DEEPSEEK_BASE || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';

  const system = `你是一名外贸关键词翻译助手。目标语言是${langName}。请把用户输入的「产品、目标国家、排除词」中所有非${langName}内容（包括中文、英文等）翻译成${langName}搜索词；如果原文已经是${langName}，则直接保留原样，不要改动。
要求：
- 只输出 JSON，不要解释、不要 markdown
- 产品：翻译成${langName}具体品类搜索词
- 国家：翻译成${langName}国家名或地区名
- 排除词：逐个词/短语翻译成${langName}，保持空格分隔
- 重要：输出必须是${langName}，不能输出英文；如果原文已经是${langName}则直接保留
- 输出格式：{"product": "...", "country": "...", "exclude": "..."}`;

  const user = `请将以下字段翻译成${langName}（已经是${langName}的保留原样）：
产品：${product || '（未提供）'}
目标国家：${country || '（未提供）'}
排除词：${exclude || '（未提供）'}`;

  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    const j = await resp.json();
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: 'DeepSeek 错误: ' + (j.error?.message || resp.status) }),
        { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
      );
    }
    const content = j.choices?.[0]?.message?.content || '';
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { parsed = {}; }

    return new Response(
      JSON.stringify({
        product: (parsed.product || product).trim(),
        country: (parsed.country || country).trim(),
        exclude: (parsed.exclude || exclude).trim(),
        target: targetLang,
        translated: true
      }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '调用 DeepSeek 失败：' + String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
