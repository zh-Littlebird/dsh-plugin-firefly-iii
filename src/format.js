/** Output compaction and model-facing rendering. */

export function attributesOf(resource) {
  if (!resource || typeof resource !== 'object') return {};
  if (resource.attributes && typeof resource.attributes === 'object') {
    return { ...resource.attributes, id: resource.id ?? resource.attributes.id };
  }
  return { ...resource };
}

export function compactAccount(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    name: a.name,
    type: a.type,
    role: a.account_role,
    currency: a.currency_code,
    balance: a.current_balance,
    balanceDate: a.current_balance_date,
    active: a.active,
    iban: a.iban,
    liability: a.liability_type ?? undefined,
    // Firefly III 6.7 exposes credit-card metadata through the same endpoint.
    creditCardType: a.credit_card_type,
    monthlyPaymentDate: a.monthly_payment_date,
  });
}

export function compactCategory(resource) {
  const a = attributesOf(resource);
  return dropUndefined({ id: a.id, name: a.name, color: a.color });
}

export function compactTag(resource) {
  const a = attributesOf(resource);
  return dropUndefined({ id: a.id, tag: a.tag });
}

export function compactBudget(resource) {
  const a = attributesOf(resource);
  const spent = Array.isArray(a.spent)
    ? a.spent.map((entry) => dropUndefined({ currency: entry.currency_code, spent: entry.sum }))
    : undefined;
  return dropUndefined({
    id: a.id,
    name: a.name,
    active: a.active,
    autoBudgetType: a.auto_budget_type ?? undefined,
    autoBudgetPeriod: a.auto_budget_period ?? undefined,
    autoBudgetAmount: a.auto_budget_amount ?? undefined,
    spent,
  });
}

export function compactBudgetLimit(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    budgetId: a.budget_id,
    start: a.start,
    end: a.end,
    amount: a.amount,
    currency: a.currency_code,
    period: a.period,
    notes: a.notes,
  });
}

export function compactAvailableBudget(resource) {
  const a = attributesOf(resource);
  return dropUndefined({ id: a.id, currency: a.currency_code, amount: a.amount, start: a.start, end: a.end });
}

export function compactSplit(split, options = {}) {
  const result = dropUndefined({
    journalId: split.transaction_journal_id ?? split.id,
    type: split.type,
    date: split.date,
    amount: displayAmount(split.amount),
    currency: split.currency_code,
    description: split.description,
    sourceId: split.source_id,
    source: split.source_name,
    destinationId: split.destination_id,
    destination: split.destination_name,
    categoryId: split.category_id,
    category: split.category_name,
    budgetId: split.budget_id,
    budget: split.budget_name,
    billId: split.bill_id,
    bill: split.bill_name,
    piggyBankId: split.piggy_bank_id,
    piggyBank: split.piggy_bank_name,
    tags: split.tags,
    foreignAmount: split.foreign_amount,
    foreignCurrency: split.foreign_currency_code,
  });
  if (options.includeNotes) result.notes = split.notes;
  return result;
}

export function compactTransactionGroup(resource, options = {}) {
  const a = attributesOf(resource);
  const splits = Array.isArray(a.transactions) ? a.transactions.map((split) => compactSplit(split, options)) : [];
  return dropUndefined({
    id: a.id,
    groupTitle: a.group_title,
    date: splits[0]?.date,
    splits,
  });
}

export function compactAttachment(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    filename: a.filename,
    title: a.title,
    attachableType: a.attachable_type,
    attachableId: a.attachable_id,
    size: a.size,
    mime: a.mime,
    downloadable: a.download_url ? true : undefined,
  });
}

export function compactBill(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    name: a.name,
    amountMin: a.amount_min,
    amountMax: a.amount_max,
    date: a.date,
    endDate: a.end_date,
    repeatFreq: a.repeat_freq,
    active: a.active,
    currency: a.currency_code,
    nextExpectedMatch: a.next_expected_match,
    notes: a.notes,
  });
}

export function compactPiggyBank(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    name: a.name,
    targetAmount: a.target_amount,
    currentAmount: a.current_amount,
    percentage: a.percentage,
    startDate: a.start_date,
    targetDate: a.target_date,
    active: a.active,
    accountId: a.account_id,
    notes: a.notes,
  });
}

export function compactRecurrence(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    title: a.title,
    type: a.type,
    description: a.description,
    firstDate: a.first_date,
    repeatUntil: a.repeat_until,
    repetitions: a.repetitions,
    active: a.active,
    notes: a.notes,
  });
}

export function compactRule(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    title: a.title,
    ruleGroupId: a.rule_group_id,
    trigger: a.trigger,
    active: a.active,
    strict: a.strict,
    stopProcessing: a.stop_processing,
    description: a.description,
  });
}

export function compactRuleGroup(resource) {
  const a = attributesOf(resource);
  return dropUndefined({ id: a.id, title: a.title, active: a.active, order: a.order, description: a.description });
}

export function compactLinkType(resource) {
  const a = attributesOf(resource);
  return dropUndefined({ id: a.id, name: a.name, inward: a.inward, outward: a.outward });
}

export function compactTransactionLink(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    linkTypeId: a.link_type_id,
    linkType: a.link_type_name,
    sourceId: a.source_id,
    destinationId: a.destination_id,
    notes: a.notes,
  });
}

export function compactCurrency(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    code: a.code,
    name: a.name,
    symbol: a.symbol,
    enabled: a.enabled,
    primary: a.primary,
    decimalPlaces: a.decimal_places,
  });
}

