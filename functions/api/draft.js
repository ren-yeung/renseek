// Cloudflare Pages Function: /api/draft  (POST)
// 用 DeepSeek 生成英文开发信（主题 + 正文），变量占位 {{company}} 渲染为客户真实名
// 密钥从环境变量读取：DEEPSEEK_KEY（必填）、DEEPSEEK_BASE（可选，默认官方）、DEEPSEEK_MODEL（可选，默认 deepseek-chat）

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

  const {
    company = '', website = '', product = '', sellingPoints = '',
    brand = '', senderName = '', senderEmail = '', type = '', snippet = ''
  } = body;

  const base = (env.DEEPSEEK_BASE || 'https://api.deepseek.com/v1').replace(/\/$/, '');
  const model = env.DEEPSEEK_MODEL || 'deepseek-chat';

  const system = `你是一名资深外贸开发信专家，帮助中国供应商（主营定制徽章/胸针/奖牌等促销礼品）给海外潜在买家写英文开发信。要求：
- 简洁专业，2-4 段，不超过 160 词
- 语气自然、不 spammy，突出定制能力、MOQ 灵活、交期稳定、性价比
- 包含一个明确的行动号召（CTA），邀请客户回复或查看 catalog
- 不要捏造认证/数据，只用提供的卖点
- 输出严格 JSON：{"subject": "...", "body": "..."}，body 用 \\n 换行，不要使用 markdown 符号`;

  const user = `请为以下客户写一封开发信：
客户公司：${company || '（未知）'}
客户网站：${website || '（未知）'}
客户类型：${type || '（未知）'}
客户业务背景：${snippet || '（未知）'}
我们的产品：${product || 'custom badges / lapel pins'}
我们的卖点：${sellingPoints || '（未提供，请写通用优势）'}
我们品牌：${brand || '（未提供）'}
发件人：${senderName || '（未提供）'}（${senderEmail || ''}）

要求：用占位符 {{company}} 指代客户公司名（正文中最多出现一次，用于称呼），其余用自然语言。`;

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
        temperature: 0.7,
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
    catch { parsed = { subject: '', body: content }; }

    // 渲染 {{company}} 占位符为真实公司名
    const fill = (s) => (s || '').replace(/\{\{\s*company\s*\}\}/gi, company || '');
    const subject = (fill(parsed.subject) || '').trim();
    const text = (fill(parsed.body) || '').trim();
    return new Response(
      JSON.stringify({ subject, body: text }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: '调用 DeepSeek 失败：' + String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}
