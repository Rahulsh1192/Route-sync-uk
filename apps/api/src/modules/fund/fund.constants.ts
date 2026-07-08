/**
 * Instructor Community Fund — net-profit formula constants.
 *
 * "Net profit" for a period is defined transparently and reproducibly as:
 *
 *     gross_revenue = active_monthly × £4.99  +  active_yearly × (£29.99 / 12)
 *     net_profit    = gross_revenue × (1 − COST_RATIO)
 *     fund_amount   = net_profit × (ALLOCATION_PCT / 100)
 *
 * COST_RATIO is the assumed share of revenue consumed by payment fees, transcoding,
 * storage/CDN egress and infrastructure. It is an explicit, auditable assumption
 * stored on every allocation entry (net_profit_minor + allocation_pct) so the public
 * transparency report can show exactly how each figure was derived.
 */
export const ALLOCATION_PCT = 10; // 10% of net profit
export const COST_RATIO = 0.4; // 40% assumed cost of revenue

export const PRICE_MONTHLY_MINOR = 499; // £4.99
export const PRICE_YEARLY_MINOR = 2999; // £29.99
