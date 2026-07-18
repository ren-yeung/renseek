// 本地群发脚本：读取 renseek 网页导出的 CSV（含「开发信主题」「开发信正文」列），通过 Gmail SMTP 群发
//
// 前置（在你自己电脑/任意能联网的 Node 环境运行，不在 Cloudflare 上）：
//   1) 安装依赖：  npm i nodemailer csv-parse dotenv
//   2) 复制本文件同目录的 .env.example 为 .env，填入 GMAIL_USER / GMAIL_PASS（Gmail 16 位应用专用密码）
//   3) 在 renseek 网页点「导出我的客户 CSV」（已含开发信列），保存为 leads.csv 与本脚本同目录
//   4) 运行：  node send-outreach.mjs
//
// 说明：
//   - Gmail 免费 SMTP（端口 465 SSL），发送量受 Gmail  daily 限额约束，建议 DELAY_MS 设 3000+ 避免被限流
//   - 脚本只发「邮箱」+「开发信主题」+「开发信正文」都非空、且未发过（基于已发送记录）的行
//   - 正文在 CSV 中以字面 \n 存储，发送前自动还原为真实换行

import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const USER = process.env.GMAIL_USER;
const PASS = process.env.GMAIL_PASS;
const CSV = process.env.CSV_FILE || 'leads.csv';
const DELAY = parseInt(process.env.DELAY_MS || '3000', 10);
const FROM_NAME = process.env.FROM_NAME || '';
const SENT_LOG = '.sent.log';

if (!USER || !PASS) {
  console.error('❌ 请先在 .env 配置 GMAIL_USER / GMAIL_PASS（16 位 Gmail 应用专用密码）');
  process.exit(1);
}
if (!existsSync(CSV)) {
  console.error(`❌ 找不到 ${CSV}，请先导出 CSV 放到本目录`);
  process.exit(1);
}

const sentSet = new Set(
  existsSync(SENT_LOG) ? readFileSync(SENT_LOG, 'utf-8').split('\n').map(s => s.trim()).filter(Boolean) : []
);

let raw = readFileSync(CSV, 'utf-8').replace(/^\uFEFF/, ''); // 去 BOM
const records = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true });

const rows = records.filter(r => {
  const to = (r['邮箱'] || r['email'] || '').trim();
  const subj = (r['开发信主题'] || '').trim();
  return to && subj && !sentSet.has(to + '|' + subj);
});
console.log(`CSV 共 ${records.length} 行，可发送 ${rows.length} 行（已去重 ${sentSet.size} 条历史发送）`);

if (!rows.length) { console.log('没有需要发送的客户。'); process.exit(0); }

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: USER, pass: PASS }
});

let sent = 0, fail = 0;
for (const r of rows) {
  const to = (r['邮箱'] || r['email']).trim();
  const subject = (r['开发信主题'] || '').trim();
  const body = (r['开发信正文'] || '').replace(/\\n/g, '\n').trim();
  try {
    await transporter.sendMail({
      from: FROM_NAME ? `${FROM_NAME} <${USER}>` : USER,
      to, subject, text: body
    });
    sent++;
    appendFileSync(SENT_LOG, to + '|' + subject + '\n');
    console.log(`✅ [${sent}] → ${to}`);
  } catch (e) {
    fail++;
    console.log(`❌ ${to}: ${e.message}`);
  }
  await new Promise(res => setTimeout(res, DELAY));
}
console.log(`\n完成：成功 ${sent}，失败 ${fail}。已发送记录写入 ${SENT_LOG}（下次运行自动跳过）。`);
