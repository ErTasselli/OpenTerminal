const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** ISO date shared by both providers. Nasdaq may omit the year from its labels. */
export function normalizeExpiry(value: string, now = new Date()): string | null {
  const input = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const label = /^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(input);
  if (!iso && !label) return null;

  let year: number;
  let month: number;
  let date: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    date = Number(iso[3]);
  } else {
    const name = label![1].toLowerCase();
    month = MONTHS.findIndex((m) => m === name || m.slice(0, 3) === name) + 1;
    if (month === 0) return null;
    date = Number(label![2]);
    year = label![3] ? Number(label![3]) : now.getUTCFullYear();
    if (!label![3] && (month < now.getUTCMonth() + 1 ||
      (month === now.getUTCMonth() + 1 && date < now.getUTCDate()))) year++;
  }

  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== date) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}
