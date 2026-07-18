// Cloudflare Pages Function: /api/receive-email  (POST)
// 接收 Resend inbound webhook (email.received)，把客户回复转发到真实邮箱
// 环境变量：RESEND_KEY（需要 Sending + Receiving 权限；Cloudflare Pages 环境变量设置）
// 可选环境变量：FORWARD_TO（覆盖默认转发地址）

const DEFAULT_FORWARD_TO = 'ycr13120902436@gmail.com';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const key = env.RESEND_KEY;
  if (!key) {
    return jsonError('服务端未配置 RESEND_KEY', 500);
  }

  let event;
  try {
    event = await request.json();
  } catch {
    return jsonError('请求体不是合法 JSON', 400);
  }

  if (event.type !== 'email.received') {
    return json({ ok: true, ignored: true, reason: 'event type ignored' });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return jsonError('缺少 email_id', 400);
  }

  // 只转发发给 hello@kuajing.space 的邮件（避免把其他地址的邮件也转发）
  const to = Array.isArray(event.data?.to) ? event.data.to : [];
  const isForHello = to.some(addr => String(addr).toLowerCase().startsWith('hello@kuajing.space'));
  if (!isForHello) {
    return json({ ok: true, forwarded: false, reason: 'recipient not hello@kuajing.space' });
  }

  // 通过 Resend Receiving API 获取完整邮件内容（webhook 只有元数据）
  const getResp = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { 'Authorization': 'Bearer ' + key }
  });
  if (!getResp.ok) {
    const err = await getResp.text().catch(() => getResp.status);
    return jsonError('获取收到邮件内容失败: ' + err, 502);
  }
  const email = await getResp.json();

  // 转发到真实邮箱
  const forwardTo = env.FORWARD_TO || DEFAULT_FORWARD_TO;
  const forwardPayload = {
    from: 'Renseek <hello@kuajing.space>',
    to: [forwardTo],
    subject: `Fwd: ${email.subject || '(no subject)'}`,
    ...(email.html ? { html: email.html } : {}),
    ...(email.text ? { text: email.text } : {})
  };

  const sendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(forwardPayload)
  });
  if (!sendResp.ok) {
    const err = await sendResp.text().catch(() => sendResp.status);
    return jsonError('转发邮件失败: ' + err, 502);
  }
  const sent = await sendResp.json().catch(() => ({}));

  return json({ ok: true, forwarded: true, forwardedId: sent.id, to: forwardTo, originalFrom: email.from });
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
