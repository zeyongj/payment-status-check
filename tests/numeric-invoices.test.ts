import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { reconcile } from '../src/lib/matching';
import { extractRecords, parseBytes, suggestMapping } from '../src/lib/parser';
import { buildSummary, summaryCSV, summaryWorkbook } from '../src/lib/summary';

type Format = 'csv' | 'xlsx' | 'xls';

function importRows(rows: string[][], format: Format, kind: 'statement' | 'system') {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  const bytes =
    format === 'csv'
      ? new TextEncoder().encode(XLSX.utils.sheet_to_csv(sheet))
      : new Uint8Array(XLSX.write(book, { type: 'array', bookType: format }));
  const file = parseBytes(bytes, `synthetic-${kind}.${format}`);
  return extractRecords(file, { Sheet1: suggestMapping(file.sheets[0]) }, kind).records;
}

describe('numeric invoice project detection', () => {
  it.each([
    ['csv', 'csv'],
    ['csv', 'xls'],
    ['xlsx', 'csv'],
    ['xlsx', 'xls'],
  ] as const)(
    'reconciles a %s statement with a %s system export without inventing projects',
    (statementFormat, systemFormat) => {
      const expected = [
        ['81001', 'PM'],
        ['81002', 'AP'],
        ['81003', 'SITE B'],
        ['81004', 'IN-PAYABLE'],
        ['81005', 'STRATA'],
        ['81006', 'SCAN'],
        ['81007', 'PAID'],
        ['000081008', 'AP'],
        ['81-009', 'AP'],
        ['81010', 'Missing'],
        ['81011 [9102]', 'AP'],
      ];
      const requests = importRows(
        [['Invoices'], ...expected.map(([invoice]) => [invoice])],
        statementFormat,
        'statement',
      );
      const source = importRows(
        [
          ['Company', 'Invoice No', 'Stage', 'Status', 'Invoice Notes'],
          ...expected
            .filter(([, status]) => status !== 'Missing')
            .map(([invoice, status]) => [
              ['81007', '81-009'].includes(invoice)
                ? ''
                : `[${invoice.includes('[9102]') ? '9102' : '9101'}] Example property`,
              invoice === '81002' ? '81002.' : invoice,
              status === 'PAID' ? '' : status,
              status === 'PAID' ? status : '',
              status === 'SCAN' ? 'Synthetic work order note' : '',
            ]),
        ],
        systemFormat,
        'system',
      );
      expect(requests.map((row) => row.project)).toEqual([
        ...expected.slice(0, -1).map(() => ''),
        '9102',
      ]);
      expect(source.find((row) => row.invoice === '81-009')?.project).toBe('');
      expect(source.find((row) => row.invoice === '81007')?.project).toBe('');
      const results = reconcile(requests, source);
      expect(results.map((row) => [row.request.invoice, row.status])).toEqual(expected);
      expect(results.filter((row) => row.resolution === 'missing')).toHaveLength(1);
      const internal = buildSummary(results, 'internal');
      expect(internal.find((row) => row.Invoice === '81001')?.['Project number']).toBe('9101');
      expect(internal.find((row) => row.Invoice === '81006')?.Notes).toBe(
        'Synthetic work order note',
      );
      for (const book of [
        XLSX.read(new TextEncoder().encode(summaryCSV(internal)), { type: 'array', raw: true }),
        XLSX.read(summaryWorkbook(internal, 'internal'), { type: 'array' }),
      ]) {
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
          book.Sheets[book.SheetNames[0]],
          { defval: '' },
        );
        expect(rows.map((row) => [row.Invoice, row.Status])).toEqual(expected);
        expect(rows.find((row) => row.Invoice === '81006')?.Notes).toBe(
          'Synthetic work order note',
        );
      }
    },
  );

  it('uses only explicit invoice suffixes while retaining mapped projects, company codes and group headings', () => {
    const records = importRows(
      [
        ['Invoices', 'Project', 'Company'],
        ['90001', '', ''],
        ['90002.', '', ''],
        ['90003 2', '', ''],
        ['RM9991', '', ''],
        ['90004 [RM9992].', '', ''],
        ['90005', '9103', ''],
        ['90006', '', '[RM9994] Example company'],
        ['90007', '', '9105 Example company'],
        ['Project: 9104', '', ''],
        ['90008', '', ''],
      ],
      'csv',
      'statement',
    );
    expect(records.map((row) => [row.invoice, row.project])).toEqual([
      ['90001', ''],
      ['90002.', ''],
      ['90003 2', ''],
      ['RM9991', ''],
      ['90004 [RM9992].', 'RM9992'],
      ['90005', '9103'],
      ['90006', 'RM9994'],
      ['90007', '9105'],
      ['90008', '9104'],
    ]);
    const source = importRows(
      [
        ['Invoice No', 'Company', 'Status'],
        ['90005', '[9106] Different property', 'PAID'],
      ],
      'csv',
      'system',
    );
    expect(reconcile([records.find((row) => row.invoice === '90005')!], source)[0].resolution).toBe(
      'missing',
    );
  });
});
