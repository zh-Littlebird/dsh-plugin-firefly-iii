# dsh-plugin-firefly-iii

一个可独立安装的 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）Host 插件：把 **Firefly III** 记账带进对话。Agent 可以遵循「先读元数据、再写入」的纪律，完成记账、查询、修正、预算巡检和账务分析，并通过内置 Skill 与 Web 设置页降低误操作。

Firefly III bookkeeping for DeepSeek Harness: typed tools, a bundled skill, and a Web settings page for recording, correcting, and analyzing transactions without hand-writing REST calls.

- 插件类型：Host bundle（`dsh.bundle.patch`）+ 一个可选的 Web 设置页，不改动 Harness 核心源码。
- 工具注册：通过 `ctx.tools.register` 注册 9 个领域工具，通过 `ctx.skills.register` 注册 `firefly-iii` 技能。
- 运行时依赖：仅 Node 内建 `fetch`；无 npm 运行时依赖。
- 兼容基线：**Firefly III 6.7.x**（实测 6.7.9 / API 6.7.9），DSH `0.2.2-rc.x`。

---

## 1. 功能

| 能力 | 说明 |
|---|---|
| 记账 | 单笔、多笔、拆分交易；先预览再 `confirm=true` 提交；时间必须到 `HH:MM:SS` |
| 查询与修正 | 列表、详情、搜索、按账户/日期/类型过滤；更新多拆分交易时强制保留 `transaction_journal_id` |
| 主数据 | 账户、分类、标签、预算、预算额度、可用预算；账户支持启用状态与按日余额 |
| 报表 | 官方 summary、账户/余额/预算/分类图表、支出/收入/转账洞察、净资产、预算执行情况 |
| 订阅与周期 | 订阅/账单、周期交易、存钱罐；触发周期交易会生成真实交易 |
| 附件 | 上传、下载到会话工作区、元数据维护；受 `maxAttachmentMb` 与 MIME 白名单约束 |
| 规则与元数据 | 规则、规则组、链接类型、交易链接、Webhook、币种、汇率 |
| CSV 导出 | 官方 `/v1/data/export/*` 导出到会话工作区，拒绝覆盖已有文件 |
| 实例诊断 | 版本、发布说明、端点能力探测；升级后先确认实例能力 |
| 安全边界 | Token 只保存在 DSH 凭据库；purge/destroy/cron/batch finish 永久拦截；破坏性操作强制审批 |
| Web 设置页 | 设置 → Firefly III：查看连接信息、切换五项 `autoCreate`、测试连接 |

### 1.1 与 Firefly III 6.7 对齐

插件最初按 6.6.6 实现，0.2.0 起以 6.7.9 为基线，处理了这些差异：

- **6.7 图表/洞察/自动补全返回裸 JSON 数组**，不是 JSON:API；插件已按裸数组解析（此前会得到空结果）。
- **缺失资源返回 404**（6.7 起），401 只表示令牌无效/撤销；错误码与提示已更新。
- 账户列表新增 `active=true|false` 过滤（6.7.4），并可用 `date=YYYY-MM-DD` 读取某日余额。
- 账户响应新增 `credit_card_type`、`monthly_payment_date`；信用卡账户创建时按 Firefly 要求填写。
- 分类支持 6.7.8 的 `color` 字段（6 位十六进制，不带 `#`）。
- 预算图表新增 `includeLimits=true`，调用 `chart/budget/overview-with-limits`。
- 支出洞察新增 `subscription` / `no-subscription` 分组。
- 自动补全新增 `transactions-with-meta`（含描述、日期、币种、金额）。
- `firefly_admin resource=instance` 可查看 `/about`、`/release-notes` 与端点能力探测结果。

---

## 2. 兼容性

| 组件 | 要求 |
|---|---|
| Firefly III | 6.7.x（实测 6.7.9 / API 6.7.9 / PHP 8.5.12 / MySQL）；6.6 可运行，但 6.7 新增端点会返回 404 |
| DSH | `>=0.2.2-rc.1 <0.3.0`（实测 0.2.2-rc.5） |
| Node.js | `>=22.19.0` |
| 运行时依赖 | 无；使用 Node 内建 `fetch` |

插件默认 `expectedApiPrefix: "6.7."`；`/firefly-status` 会在实例 API 版本不在该系列时告警。

---

## 3. 安装

当前通过 Git 仓库或本地目录安装（npm 包名保留为 `dsh-plugin-firefly-iii`）：

```bash
git clone https://github.com/zh-Littlebird/dsh-plugin-firefly-iii.git
cd dsh-plugin-firefly-iii

# 安装到日常 profile；Windows 请换成目录的绝对路径
dsh plugin --profile desktop add "$PWD"
```

