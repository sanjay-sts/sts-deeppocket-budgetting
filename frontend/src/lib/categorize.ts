import type { Rule, Transaction } from '../types';

// Rules-first classifier. Runs the ordered rule list and returns the first match.
// Used when reclassifying a transaction after its merchant name changes, or
// when applying new rules to unclassified items.
export function classifyMerchant(raw: string, rules: Rule[]): string {
  const upper = raw.toUpperCase();
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  for (const r of ordered) {
    if (r.matcher.kind === 'contains') {
      if (upper.includes(r.matcher.value.toUpperCase())) return r.categoryId;
    } else if (r.matcher.kind === 'regex') {
      if (new RegExp(r.matcher.value, 'i').test(raw)) return r.categoryId;
    }
  }
  return 'unclassified';
}

export function reclassifyAll(transactions: Transaction[], rules: Rule[]): Transaction[] {
  return transactions.map((t) => ({
    ...t,
    categoryId: classifyMerchant(t.rawMerchant, rules),
  }));
}
