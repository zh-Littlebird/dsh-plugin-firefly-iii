---
name: firefly-iii
description: 当用户要把流水录入 Firefly III、补录历史账、基于 Firefly III 查询/修正/删除交易、维护账户/分类/预算/标签、检查预算闭环、做支出分析，或处理订阅/账单、周期交易、存钱罐、附件、规则、币种、汇率、CSV 导出时使用。不要用于与 Firefly III 数据无关的泛财务建议。
---

# Firefly III 记账

面向 Firefly III **6.7.x**（当前实测基线 6.7.9）的记账与账务分析。用 `firefly_*` 工具完成操作，不要用 bash 拼 curl，也不要把裸 REST 请求当代理。

## 三条纪律

1. **先读元数据，再写入**：任何涉及账户、分类、预算、标签的提交，先调用 `firefly_lookup`（`action=list` 或 `autocomplete`）取实时数据。不要使用记忆中的 ID。
2. **autoCreate=false 时禁止猜 ID / 猜名字**：插件会拒绝未知名称并返回候选。此时只能从候选里选，或明确告知用户开关已关闭。
3. **破坏性操作先展示再执行**：删除、账户批量搬迁、预算额度变更、规则/Webhook 触发、币种变更都会走 DSH approval。approval 被拒绝（包括会话策略为 never）时操作不会发生，不要换路径绕过。

`/data/purge`、`/data/destroy`、cron、batch finish 永久不可调用；用户要求时说明不可逆风险并拒绝。

## 工具路由

| 意图 | 工具 |
|---|---|
| 记一笔 / 多笔 / 拆分 / 补账 | `firefly_record`（先 `firefly_lookup`） |
| 查、搜、看详情、改、删交易；账户搬迁 | `firefly_transactions` |
| 账户 / 分类 / 标签 / 预算 / 预算额度 CRUD；漏挂预算巡检 | `firefly_masterdata` |
| 汇总、图表、洞察、净资产、月度复盘、趋势、预算剩余 | `firefly_reports` |
| 订阅/账单、周期交易、存钱罐 | `firefly_recurring` |
| 附件上传/下载/维护 | `firefly_attachments` |
| 币种、汇率、规则、规则组、交易链接、Webhook | `firefly_admin` |
| 实例版本、发布说明、能力探测 | `firefly_admin`（`resource=instance`） |
| 官方 CSV 导出 | `firefly_export` |

跨域任务允许串联，但每一步都要用上一步返回的真实 ID。

## 记账流程

1. `firefly_lookup` 取账户、分类、预算、标签（`resource=all` 一次拿四张表）。
2. 判定交易类型：支出 `withdrawal`、收入 `deposit`、账户间转移/基金买卖 `transfer`。
3. 时间必须具体到 `HH:MM:SS`。不清楚就问；`00:00:00` 会被拒绝为占位值。日期格式示例：`2026-11-17T14:35:00+08:00`。
4. 多笔默认独立提交（`transactions` 数组逐笔 POST）。只有同一笔消费需要按不同分类/预算拆金额时，才传 `split=true`。
5. 备注保留来源标记与明细，例如 `Auto-synced by DSH from text\nItems: 牛奶 2盒、面包`。
6. 先 `confirm=false` 预览；核对类型、金额、时间、源/目标账户、分类、预算、标签、备注后再 `confirm=true`。
7. 汇报每笔交易 ID 与完整字段；若 Firefly 规则改写了字段，以返回值说明差异。

字段细节见 `references/record-rules.md`。

## 查询与修正

- 列表用 `firefly_transactions action=list`，可按 start/end/type/accountId 过滤；分页用 `page`，不要一次拉超大范围。
- 详情用 `action=get`（交易组）或 `action=journal`（单个拆分）。
- 更新前工具会自动 GET 原交易并把 before/after 返回；多拆分交易必须回传每个 `transaction_journal_id`，否则可能删掉拆分。
- 改预算优先传 `budget_id`；`budget_name` 在更新时不可靠。改分类优先 `category_id`。标签传名称数组。
- 删除是删除整个交易组；先看详情再删。
- `action=bulk-move` 只用于把某账户全部交易迁到另一账户，不支持批量改分类/预算/金额。

## 分析与预算

- 用官方接口优先：`summary`、`chart-*`、`insight`、`budget-status`。
- 查漏配：`firefly_reports action=insight scope=expense group=no-budget/no-category/no-tag/no-bill`，再看 `firefly_masterdata action=transactions-without-budget` 明细。
- 6.7 起 expense 洞察新增 `subscription` / `no-subscription`；`chart-budget` 传 `includeLimits=true` 可拿到带预算额度的官方图表。
- 账户列表可用 `active=true|false` 区分启用/停用账户（6.7.4 新增），`date=YYYY-MM-DD` 查看某日余额；停用账户默认仍会出现，做候选时按需过滤。
- `budget-status` 结合预算 `spent` 与 `budget-limits`；解释超支时用 `budget-limit-transactions` 回查额度分段明细。
- `report`/`trend` 是插件侧聚合，精确对账时以官方 insight 为准。

## 长尾能力

- 订阅优先 `subscription`，`bill` 仅兼容旧实例；两者 ID 不混用。
- 创建周期交易前核对 `references/api-shapes.md` 的 `RecurrenceStore`，不要拿普通交易 payload 猜。删除 recurrence 不会删除已生成交易；触发会立即生成真实交易。
- 存钱罐创建受 `autoCreate.piggyBanks` 限制。
- 附件上传限工作区路径、`maxAttachmentMb` 与 MIME 白名单；下载拒绝覆盖已有文件。附件挂在 `TransactionJournal` 上，不是交易组。
- Webhook 在实例返回 404 时按能力不可用处理，提示用户，不要反复重试。
- CSV 导出只写会话工作区，拒绝覆盖。

## 配置与 token

- 令牌与实例地址优先让用户在 DSH 的 **设置 → Firefly III** 页面填写（令牌只写入本机凭据库，不会回显）；不要让用户把令牌粘贴进对话。也可用 `/firefly-token <token>`（命令不在会话日志记录输入）保存令牌。
- `/firefly-status` 验证连接和 API 版本，`expectedApiPrefix` 默认 `6.7.`。
- 实例升级后先跑 `firefly_admin resource=instance action=about` 与 `action=capabilities`；缺失能力（如 Webhook 404）按实例限制提示，不要反复重试。
- `confirmWrites=false` 时日常写入直接执行；删除等破坏性操作仍强制 approval。会话 approval 策略为 never 时这些操作会失败，属于 fail-closed。
- autoCreate 五个开关控制隐式新建与显式创建；关闭时不要引导用户“先随便填一个名字”。

## 输出与故障

- 成功回报：交易/对象 ID、日期范围、金额或影响范围。
- 失败分层说明：认证（6.7 起 401 只表示令牌无效/撤销）、对象或端点不存在（404，先核对 id 再怀疑路由）、payload 校验（422，原样透传 `errors`）、网络。
- 隐私：生活账目只留在 Firefly III 与当前会话，不写入项目日志、日报或外部文件。
