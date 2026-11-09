import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import { reconcile } from '../src/lib/matching';
import { extractRecords, parseBytes, suggestMapping } from '../src/lib/parser';
import { buildSummary } from '../src/lib/summary';
import type { InvoiceRecord } from '../src/lib/types';

it('imports the four downloadable templates and produces the documented payment summaries', async () => {
  const imported: Record<string, InvoiceRecord[]> = {};
  for (const extension of ['csv', 'xlsx'] as const) {
    for (const kind of ['statement', 'system'] as const) {
      const filename = `${kind}.${extension}`;
      const bytes = new Uint8Array(
        await readFile(new URL(`../public/templates/${filename}`, import.meta.url)),
      );
      const expectedHeaders =
        kind === 'statement'
          ? ['Invoices', 'Project number', 'Balance', 'Notes']
          : ['Invoice No', 'Company', 'Stage', 'Status', 'Invoice Notes'];

      // Inspect the actual artifact-tool XLSX files before the application's
      // mapping/extraction path, including their native cell types and formats.
      if (extension === 'xlsx') {
        const workbook = XLSX.read(bytes, { type: 'array', cellNF: true });
        expect(workbook.SheetNames).toEqual(['Data']);
        const sheet = workbook.Sheets.Data;
        expect(sheet.A2.t).toBe('s');
        expect(sheet.A2.v).toBe('000101');
        expect(sheet.A2.z).toBe('@');
        if (kind === 'statement') {
          expect(sheet.C2.t).toBe('n');
          expect(sheet.C2.v).toBe(125.5);
        }
      } else {
        expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      }

      const parsed = parseBytes(bytes, filename);
      expect(parsed.sheets).toHaveLength(1);
      const sheet = parsed.sheets[0];
      expect(sheet.rows[0]).toEqual(expectedHeaders);
      const mapping = suggestMapping(sheet);
      expect(mapping.headerRow).toBe(0);
      expect(mapping.invoice).toBe(0);
      if (kind === 'statement') {
        expect(mapping.project).toBe(1);
        expect(mapping.balance).toBe(2);
      } else {
        expect(mapping.company).toBe(1);
        expect(mapping.stage).toBe(2);
        expect(mapping.status).toBe(3);
      }
      const { records } = extractRecords(parsed, { [sheet.name]: mapping }, kind, {
        outstandingOnly: true,
        includeCreditNotes: false,
      });
      expect(records).toHaveLength(3);
      expect(records[0].invoice).toBe('000101');
      expect(records.map((record) => record.project)).toEqual(['1001', '1001', '1002']);
      imported[`${kind}.${extension}`] = records;
    }

    const results = reconcile(
      imported[`statement.${extension}`],
      imported[`system.${extension}`],
      DEFAULT_SETTINGS,
    );
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.resolution === 'matched')).toBe(true);
    const internal = buildSummary(results, 'internal');
    const external = buildSummary(results, 'external');
    expect(internal.map((row) => row.Status)).toEqual(['PAID', 'AP', 'SCAN']);
    expect(internal[0].Notes).toContain('Example payment reference');
    expect(internal[1].Notes).toContain('Example ready for payment');
    expect(external.map((row) => row.Status)).toEqual([
      'PAID',
      'Approved for payment',
      'Pending Approval',
    ]);
    expect(external.map((row) => row.Notes)).toEqual(['', '', 'Example: work order required']);
  }
});
