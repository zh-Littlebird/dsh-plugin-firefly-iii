/** Shared JSON Schema fragments (plain JSON Schema, accepted by ctx.tools.register). */

export const transactionSplitProperties = {
  transaction_journal_id: {
    type: 'string',
    description: 'Existing split id required when updating a transaction group with more than one split; copy it from firefly_transactions action=get.',
  },
  type: {
    type: 'string',
    enum: ['withdrawal', 'deposit', 'transfer'],
    description: 'withdrawal = expense, deposit = income, transfer = movement between asset/liability accounts.',
  },
  date: {
    type: 'string',
    description: 'Required timestamp in the form 2026-11-17T14:35:00+08:00. A real HH:MM:SS is mandatory; 00:00:00 is rejected as a placeholder.',
  },
  amount: {
    type: 'string',
    description: 'Positive decimal string such as "20.00"; string amounts avoid floating-point drift.',
  },
  description: { type: 'string', description: 'Merchant or item summary.' },
  source_id: { type: 'string', description: 'Source account id from firefly_lookup; preferred over source_name.' },
  source_name: { type: 'string', description: 'Source account name; only safe when autoCreate.accounts is true or the exact name already exists.' },
  destination_id: { type: 'string', description: 'Destination account id from firefly_lookup.' },
  destination_name: { type: 'string', description: 'Destination account name.' },
  category_id: { type: 'string', description: 'Category id from firefly_lookup.' },
  category_name: { type: 'string', description: 'Category name; resolved to an id when it exists.' },
  budget_id: { type: 'string', description: 'Budget id from firefly_lookup.' },
  budget_name: { type: 'string', description: 'Budget name; updates should prefer budget_id because Firefly ignores budget_name on update.' },
  tags: {
    type: 'array',
    items: { type: 'string' },
    description: 'Tag names, never tag ids. autoCreate.tags=false requires every tag to exist.',
  },
  notes: { type: 'string', description: 'Free text notes; keep the source marker and item details here.' },
  bill_id: { type: 'string', description: 'Optional bill/subscription id.' },
  bill_name: { type: 'string', description: 'Optional bill/subscription name.' },
  piggy_bank_id: { type: 'string', description: 'Optional piggy bank id.' },
  piggy_bank_name: { type: 'string', description: 'Optional piggy bank name.' },
  currency_code: { type: 'string', description: 'Transaction currency; defaults to the account currency.' },
  foreign_amount: { type: 'string', description: 'Foreign amount as a decimal string.' },
  foreign_currency_code: { type: 'string', description: 'Foreign currency ISO code.' },
  reconciled: { type: 'boolean', description: 'Whether the split is reconciled.' },
  internal_reference: { type: 'string', description: 'Optional internal reference.' },
  external_id: { type: 'string', description: 'Optional external id.' },
  external_url: { type: 'string', description: 'Optional external URL.' },
  interest_date: { type: 'string', description: 'Optional YYYY-MM-DD date field.' },
  book_date: { type: 'string', description: 'Optional YYYY-MM-DD date field.' },
  process_date: { type: 'string', description: 'Optional YYYY-MM-DD date field.' },
  due_date: { type: 'string', description: 'Optional YYYY-MM-DD date field.' },
  payment_date: { type: 'string', description: 'Optional YYYY-MM-DD date field.' },
  invoice_date: { type: 'string', description: 'Optional YYYY-MM-DD date field.' },
};

export const transactionSplitSchema = {
  type: 'object',
  properties: transactionSplitProperties,
  additionalProperties: true,
};
