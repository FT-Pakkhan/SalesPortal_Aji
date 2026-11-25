// Footer totals of a grid column (like SAP B1 / DevExpress footer summaries), worked out over the rows shown.

export type SummaryType = 'sum' | 'min' | 'max' | 'count' | 'avg';

export const SUMMARY_LABELS: Record<SummaryType, string> = {
  sum: 'Sum',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  avg: 'Average',
};

/** Short form shown in the footer cell, e.g. "Sum: 2,550.00" */
const SHORT_LABELS: Record<SummaryType, string> = {
  sum: 'Sum',
  min: 'Min',
  max: 'Max',
  count: 'Count',
  avg: 'Avg',
};

const formatNumber = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The footer text for one column. `values` are the column's values on the rows shown;
 * Count counts the rows that have a value, the others use the numbers only.
 */
export function summaryText(type: SummaryType, values: unknown[]): string {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (type === 'count') return `${SHORT_LABELS.count}: ${present.length.toLocaleString('en-US')}`;

  const numbers = present.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return `${SHORT_LABELS[type]}: -`;
  let result: number;
  if (type === 'sum') result = numbers.reduce((a, b) => a + b, 0);
  else if (type === 'min') result = Math.min(...numbers);
  else if (type === 'max') result = Math.max(...numbers);
  else result = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  return `${SHORT_LABELS[type]}: ${formatNumber(result)}`;
}
