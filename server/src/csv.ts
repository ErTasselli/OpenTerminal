/**
 * Minimal RFC 4180 CSV for portfolio import/export: quoted fields, "" escapes,
 * CRLF or LF line endings, optional UTF-8 BOM. No external dependency.
 */

/** Parses CSV text into rows of string cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error("unterminated quoted field");
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

/**
 * Spreadsheet apps execute cells that start with = + - @ (and tab/CR) as
 * formulas ("CSV injection"). Text cells starting with one are prefixed with
 * an apostrophe; numbers are written as plain numbers and need no guard.
 */
function cellOut(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(cellOut).join(",")).join("\r\n") + "\r\n";
}
