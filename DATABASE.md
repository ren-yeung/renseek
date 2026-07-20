# 客户管理数据库（Cloudflare D1）配置

客户管理页（「客户管理」Tab）使用 Cloudflare D1 作为真正的后端数据库，替代原先的浏览器 localStorage。
`functions/api/leads.js` 通过绑定名 `DB` 访问 D1 实例，需完成以下一次性配置。

## 1. 创建 D1 数据库
- 登录 Cloudflare Dashboard → 左侧 **D1** → **Create database**
- 名称填 `renseek`（可自定，后面绑定要对上）
- 创建后会得到数据库，记下它（Dashboard 里能看到）

## 2. 绑定到 Pages 项目
- Cloudflare Dashboard → **Workers & Pages** → 你的项目 `renseek` → **Settings** → **Functions** → **D1 database bindings**
- 点 **Add binding**
  - Variable name（变量名）：必须填 **`DB`**（代码里写死读 `env.DB`）
  - D1 database：选刚创建的 `renseek`
- Save

## 3. 建表
两种方式任选其一：

**方式 A（Dashboard 粘贴执行，推荐）**
- D1 → `renseek` → **Console / Query**
- 打开本项目根目录 `init-db.sql`，把里面的 SQL 语句整段复制粘贴到控制台里，点 **Run**
  - ⚠️ 注意：不要只输入 `init-db.sql` 这个文件名，控制台需要的是 SQL 文本内容
- 看到 `leads` 表创建成功即可

**方式 B（命令行）**
```bash
npx wrangler d1 execute renseek --file=init-db.sql --remote
```

## 4. 重新部署
绑定 D1 属于 Functions 配置变更，需重新部署一次才能生效：
- Workers & Pages → `renseek` → **Deployments** → 重新部署（或 push 一次代码触发）

## 验证
部署完成后，打开网站 → 切到「客户管理」Tab：
- 若显示「客户管理库为空」= 数据库已连通，去「客户开发」搜索并点「导入客户」即可
- 若显示红色错误「服务端未配置 D1 数据库」= 绑定名不是 `DB` 或未重新部署，回到第 2、4 步检查

## 数据字段说明（leads 表）
| 字段 | 含义 |
|---|---|
| name / url / domain | 公司名 / 网站 / 域名 |
| type / score | 客户类型 / 评分（A/B/C/D） |
| email / emails / phone / social | 联系方式（emails 为 JSON 数组） |
| mx | 1=可收信，0=无 MX，NULL=未检测 |
| status | 跟进状态：待联系 / 已联系 / 已回复 / 已成交 |
| note | 跟进备注 |
| draft_subject / draft_body | 已写好的开发信主题与正文 |
| created_at / updated_at | 时间戳 |

## 开发信模板库（templates 表）

「开发信模板」页（侧栏「📝 开发信模板」）用来保存多套发件人资料，生成开发信时可在弹窗内选择套用。表名 `templates`，建表语句见 `init-db.sql`（线上已有库用 `migrate-templates.sql` 追加）。

| 字段 | 含义 |
|---|---|
| name | 模板名称（必填） |
| brand / sender | 品牌名 / 发件人姓名 |
| product | 产品 |
| selling | 卖点 / 公司信息（MOQ / 交期 / 定制能力 / 价格等） |
| company | 公司信息（公司名 / 官网） |
| whatsapp | WhatsApp 号码 |
| reply_to / from_addr | 回复邮箱（Reply-To） / 发件邮箱显示名（From） |
| body_tpl | 可选正文模板，支持占位符 `{{company}}` `{{website}}` `{{product}}` `{{whatsapp}}` `{{sender}}` `{{brand}}` `{{company_info}}`，套用模板时免 AI 直接生成 |
| is_default | 1=默认模板（弹窗自动选中） |
| created_at / updated_at | 时间戳 |

接口：`/api/templates`（GET 列表 / POST 新建 / PUT 更新或设默认 / DELETE 删除），结构同 `/api/leads`。
