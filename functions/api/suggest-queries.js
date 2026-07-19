// Cloudflare Pages Function: /api/suggest-queries  (POST)
// 产品词扩词助手：调用 DeepSeek 生成 12 个外贸搜索词变体
// 密钥从环境变量读取：DEEPSEEK_KEY（必填）、DEEPSEEK_BASE（可选）、DEEPSEEK_MODEL（可选）

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

  const { product = '', country = '', target = 'English', exclude = '' } = body;
  if (!product.trim()) {
    return new Response(
      JSON.stringify({ error: '产品词不能为空' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }

  const base = (env.DEEPSEEK_BASE || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';

  const system = `你是一名外贸搜索词扩写助手。请根据用户输入的产品品类、目标国家和排除词，生成 12 条可用于 Google / 博查搜索的外贸客户开发搜索词。

要求：
- 每条搜索词使用目标语言（${target}）
- 覆盖不同的买家意图角度：distributor/wholesale/promotional products/reseller/dealer/buy in bulk/retail chain/event/gift/souvenir 等
- 部分搜索词包含国家名以限定区域
- 部分搜索词使用同义词/近义词替换产品词，避免重复
- 搜索词之间要有明显差异，不要只是微调措辞
- 如果提供了排除词，在搜索词末尾加上 -排除词
- 只输出 JSON，不要解释、不要 markdown
- 输出格式：{"queries": ["搜索词1", "搜索词2", ...]}`;

  const excludePart = exclude ? `\n排除词：${exclude}` : '';
  const user = `产品品类：${product}
目标国家：${country}${excludePart}

请生成 12 条 ${target} 搜索词。`;

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
        temperature: 0.8,
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

    const queries = (parsed.queries || []).slice(0, 12);

    return new Response(
      JSON.stringify({ queries, product, country, target, exclude }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '调用 DeepSeek 失败：' + String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}