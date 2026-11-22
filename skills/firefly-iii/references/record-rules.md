# 交易字段与拆分规则

## 必填与校验

每次 `firefly_record` 的拆分至少需要：

- `type`：`withdrawal`（支出）、`deposit`（收入）、`transfer`（转账）。
- `date`：`YYYY-MM-DDTHH:MM:SS+08:00`。日期可以省略时区，插件按配置时区补齐；`00:00:00` 会被拒绝。
- `amount`：正数小数字符串，例如 `"20.00"`。不要用浮点数。
- `description`：商户或消费项目简述。
- 源账户与目标账户：`source_id`/`source_name`、`destination_id`/`destination_name` 各给一个。

## 账户方向

| 类型 | 源账户 | 目标账户 |
|---|---|---|
| 支出 | 资产 / 负债 / 现金账户 | 支出账户（商户/类别） |
| 收入 | 收入账户（工资、退款来源） | 资产 / 负债账户 |
| 转账 | 资产 / 负债账户 | 资产 / 负债账户 |

基金买卖、信用卡还款、账户间调拨都记为 `transfer`。

## 元数据策略

- autoCreate 对应开关为 `true`：名称不存在时 Firefly 会隐式创建；预览会给出 warning。
- 开关为 `false`：名称必须匹配现有对象。插件按忽略大小写的精确名称解析为 ID；0 个匹配返回 `AUTO_CREATE_DISABLED` 与候选，多于 1 个返回 `AMBIGUOUS_NAME`。未知 ID 返回 `INVALID_ID`。
- 标签始终是名称数组；关闭 tags 自动创建时，每个标签都必须已存在。
- 每次调用都重新读取元数据，插件不做跨调用缓存。

## 独立 vs 拆分 vs 合并

- 用户描述或截图里的多笔支付：独立交易，`split=false`，逐笔 POST、各有 ID。
- 一张小票按不同分类拆金额：`split=true`，一次 POST、同一交易组，每个拆分有自己的金额与分类。
- 用户明确说“合并为一笔”：才把多笔放进同一个 `split=true` 调用；否则不要合并。

## 备注

推荐保留来源与明细：

```text
Auto-synced by DSH from text
Items: 牛奶 2盒、面包 1袋、纸巾
```

图片记账写 `from image`；识别不出商品时只保留来源标记，不编造明细。

## 更新

- 先 `firefly_transactions action=get`；工具内部也会再 GET 一次并返回 before/after。
- 多拆分交易必须回传全部拆分，每个都带 `transaction_journal_id`。
- 改预算传 `budget_id`；改分类优先 `category_id`；账户用 `source_id`/`destination_id`。
- `amount` 用字符串；`date` 用带时区的 ISO 时间；`tags` 是名称数组。
- 为了改一个字段，也建议保留原 `type`、`date`、`amount`、`description`、账户字段，避免 Firefly 静默忽略。

## 删除

- `action=delete` 删除整个交易组，不是单个拆分。
- 工具先读取组详情，approval 通过后才 DELETE；删除后返回被删对象快照。

## 金额汇总

插件内部按“分”做整数累加，展示时再格式化；不要用 JS 浮点相加。
