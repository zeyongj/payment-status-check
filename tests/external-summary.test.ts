import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { reconcile } from '../src/lib/matching';
import { buildSummary, summaryCSV, summaryWorkbook } from '../src/lib/summary';
import type { InvoiceRecord } from '../src/lib/types';

const record = (
  id: string,
  invoice: string,
  extra: Partial<InvoiceRecord> = {},
): InvoiceRecord => ({
  id,
  invoice,
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

it('omits the project column from every external result and export while preserving internal detail', () => {
  const results = reconcile(
    [
      record('scan', '000101', { project: '1001', notes: 'Private statement note' }),
      record('missing', 'MISSING-TEST', { project: '1002' }),
      record('split', 'SPLIT-TEST'),
    ],
    [
      record('scan-source', '000101', {
        project: '1001',
        stage: 'SCAN',
        notes: 'Please provide the work order.',
      }),
      record('split-paid', 'SPLIT-TEST [1003]', { project: '1003', status: 'PAID' }),
      record('split-pending', 'SPLIT-TEST [1004]', { project: '1004', stage: 'PM' }),
    ],
  );
  const internal = buildSummary(results, 'internal');
  expect(Object.keys(internal[0]).slice(0, 4)).toEqual([
    'Invoice',
    'Project number',
    'Status',
    'Notes',
  ]);
  expect(internal[0]).toMatchObject({ 'Project number': '1001', Status: 'SCAN' });
  expect(internal[0].Notes).toContain('Private statement note');

  const automatic = buildSummary(results, 'external');
  expect(automatic.map((row) => row.Status)).toEqual([
    'Pending Approval',
    'Missing',
    'Needs review',
  ]);
  const reviewed = buildSummary(results, 'external', { split: ['split-paid', 'split-pending'] });
  expect(reviewed).toEqual([
    { Invoice: '000101', Status: 'Pending Approval', Notes: 'Please provide the work order.' },
    { Invoice: 'MISSING-TEST', Status: 'Missing', Notes: '' },
    { Invoice: 'SPLIT-TEST', Status: 'PAID', Notes: '' },
    { Invoice: 'SPLIT-TEST', Status: 'Pending Approval', Notes: '' },
  ]);
  for (const rows of [automatic, reviewed]) {
    expect(rows.every((row) => Object.keys(row).join(',') === 'Invoice,Status,Notes')).toBe(true);
    const csv = XLSX.read(new TextEncoder().encode(summaryCSV(rows)), { type: 'array', raw: true });
    const excel = XLSX.read(summaryWorkbook(rows, 'external'), { type: 'array' });
    for (const workbook of [csv, excel]) {
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
      expect(data[0]).toEqual(['Invoice', 'Status', 'Notes']);
      expect(data).toHaveLength(rows.length + 1);
    }
  }
});
