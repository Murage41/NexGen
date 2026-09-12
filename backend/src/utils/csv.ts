// Escapes a value for a CSV cell, and neutralizes formula-injection payloads
// (a leading =, +, @, or a non-numeric leading -) that spreadsheet apps would
// otherwise execute on open.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (
    typeof value === 'string'
    && (/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text)))
  ) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
