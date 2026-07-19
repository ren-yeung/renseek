// 测试发信：发一封测试邮件到指定邮箱，验证 Gmail SMTP 凭证与链路是否通。
// 用法：
//   node test-send.mjs
//   PowerShell 改收件人：$env:TEST_TO='other@example.com'; node test-send.mjs
//
// 说明：仅发 1 封，不读 CSV、不写发送记录。本版加了连接池和重试，适配 VPN 不稳定场景。

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const USER = process.env.GMAIL_USER;
const PASS = process.env.GMAIL_PASS;
const TO = process.env.TEST_TO || 'y465023714@163.com';
const FROM_NAME = process.env.FROM_NAME || '';

if (!USER || !PASS) {
  console.error('❌ 请先在 .env 配置 GMAIL_USER / GMAIL_PASS');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  pool: true,                // 复用连接，避免每次 send 都新建 TCP 握手
  maxConnections: 1,
  maxMessages: 1,
  connectionTimeout: 60000,  // 60 秒连接超时，给 VPN 握手留时间
  greetingTimeout: 60000,
  socketTimeout: 60000,
  auth: { user: USER, pass: PASS }
});

const subject = 'renseek 发信测试 ' + new Date().toISOString().slice(0, 19);
const body =
  '这是一封来自 renseek 群发脚本的连通性测试邮件。\n' +
  '如果你收到它，说明 Gmail SMTP 凭证与链路均正常。\n' +
  '发件账户：' + USER;

let lastErr = null;
for (let i = 1; i <= 3; i++) {
  try {
    console.log(`第 ${i}/3 次尝试发送...`);
    const info = await transporter.sendMail({
      from: FROM_NAME ? `${FROM_NAME} <${USER}>` : USER,
      to: TO,
      subject,
      text: body
    });
    console.log('✅ 已发送 →', TO);
    console.log('   messageId:', info.messageId);
    console.log('   去你的 163 收件箱（含垃圾邮件箱）查收，确认能收到即可开始正式群发。');
    process.exit(0);
  } catch (e) {
    lastErr = e;
    console.error(`❌ 第 ${i} 次失败：`, e.message);
    if (i < 3) {
      console.log('   5 秒后重试...');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

console.error('\n3 次尝试均失败，最后错误：', lastErr.message);
console.error('可能原因：当前 VPN 节点到 Gmail 不稳定 / 尚未真正接管 465 端口。');
console.error('建议：①换 VPN 节点；②开启 VPN 的 TUN/虚拟网卡模式；③用海外服务器跑脚本。');
process.exit(1);