也可以让 Agent 调用 `plugin_manager` 的 `install_bundle`，`target` 传本地目录绝对路径，或在 Web 侧栏 **Plugins → Add plugin** 选择本地目录安装。

安装后：

1. 编辑 profile 的 `cordis.patch.yml`，把 `baseUrl` 换成你的 Firefly III 地址（远程实例必须 `https`）。
2. 在 Firefly III 的 **Profile → OAuth → Personal Access Tokens** 创建令牌。
3. 在 DSH 里执行 `/firefly-token <token>` 保存令牌，再执行 `/firefly-status` 验证连接与 API 版本。
4. 打开 **设置 → Firefly III** 可查看连接信息、切换 `autoCreate` 开关并测试连接。

> 安装或升级 Host 插件后，如果 DSH Desktop 正在运行，需要重启 Harness 进程才能加载新的 Host 代码；Web 设置页无需刷新即可使用。

卸载：

```bash
dsh plugin --profile desktop remove dsh-plugin-firefly-iii
```

---

## 4. 配置

`cordis.patch.yml` 带一份可加载的默认配置；安装后按你的实例修改：

```yaml
- insert:
    - id: firefly-iii
      name: dsh-plugin-firefly-iii
      config:
        baseUrl: https://firefly.example.com/
        currency: CNY
        timeZone: Asia/Shanghai
        confirmWrites: true
        pageSize: 25
        maxAttachmentMb: 10
        expectedApiPrefix: '6.7.'
        autoCreate:
          accounts: false
          categories: false
          tags: false
          budgets: false
          piggyBanks: false
```

| 字段 | 默认值 | 说明 |
|---|---|---|
| `baseUrl` | 必填 | Firefly III 根地址；远程实例仅接受 `https`，本机允许 `http` |
| `currency` | `CNY` | 报表与汇总的默认币种 |
| `timeZone` | `Asia/Shanghai` | 交易时间与报表周期的 IANA 时区 |
| `confirmWrites` | `true` | 日常写入是否先走审批；`false` 时直接执行，破坏性操作仍强制审批 |
| `pageSize` | `25` | 列表/搜索默认分页大小（1–100） |
| `maxAttachmentMb` | `10` | 附件上传大小上限（MiB） |
| `expectedApiPrefix` | `6.7.` | `/about` 版本前缀；不匹配时 `/firefly-status` 告警 |
| `requestTimeoutMs` | `30000` | 单次请求超时（1000–120000 ms） |
| `autoCreate.accounts` | `false` | 允许隐式创建未知账户 |
| `autoCreate.categories` | `false` | 允许隐式创建未知分类 |
| `autoCreate.tags` | `false` | 允许隐式创建未知标签 |
| `autoCreate.budgets` | `false` | 允许隐式创建未知预算/预算额度 |
| `autoCreate.piggyBanks` | `false` | 允许隐式创建存钱罐 |

`autoCreate=false` 时，工具会拒绝猜测 ID/名称；请先用 `firefly_lookup` 取实时元数据，或显式创建。

### 4.1 令牌

- 推荐：`/firefly-token <token>`，值写入 DSH 凭据库，不进入会话日志。
- 备用：进程环境变量 `FIREFLY_III_ACCESS_TOKEN`。
- 清除：`/firefly-token-clear`。
- 检查：`/firefly-status` 显示版本、API 版本、令牌来源，并在系列不匹配时告警。

插件没有任何工具参数接受令牌，令牌也不会出现在工具结果、错误或调试日志中。

---

## 5. 工具

| 工具 | 作用 |
|---|---|
| `firefly_lookup` | 读实时元数据：账户（可按 `active`/`date` 过滤）、分类、标签、预算、预算额度、订阅、存钱罐、周期、规则、币种、汇率、对象组、附件；自动补全；交易/账户搜索；关联记录 |
| `firefly_record` | 记账：单笔/多笔/拆分；默认先预览，`confirm=true` 才提交 |
| `firefly_transactions` | 交易列表、详情、拆分、更新、删除、账户搬迁、交易链接 |
| `firefly_masterdata` | 账户/分类/标签/预算 CRUD；预算额度；可用预算；无预算交易巡检 |
| `firefly_reports` | summary、account/balance/budget/category 图表、insight、净资产、预算执行、月度报告、趋势 |
| `firefly_recurring` | 订阅/账单、周期交易、存钱罐；触发周期交易 |
| `firefly_attachments` | 附件列表、详情、创建、上传、下载、更新、删除 |
| `firefly_admin` | 币种、汇率、规则、规则组、链接类型、交易链接、Webhook；实例 about/release-notes/capabilities |
| `firefly_export` | 官方 CSV 导出到会话工作区 |

