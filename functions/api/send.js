// Cloudflare Pages Function: /api/send  (POST)
// 通过 Resend HTTPS API 发送邮件，绕开本机 Gmail 465 被墙问题
// 环境变量：RESEND_KEY（在 Cloudflare Pages 环境变量中设置）
// 发件域：kuajing.space

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const key = env.RESEND_KEY;
  if (!key) {
    return jsonError('服务端未配置 RESEND_KEY（请在 Cloudflare Pages 环境变量设置）', 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  const { to, subject, html, text, from, replyTo } = body;
  if (!to || !subject || (!html && !text)) {
    return jsonError('缺少 to / subject / html|text', 400);
  }

  // 默认发件人：必须用已在 Resend 验证的根域 kuajing.space；允许前端自定义
  const defaultFrom = 'Renseek <hello@kuajing.space>';
  const finalFrom = from || defaultFrom;
  // 默认回复地址：客户点回复会进这个真实收件箱（kuajing.space 本身无收信能力）
  const defaultReplyTo = 'ycr13120902436@gmail.com';
  const finalReplyTo = replyTo || defaultReplyTo;
  const finalTo = Array.isArray(to) ? to : [to];

  // 把裸 HTML 包装成完整 UTF-8 文档，避免 163/Outlook 等客户端用 GBK 解码中文乱码
  const finalHtml = html ? wrapHtml(html) : undefined;

  const payload = {
    from: finalFrom,
    to: finalTo,
    subject,
    reply_to: finalReplyTo,
    ...(finalHtml ? { html: finalHtml } : {}),
    ...(text ? { text } : {})
  };

  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return jsonError('Resend 错误: ' + (j.message || JSON.stringify(j)), 502);
    }
    return json({ success: true, id: j.id, from: finalFrom, to: finalTo });
  } catch (e) {
    return jsonError('调用 Resend 失败：' + String(e), 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function jsonError(msg, status) {
  return json({ error: msg }, status);
}

function wrapHtml(html) {
  if (!html) return html;
  if (/<html[\s>]/i.test(html)) return html;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1f2329;">
  ${html}
</body>
</html>`;
}
