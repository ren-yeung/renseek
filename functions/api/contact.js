// Cloudflare Pages Function: /api/contact?url=...
// 按需抓取目标官网，提取页面里藏着的邮箱/电话/社媒（深度富集）
// 失败也返回 200 + 空数组，避免前端卡死

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: '缺少 url 参数' }),
      { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(target, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; renseek-bot/1.0)' }
    });
    clearTimeout(timer);
    const html = await resp.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');

    const emails = [...new Set(
      (text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])
        .map(e => e.toLowerCase())
        .filter(e => !/(@example|@yourdomain|@domain|@email|@test)/i.test(e))
    )].slice(0, 10);

    const phones = [...new Set(
      (text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g) || [])
        .map(p => p.trim())
        .filter(p => p.replace(/\D/g, '').length >= 7)
    )].slice(0, 5);

    const social = [];
    const li = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s"'<>]+/i);
    if (li) social.push(li[0]);

    return new Response(JSON.stringify({ url: target, emails, phones, social }),
      { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ url: target, emails: [], phones: [], social: [], error: String(e) }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
}
