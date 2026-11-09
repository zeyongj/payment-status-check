import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { reconcile } from '../src/lib/matching';
import { extractRecords, parseBytes, suggestMapping } from '../src/lib/parser';
import { buildSummary, safeCell, summaryCSV, summaryWorkbook } from '../src/lib/summary';
import type { InvoiceRecord } from '../src/lib/types';

const invoice = (extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: 'requested',
  invoice: 'RENT-TEST-01',
  project: '',
  company: '',
  vendor: '',
  stage: '',
  status: '',
  notes: '',
  amount: null,
  balance: null,
  source: 'synthetic.csv',
  sheet: 'Sheet1',
  row: 2,
  ...extra,
});

describe('RM project summaries', () => {
  it('keeps the RM project key and uses hyphens for unassigned internal owners', () => {
    const source = parseBytes(
      new TextEncoder().encode(
        'Company,Invoice No,Stage,Status,Invoice Notes\r\n[RM9991] Example rental company,RENT-TEST-01,,PAID,Test note',
      ),
      'synthetic-system.csv',
    );
    const records = extractRecords(
      source,
      {
        [source.sheets[0].name]: suggestMapping(source.sheets[0]),
      },
      'system',
    ).records;
    const results = reconcile([invoice()], records, {
      ...DEFAULT_SETTINGS,
      ap: [{ Name: 'Numeric project AP', Portfolio: '9000+', Include: '', Exclude: '' }],
      pm: { '9991': 'Numeric project PM' },
    });
    expect(buildSummary(results, 'internal')[0]).toMatchObject({
      'Project number': 'RM9991',
      'AP name': '-',
      'PM name': '-',
      Status: 'PAID',
    });
    const external = buildSummary(results, 'external')[0];
    expect(external).toMatchObject({ 'Project number': 'RM9991', Status: 'PAID' });
    expect(external).not.toHaveProperty('AP name');
    expect(external).not.toHaveProperty('PM name');
  });

  it('uses the same owner placeholders for missing, pending-review and manually confirmed RM rows', () => {
    const request = invoice({ project: 'RM9991' });
    const missing = buildSummary(reconcile([request], []), 'internal');
    const review = reconcile(
      [request],
      [
        invoice({ id: 'paid', project: 'RM9991', status: 'PAID' }),
        invoice({ id: 'pending', project: 'RM9991', stage: 'PM' }),
      ],
    );
    expect(review[0].resolution).toBe('review');
    const unresolved = buildSummary(review, 'internal');
    const confirmed = buildSummary(review, 'internal', { requested: ['paid', 'pending'] });
    for (const row of [...missing, ...unresolved, ...confirmed]) {
      expect(row['Project number']).toBe('RM9991');
      expect(row['AP name']).toBe('-');
      expect(row['PM name']).toBe('-');
    }
  });

  it('exports a literal hyphen in CSV and Excel while retaining formula protection', () => {
    const rows = buildSummary(
      reconcile([invoice()], [invoice({ id: 'system', project: 'RM9991', status: 'PAID' })]),
      'internal',
    );
    const csv = XLSX.read(summaryCSV(rows), { type: 'string', raw: true });
    const excel = XLSX.read(summaryWorkbook(rows, 'internal'), { type: 'array' });
    for (const book of [csv, excel]) {
      const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(
        book.Sheets[book.SheetNames[0]],
      );
      expect(row['Project number']).toBe('RM9991');
      expect(row['AP name']).toBe('-');
      expect(row['PM name']).toBe('-');
    }
    expect(safeCell('-')).toBe('-');
    expect(safeCell('-1+2')).toBe("'-1+2");
    expect(safeCell('=SUM(1,2)')).toBe("'=SUM(1,2)");
  });
});