### 5.1 记账示例

```json
{
  "transactions": [
    {
      "type": "withdrawal",
      "date": "2026-11-22T12:30:00+08:00",
      "amount": "28.50",
      "description": "午餐",
      "source_name": "储蓄卡 A",
      "destination_name": "示例商户",
      "category_name": "餐饮",
      "tags": ["午餐"],
      "notes": "Auto-synced by DSH from text"
    }
  ],
  "confirm": false
}
```

先看预览中的类型、金额、时间、账户、分类、预算、标签和备注，再以 `confirm=true` 提交。多笔默认独立提交；只有同一笔消费需要按不同分类/预算拆金额时才用 `split=true`。

### 5.2 6.7 示例

```text
firefly_lookup  action=list resource=accounts active=true type=asset
firefly_lookup  action=autocomplete resource=transactions-with-meta query=银行
firefly_reports action=chart-budget start=2026-11-01 end=2026-11-30 includeLimits=true
firefly_reports action=insight scope=expense group=subscription start=2026-01-01 end=2026-12-01
firefly_admin   resource=instance action=capabilities
```

---

## 6. 安全与隐私

- **令牌隔离**：只存放在 DSH 凭据库或环境变量；无工具参数接收令牌；错误与日志不包含令牌。
- **永久拦截**：`/data/purge`、`/data/destroy`、`/cron/{token}`、`/batch/finish` 在客户端硬编码拒绝，无法通过任何参数绕过。
- **破坏性操作审批**：删除对象、账户批量搬迁、预算额度修改、规则/Webhook 触发、币种变更走 DSH approval；审批策略为 `never` 时失败关闭，不会静默执行。
- **写入门控**：`autoCreate` 五个开关默认关闭；未知名称不会被猜测成 ID。
- **附件边界**：上传/下载只接受会话工作区路径，受 `maxAttachmentMb` 与 MIME 白名单限制，拒绝覆盖已有文件。
- **数据流向**：账目只发送到配置的 Firefly III 实例；插件不引入第三方遥测。
- **仓库不含隐私**：示例域名统一为 `firefly.example.com`，测试夹具为通用名称与示例金额，不含真实实例、令牌或账户数据。

---

## 7. 测试

```bash
node --test tests/*.test.js
```

覆盖配置校验、HTTP 错误映射（401/404/422）、分页、日期与交易规范化、记账预览/提交/拆分、账户搬迁审批、主数据、6.7 图表/洞察/自动补全裸数组解析、账户 `active`/`date` 过滤、分类颜色、预算额度图表、实例诊断与 Web 设置页。当前 39 个用例。

---

## 8. 目录结构

```text
dsh-plugin-firefly-iii/
├── package.json           # ESM、dsh.bundle.patch、dsh.client、engines
├── cordis.patch.yml       # - insert: [{ id: firefly-iii, name, config }]
├── index.js               # name / inject / Config / apply，9 个工具与技能注册
├── src/
│   ├── client.js          # fetch 客户端、分页、错误映射
│   ├── config.js          # 配置规范化与 Standard Schema
│   ├── credentials.js     # 令牌存取
│   ├── format.js          # 输出压缩与渲染
│   ├── policy.js          # 日期、元数据、autoCreate、审批
│   ├── settings.js        # Web 设置页服务
│   ├── settings-api.js    # 本机回环设置接口
│   ├── toolkit.js         # 工具包装与输出校验
│   └── tools/             # 9 个领域工具
├── client/index.js        # Web 设置页（设置 → Firefly III）
├── skills/firefly-iii/    # 内置技能与 API 形状参考
├── locale/{en,zh}.json    # 插件管理器显示元数据
├── docs/                  # DETAIL 与预览图
├── icon.svg
└── tests/                 # node:test 单测
```

无需构建步骤：源码即发布物。

---

## 9. 开发

```bash
node --test tests/*.test.js
node --check index.js
```

发布新版本前：

1. 更新 `package.json` 版本与 `cordis.patch.yml` 默认 `expectedApiPrefix`。
2. 运行全部测试，并在真实 Firefly III 6.7.x 实例上跑一遍只读冒烟（`about`、账户列表、图表、自动补全、能力探测）。
3. 打 tag 并创建 GitHub Release，例如 `v0.2.0`。

---

## 10. 许可证

MIT。见 [LICENSE](LICENSE)。
