# Firefly III 6.7 API 形状（插件用裁剪版，基线 6.7.9）

## 分页与错误

- 列表分页是 `page` + `limit`（默认 50，最大 100），响应 `meta.pagination` 含 `current_page`、`total_pages`、`total`。
- 6.7.x（实测 6.7.9）中缺失资源返回 **404**（JSON `{"message":"Resource not found"}`），401 只表示令牌缺失/无效/被撤销；插件分别映射为 `ENDPOINT_UNAVAILABLE` 与 `AUTH_FAILED`。404 也可能是路由不存在：先核对 id，再确认实例暴露该端点。
- 错误响应若是 HTML 页面，插件会压成一行文本，不把标签原样交给模型。
- 422 返回 `{"message": "...", "errors": {"字段": ["..."]}}`，插件原样透传 `errors`。

## 交易

- `POST /v1/transactions` body：`{transactions:[split...], apply_rules, fire_webhooks, error_if_duplicate_hash, group_title}`。
- `TransactionSplitStore` 必填：`amount`, `date`, `description`, `type`；常用可选：`source_id/name`, `destination_id/name`, `category_id/name`, `budget_id/name`, `tags`, `notes`, `bill_id/name`, `piggy_bank_id/name`, `currency_code`, `foreign_amount`, `foreign_currency_code`, `reconciled`, `internal_reference`, `external_id/external_url`, `sepa_*`, 六个日期字段。
- `PUT /v1/transactions/{group_id}` body `{transactions:[TransactionSplitUpdate...]}`；多拆分必须带 `transaction_journal_id`。
- `DELETE /v1/transactions/{group_id}` 删除整组；`DELETE /v1/transaction-journals/{journal_id}` 删除单拆分。
- `GET /v1/transaction-journals/{journal_id}` 读取拆分；`/links` 读取交易链接。
- `POST /v1/data/bulk/transactions?query=<JSON字符串>`，只支持 `{"where":{"account_id":X},"update":{"account_id":Y}}`，成功 204。

## 账户

`AccountStore` 必填 `name`, `type`；`type` 常用 `asset`, `expense`, `revenue`, `liability`, `cash`；可选 `account_role`, `currency_code`, `opening_balance`, `opening_balance_date`, `iban`, `bic`, `account_number`, `active`, `include_net_worth`, `credit_card_type`, `monthly_payment_date`, `liability_type`, `liability_direction`, `interest`, `interest_period`, `notes`。信用卡账户（`account_role=ccAsset`）需要 `credit_card_type` 与 `monthly_payment_date`。

- `GET /v1/accounts` 在 6.7.4 起支持 `active=true|false` 过滤；响应新增 `credit_card_type`、`monthly_payment_date`（6.7.1 修复后可用）。`date=YYYY-MM-DD` 可按指定日期计算余额。
- 插件只把 `active`、`type`、`date` 几个常用参数开放给模型，其余排序/过滤参数不透传。

## 分类 / 标签 / 预算

- `CategoryStore`：`name` 必填，`notes`、`color` 可选；`color` 是 6 位十六进制（不带 `#`，如 `ff8800`），传 `null` 清除（6.7.8 新增）。
- `TagModelStore`：`tag` 必填；标签接口接受名称或 ID，中文/空格需 URL 编码。
- `BudgetStore`：`name` 必填；`auto_budget_type` 取 `reset|rollover|none`，`auto_budget_period` 取 `daily|weekly|monthly|quarterly|half-year|yearly`。
- 关闭自动预算时不要传 `null` 或 0；实测传 `auto_budget_type:"none"` 并保留正数金额与原周期，保存后 Firefly 会清空三个字段。
- `BudgetLimitStore`：`amount`, `start`, `end`, `budget_id`；`currency_id` 传整数，字符串在部分实例会 500。
- `available-budgets` 只读，不接受写入。

## 报表

- `GET /v1/summary/basic?start&end[&currency_code]`，要求 `start < end`；返回**裸对象**（键是 `balance-in-CNY` 这类指标名）。
- 图表、洞察、自动补全返回**裸 JSON 数组**，不是 JSON:API；列表/搜索/详情才是 `{data: ...}`。插件按此解析，图表序列只保留最近 60 个点。
- 图表：`/chart/account/overview`、`/chart/balance/balance`（支持 `period`、`accounts[]`）、`/chart/budget/overview`、`/chart/budget/overview-with-limits`（6.7 新增，预算桶带 limits）、`/chart/category/overview`（不支持 ID 过滤）。
- 洞察：`/insight/{expense|income|transfer}/{group}?start&end[&accounts[]][&bills[]|budgets[]|categories[]|tags[]]`。
  - expense groups：`expense asset bill no-bill subscription no-subscription budget no-budget category no-category tag no-tag total`
  - `subscription`/`no-subscription` 是 6.7 新增路由，目前复用 Bill 控制器（与 `bill`/`no-bill` 同源）。
  - income groups：`revenue asset category no-category tag no-tag total`
  - transfer groups：`asset category no-category tag no-tag total`
