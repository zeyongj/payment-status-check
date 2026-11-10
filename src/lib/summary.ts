import * as XLSX from 'xlsx';
import { assignAP, DEFAULT_PM } from './defaults';
import { effectiveStatus } from './matching';
import type { MatchResult, ReviewSelections, SummaryRow } from './types';

export function externalStatus(status: string): string {
  const key = status.trim().toUpperCase();
  if (['AP', 'APPROVED'].includes(key)) return 'Approved for payment';
  if (['SITE A', 'SITE B', 'PM', 'SRPM', 'SCAN'].includes(key)) return 'Pending Approval';
  return status;
}

function summaryOwner(project: string, name: string | undefined): string {
  if (name?.trim()) return name;
  return /^RM\d+$/i.test(project.trim()) ? '-' : (name ?? '');
}

export function buildSummary(
  results: MatchResult[],
  kind: 'internal' | 'external',
  selections: ReviewSelections = {},
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const result of results) {
    const reviewed = Object.prototype.hasOwnProperty.call(selections, result.id);
    const selected = reviewed
      ? result.candidates.filter((c) => selections[result.id].includes(c.id))
      : result.accepted;
    if (!selected.length) {
      const status = reviewed || result.resolution === 'missing' ? 'Missing' : 'Needs review';
      const auditNotes =
        kind === 'internal'
          ? [
              result.request.notes,
              ...result.candidates
                .filter((candidate) => candidate.record.notes)
                .map((candidate) => {
                  const record = candidate.record;
                  return `[${reviewed ? 'Rejected' : 'Unconfirmed'} candidate ${record.invoice}; project ${record.project || 'unknown'}; ${record.source} ${record.sheet}:${record.row}]\n${record.notes}`;
                }),
            ]
              .filter(Boolean)
              .join('\n\n')
          : '';
      const row: SummaryRow = {
        Invoice: result.request.invoice,
        ...(kind === 'internal' ? { 'Project number': result.request.project } : {}),
        Status: status,
        Notes: auditNotes,
      };
      if (kind === 'internal')
        Object.assign(row, {
          'Project number': result.request.project,
          'AP name': summaryOwner(result.request.project, result.ap),
          'PM name': summaryOwner(result.request.project, result.pm),
          'Original stage': '',
          'Original status': '',
          'Matched invoice': '',
          'Match method': result.method,
          'Match score': result.score,
          Review: reviewed
            ? 'Reviewed: no match'
            : result.resolution === 'review'
              ? 'Needs review'
              : 'No match',
          'Source file': '',
          'Source sheet': '',
          'Source row': '',
          'Statement sheet': result.request.sheet,
          'Statement row': result.request.row,
        });
      rows.push(row);
      continue;
    }
    for (const candidate of selected) {
      const record = candidate.record;
      const status = effectiveStatus(record);
      const notes = [...new Set([result.request.notes, record.notes].filter(Boolean))].join('\n');
      const row: SummaryRow = {
        Invoice: result.request.invoice,
        ...(kind === 'internal'
          ? { 'Project number': record.project || result.request.project }
          : {}),
        Status: kind === 'external' ? externalStatus(status) : status,
        Notes: kind === 'internal' ? notes : status.toUpperCase() === 'SCAN' ? record.notes : '',
      };
      if (kind === 'internal')
        Object.assign(row, {
          'Project number': record.project || result.request.project,
          'AP name': summaryOwner(
            record.project || result.request.project,
            candidate.ap ?? assignAP(record.project),
          ),
          'PM name': summaryOwner(
            record.project || result.request.project,
            candidate.pm ?? DEFAULT_PM[record.project],
          ),
          'Original stage': record.stage,
          'Original status': record.status,
          'Matched invoice': record.invoice,
          'Match method': candidate.method,
          'Match score': candidate.score,
          Review: reviewed ? 'Reviewed' : 'Automatic',
          'Source file': record.source,
          'Source sheet': record.sheet,
          'Source row': record.row,
          'Statement sheet': result.request.sheet,
          'Statement row': result.request.row,
        });
      rows.push(row);
    }
  }
  return rows;
}

export function safeCell(value: string | number | undefined): string | number {
  if (typeof value === 'number') return value;
  const text = value ?? '';
  if (text === '-') return text;
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
}

export function summaryCSV(rows: SummaryRow[]): string {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!headers.length) headers.push('Invoice', 'Status', 'Notes');
  const quote = (value: string | number | undefined) =>
    `"${String(safeCell(value)).replace(/"/g, '""')}"`;
  return (
    '\uFEFF' +
    [
      headers.map(quote).join(','),
      ...rows.map((row) => headers.map((key) => quote(row[key as keyof SummaryRow])).join(',')),
    ].join('\r\n')
  );
}

export function summaryWorkbook(rows: SummaryRow[], kind: 'internal' | 'external'): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const safeRows = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])),
  );
  const sheet = XLSX.utils.json_to_sheet(
    safeRows.length ? safeRows : [{ Invoice: '', Status: '', Notes: '' }],
  );
  const columns = Object.keys(safeRows[0] ?? { Invoice: '', Status: '', Notes: '' });
  sheet['!cols'] = columns.map((name) => ({
    wch: name === 'Notes' ? 60 : name === 'PM name' ? 35 : name.includes('sheet') ? 25 : 22,
  }));
  sheet['!autofilter'] = { ref: sheet['!ref'] ?? 'A1:C1' };
  XLSX.utils.book_append_sheet(
    workbook,
    sheet,
    kind === 'internal' ? 'Internal summary' : 'External summary',
  );
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
}

export function downloadSummary(
  rows: SummaryRow[],
  kind: 'internal' | 'external',
  format: 'csv' | 'xlsx',
): void {
  const contents = format === 'csv' ? summaryCSV(rows) : summaryWorkbook(rows, kind);
  const blob = new Blob([contents as BlobPart], {
    type:
      format === 'csv'
        ? 'text/csv;charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  anchor.download = `payment-status-${kind}-${localDate}.${format}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
