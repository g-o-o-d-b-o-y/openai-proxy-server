// Money is stored as integer micro-USD (1 USD = 1_000_000 µ$) so that balances,
// spend limits and revenue never accumulate floating-point drift. USD values
// only exist at the API/UI boundary.

export const MICRO_PER_USD = 1_000_000;

export function usdToMicro(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * MICRO_PER_USD) : 0;
}

export function microToUsd(value) {
  return (Number(value) || 0) / MICRO_PER_USD;
}

export function roundUsd(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

// Display helper shared by the terminal banner, API messages and the UI.
export function formatUsd(value, { minFrac = 2, maxFrac = 6 } = {}) {
  const n = Number(value) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac })}`;
}