- 日期范围必须 `start < end`；`summary/basic` 不接受相等日期。

## 订阅 / 周期 / 存钱罐

- `BillStore`：`name`, `amount_min`, `amount_max`, `date`, `repeat_freq`（`weekly|monthly|quarterly|half-year|yearly`）必填。
- `subscriptions` 在 6.7.9 仍复用 Bill 控制器；请求体按 `BillStore`，spec 缺 `Subscription*` schema。
- `RecurrenceStore`：`type`, `title`, `first_date`, `repeat_until`, `repetitions`, `transactions` 必填；`transactions[]` 按 `RecurrenceTransactionStore`（`description`, `amount`, `source_id`, `destination_id` 必填）。
- 触发：`POST /v1/recurrences/{id}/trigger?date=YYYY-MM-DD`，日期必须是未来发生日；现在生成交易。
- `PiggyBankStore`：`name`, `account_id`, `target_amount`, `start_date` 必填。

## 附件

- `AttachmentStore`：`filename`, `attachable_type`, `attachable_id` 必填；`attachable_type` 取 `Account|Budget|Bill|TransactionJournal|PiggyBank|Tag`。
- 上传 `POST /v1/attachments/{id}/upload`，请求体是文件原始字节，`Content-Type` 为文件类型；成功 204。
- 下载 `GET /v1/attachments/{id}/download` 返回二进制；不要覆盖已有文件。

## 规则 / 链接 / Webhook

- `RuleGroupStore`：`title` 必填；`RuleStore`：`title`, `rule_group_id`, `trigger`, `triggers`, `actions` 必填。
- `RuleTriggerType`：`store-journal|update-journal|manual-activation`；`RuleActionStore`/`RuleTriggerStore` 都需要 `type` + `value`。
- 规则测试：`GET /v1/rules/{id}/test`、`GET /v1/rule-groups/{id}/test`（只预览）；触发用 POST `.../trigger`。
- `TransactionLinkStore`：`link_type_id`, `source_id`, `destination_id`；`LinkType`：`name`, `inward`, `outward`。
- `WebhookStore`：`title`, `trigger`, `response`, `delivery`, `url`；`trigger` 取 `ANY|STORE_TRANSACTION|UPDATE_TRANSACTION|DESTROY_TRANSACTION|STORE_BUDGET|UPDATE_BUDGET|DESTROY_BUDGET|STORE_UPDATE_BUDGET_LIMIT`，`response` 取 `TRANSACTIONS|ACCOUNTS|BUDGET|RELEVANT|NONE`，`delivery` 取 `JSON`。
- Webhook 密钥、认证头、签名不得出现在回复与日志中；插件只展示 URL host。

## 实例信息 / 偏好 / 自动补全

- `GET /v1/about` → `version`、`api_version`、`php_version`、`os`、`driver`；`firefly_admin resource=instance action=about` 会对照 `expectedApiPrefix` 给出兼容性警告。
- `GET /v1/release-notes[/{version}]`（6.7.8 新增）→ `{version, release_notes, release_notes_markdown}`；插件优先取 Markdown，没有时把 HTML 转纯文本并截断。
- `GET /v1/preferences`、`GET /v1/preferences-list/{list}`（后者 6.7 新增）。`preferences/currencyPreference` 在本实例返回 500，主币种请用 `/currencies/primary`；插件不写偏好。
- `GET /v1/autocomplete/transactions-with-meta`（6.7 起由 `transactions-with-id` 重命名）返回 `id`、`transaction_group_id`、`description`、`date`、`currency_code`、`amount`；`autocomplete/currencies-with-code`、`autocomplete/piggy-banks-with-balance` 已移除。
- `firefly_admin resource=instance action=capabilities` 会探测 webhooks、subscriptions、preferences、release-notes、transactions-with-meta 五个端点，升级后先用它确认实例能力。

## 币种 / 汇率

- `CurrencyStore`：`code`, `name`, `symbol` 必填；`enabled`, `primary`, `decimal_places` 可选。
- `POST /v1/currencies/{code}/{enable|disable|primary}` 改变全账本视图，必须审批。
- 汇率创建按 `CurrencyExchangeRateStore`（`from`, `date`, `rates`）或按币对/日期专用端点；方向不可互换。

## 导出

`GET /v1/data/export/{accounts,bills,budgets,categories,piggy-banks,recurring,rules,subscriptions,tags}`；交易导出额外需要 `start`、`end`。返回 CSV 与 `Content-Disposition`。