export function compactExchangeRate(resource) {
  const a = attributesOf(resource);
  return dropUndefined({
    id: a.id,
    from: a.from_currency_code,
    to: a.to_currency_code,
    date: a.date,
    rate: a.rate,
    amount: a.amount,
  });
}

export function compactWebhook(resource) {
  const a = attributesOf(resource);
  // Never expose url secrets, trigger tokens, or headers beyond the safe shape.
  return dropUndefined({
    id: a.id,
    title: a.title,
    active: a.active,
    trigger: a.trigger,
    response: a.response,
    delivery: a.delivery,
    urlHost: safeHost(a.url),
  });
}

export function compactObjectGroup(resource) {
  const a = attributesOf(resource);
  return dropUndefined({ id: a.id, title: a.title, order: a.order });
}

export function compactGeneric(resource) {
  const a = attributesOf(resource);
  const copy = { ...a };
  for (const key of ['url', 'download_url', 'upload_url', 'secret', 'trigger_token', 'headers', 'user', 'password']) {
    delete copy[key];
  }
  return copy;
}

function safeHost(value) {
  try {
    return new URL(String(value)).host;
  } catch {
    return undefined;
  }
}

export function dropUndefined(object) {
  for (const key of Object.keys(object)) {
    if (object[key] === undefined || object[key] === null) delete object[key];
  }
  return object;
}

/** Firefly III returns fixed-precision decimals such as 14.500000000000. */
export function displayAmount(value) {
  if (value === undefined || value === null) return value;
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return text;
  const [whole, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${whole}.${trimmed.padEnd(2, '0')}`;
}

export function parseAmountToCents(value) {  const text = String(value ?? '0').trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = (match[3] ?? '').padEnd(2, '0').slice(0, 2);
  return sign * (whole * 100 + Number(fraction));
}

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function money(amount, currency) {
  return `${amount ?? '0'}${currency ? ` ${currency}` : ''}`;
}

function printItem(item) {
  if (typeof item === 'string') return `- ${item}`;
  return `- ${JSON.stringify(item)}`;
}

/** Generic model-facing renderer shared by most tools. */
export function renderResult(_args, value) {
  if (!value || typeof value !== 'object') return [{ type: 'text', text: String(value) }];
  const lines = [];
  if (value.ok === false) {
    lines.push(`Firefly III error: ${value.error?.code ?? 'ERROR'} — ${value.error?.message ?? 'unknown error'}`);
    if (value.error?.details) lines.push(`Details: ${JSON.stringify(value.error.details)}`);
    return [{ type: 'text', text: lines.join('\n') }];
  }
  if (value.summary) lines.push(value.summary);
  if (value.counts) {
    const parts = Object.entries(value.counts)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`);
    if (parts.length > 0) lines.push(`Counts: ${parts.join(', ')}`);
  }
  if (Array.isArray(value.items) && value.items.length > 0) {
    lines.push('Items:');
    for (const item of value.items.slice(0, 60)) lines.push(printItem(item));
    if (value.items.length > 60) lines.push(`… ${value.items.length - 60} more items omitted from display; request a narrower filter.`);
  }
  for (const key of ['version', 'apiVersion', 'path', 'bytes', 'preview']) {
    if (value[key] !== undefined) lines.push(`${key}: ${typeof value[key] === 'string' ? value[key] : JSON.stringify(value[key])}`);
  }
  if (Array.isArray(value.warnings) && value.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of value.warnings) lines.push(`- ${warning}`);
  }
  if (value.truncated) lines.push('Result truncated: use page/limit or a narrower date range to see more.');
  if (value.hint) lines.push(`Hint: ${value.hint}`);
  return [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'Done.' }];
}

/** Record-specific renderer: show every submitted field, including notes. */
export function renderRecord(_args, value) {
  if (value?.ok === false) return renderResult(_args, value);
  const lines = [value.summary || 'Firefly III transaction result'];
  if (value.preview) lines.push('Preview only; confirm=true submits these payloads.');
  for (const entry of value.items ?? []) {
    lines.push('');
    lines.push(`#${entry.index ?? '?'} ${entry.status ?? 'planned'}`);
    const splits = entry.payload?.transactions ?? entry.splits ?? [];
    for (const [index, split] of splits.entries()) {
      const display = entry.display?.[index] ?? {};
      lines.push(
        [
          `type=${split.type}`,
          `amount=${split.amount}`,
          `date=${split.date}`,
          `desc=${split.description}`,
          `source=${split.source_name ?? display.source ?? split.source_id ?? '无'}`,
          `destination=${split.destination_name ?? display.destination ?? split.destination_id ?? '无'}`,
          `category=${split.category_name ?? display.category ?? split.category_id ?? '无'}`,
          `budget=${split.budget_name ?? display.budget ?? split.budget_id ?? '无'}`,
          `tags=${Array.isArray(split.tags) && split.tags.length > 0 ? split.tags.join(',') : '无'}`,
        ].join(' · '),
      );
      lines.push(`notes=${split.notes ?? '无'}`);
    }
    if (entry.id) lines.push(`transaction_group_id=${entry.id}`);
  }
  if (Array.isArray(value.warnings) && value.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warning of value.warnings) lines.push(`- ${warning}`);
  }
  if (value.hint) lines.push('', `Hint: ${value.hint}`);
  return [{ type: 'text', text: lines.join('\n') }];
}
