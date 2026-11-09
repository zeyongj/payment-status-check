import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { assignAP, DEFAULT_SETTINGS } from './defaults';
import { decodeCSV, extractRecords, parseBytes, suggestMapping } from './parser';
import { compileTemplate, editDistance, normalizeInvoice, reconcile } from './matching';
import { buildSummary, externalStatus, summaryCSV, summaryWorkbook } from './summary';
import type { InvoiceRecord, MatchSettings, ParsedFile } from './types';

const record = (invoice: string, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: invoice,
  invoice,
  stage: '',
  status: '',
  notes: '',
  project: '',
  company: '',
  vendor: '',
  amount: null,
  balance: null,
  sheet: 'Sheet1',
  row: 2,
  source: 'test.csv',
  ...extra,
});
const settings = (extra: Partial<MatchSettings> = {}): MatchSettings => ({
  ...DEFAULT_SETTINGS,
  ...extra,
});

describe('CSV and Excel ingestion', () => {
  it('handles Mac NBSP without silently creating Ê and permits encoding override', () => {
    const bytes = Uint8Array.from([...new TextEncoder().encode('Invoices\r\nTEST-42'), 0xca, 65]);
    expect(decodeCSV(bytes).encoding).toBe('macintosh');
    expect(decodeCSV(bytes).text).toContain('TEST-42\u00a0A');
    expect(decodeCSV(bytes, 'windows-1252').text).toContain('TEST-42ÊA');
    expect(parseBytes(bytes, 'invoices.csv').sheets[0].rows[1][0]).toBe('TEST-42\u00a0A');
  });
  it('decodes MS-DOS CP437 accents and box characters without changing ASCII CSV structure', () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('Invoice No,Invoice Notes\r\n000012,"Caf'),
      0x82,
      ...new TextEncoder().encode(', '),
      0xb3,
      0xc4,
      0xda,
      ...new TextEncoder().encode('\r\nsecond line"'),
    ]);
    expect(decodeCSV(bytes, 'cp437').text).toContain('Café, │─┌\r\nsecond line');
    const file = parseBytes(bytes, 'dos.csv', 'cp437');
    const extracted = extractRecords(file, { Sheet1: suggestMapping(file.sheets[0]) }, 'system');
    expect(file.encoding).toBe('cp437');
    expect(extracted.records[0].invoice).toBe('000012');
    expect(extracted.records[0].notes.replace(/\r\n/g, '\n')).toBe('Café, │─┌\nsecond line');
  });
  it('distinguishes CP850 from CP437 and never guesses DOS from ambiguous legacy bytes', () => {
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('Invoice No,Invoice Notes\r\n000012,"'),
      0x82,
      0x9b,
      ...new TextEncoder().encode('"'),
    ]);
    const file = parseBytes(bytes, 'dos.csv', 'cp850');
    expect(file.sheets[0].rows[1]).toEqual(['000012', 'éø']);
    expect(decodeCSV(bytes, 'cp437').text).toContain('é¢');
    const automatic = decodeCSV(bytes);
    expect(automatic.encoding).toBe('windows-1252');
    expect(automatic.warnings.join(' ')).toContain('uncertain');
    expect(automatic.warnings.join(' ')).toContain('CP437 or CP850');
  });
  it('keeps every ASCII byte and OEM terminal character across decoder chunk boundaries', () => {
    const ascii = Uint8Array.from({ length: 128 }, (_, index) => index);
    const asciiText = String.fromCharCode(...ascii);
    for (const encoding of ['cp437', 'cp850'] as const) {
      expect(decodeCSV(ascii, encoding).text).toBe(asciiText);
      const bytes = new Uint8Array(8194).fill(65);
      bytes[8191] = 0x82;
      bytes[8192] = 0xff;
      bytes[8193] = 0xfd;
      expect(decodeCSV(bytes, encoding).text.slice(-3)).toBe('é\u00a0²');
    }
  });
  it('preserves CSV leading zeros and quoted multiline notes', () => {
    const text = 'Invoice No,Invoice Notes,Status\r\n000012,"first\nsecond",PAID';
    const file = parseBytes(new TextEncoder().encode(text), 'example.csv');
    const extracted = extractRecords(file, { Sheet1: suggestMapping(file.sheets[0]) }, 'system');
    expect(extracted.records[0].invoice).toBe('000012');
    expect(extracted.records[0].notes).toBe('first\nsecond');
  });
  it.each(['xlsx', 'xls'] as const)('reads %s workbooks and every worksheet', (bookType) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Invoice No', 'Status'],
        ['OA-0001', 'PAID'],
      ]),
      'First',
    );
    const sheet = XLSX.utils.aoa_to_sheet([['Invoices'], [12]]);
    sheet.A2.z = '000000';
    XLSX.utils.book_append_sheet(wb, sheet, 'Second');
    const bytes = XLSX.write(wb, { type: 'array', bookType });
    const file = parseBytes(new Uint8Array(bytes), `example.${bookType}`);
    expect(file.sheets).toHaveLength(2);
    expect(file.sheets[0].rows[1][0]).toBe('OA-0001');
    expect(file.sheets[1].rows[1][0]).toBe('000012');
  });
  it('extracts statement activities with repeated headers, excludes totals, credits and settled rows', () => {
    const file: ParsedFile = {
      name: 'statement.xlsx',
      encoding: 'Excel',
      warnings: [],
      sheets: [
        {
          name: 'Table 1',
          rows: [
            ['Statement'],
            ['Date', 'Activity', 'Balance CAD'],
            ['2026-01-01', 'Invoice\u00a0#\u00a00001', '10'],
            ['Date', 'Activity', 'Balance CAD'],
            ['', 'Overpayment', '-3'],
            ['', 'Credit Note # CN-0002', '-2'],
            ['', 'Invoice # 0003', '0'],
            ['', 'Invoice # 0004', '4'],
            ['', 'TOTAL', '9'],
          ],
        },
      ],
    };
    const mapping = suggestMapping(file.sheets[0]);
    expect(mapping.headerRow).toBe(1);
    expect(
      extractRecords(file, { 'Table 1': mapping }, 'statement').records.map((r) => r.invoice),
    ).toEqual(['0001', '0004']);
    expect(
      extractRecords(file, { 'Table 1': mapping }, 'statement', {
        outstandingOnly: true,
        includeCreditNotes: true,
      }).records.map((r) => r.invoice),
    ).toEqual(['0001', 'CN-0002', '0004']);
  });
  it('does not carry a previous invoice project into a split invoice with an unknown project', () => {
    const file: ParsedFile = {
      name: 'statement.csv',
      encoding: 'utf-8',
      warnings: [],
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['Invoices', 'Project'],
            ['DEMO001', '5500'],
            ['DEMO003', ''],
          ],
        },
      ],
    };
    const extracted = extractRecords(file, { Sheet1: suggestMapping(file.sheets[0]) }, 'statement');
    expect(extracted.records.map((r) => r.project)).toEqual(['5500', '']);
    const results = reconcile(extracted.records, [
      record('DEMO003 [5500]', { project: '5500', status: 'PAID' }),
      record('DEMO003 [5501]', { project: '5501', stage: 'PM' }),
    ]);
    expect(results[1].resolution).toBe('review');
    expect(results[1].candidates.map((c) => c.record.project)).toEqual(['5500', '5501']);
  });
  it('carries an explicit project-only group heading into its invoice rows', () => {
    const file: ParsedFile = {
      name: 'statement.csv',
      encoding: 'utf-8',
      warnings: [],
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['Invoices', 'Project'],
            ['', '5500'],
            ['DEMO001', ''],
            ['Project: 5501', ''],
            ['DEMO002', ''],
          ],
        },
      ],
    };
    const extracted = extractRecords(file, { Sheet1: suggestMapping(file.sheets[0]) }, 'statement');
    expect(extracted.records.map((r) => [r.invoice, r.project])).toEqual([
      ['DEMO001', '5500'],
      ['DEMO002', '5501'],
    ]);
  });
  it('preserves CN-looking identifiers in a prepared invoice list and filters only evidenced credits', () => {
    const file: ParsedFile = {
      name: 'prepared.csv',
      encoding: 'utf-8',
      warnings: [],
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['Invoices', 'Amount'],
            ['CN123', ''],
            ['TEST-CN', ''],
            ['Credit Note # CN456', ''],
            ['CN789', '-10'],
            ['INV-001', '20'],
          ],
        },
      ],
    };
    const mapping = { Sheet1: suggestMapping(file.sheets[0]) };
    const defaults = extractRecords(file, mapping, 'statement');
    expect(defaults.records.map((r) => r.invoice)).toEqual(['CN123', 'TEST-CN', 'INV-001']);
    const withCredits = extractRecords(file, mapping, 'statement', {
      outstandingOnly: true,
      includeCreditNotes: true,
    });
    expect(withCredits.records.map((r) => r.invoice)).toEqual([
      'CN123',
      'TEST-CN',
      'CN456',
      'CN789',
      'INV-001',
    ]);
  });
});

describe('reconciliation and audit', () => {
  it('normalizes Unicode spaces/dashes/trailing dot without dropping zeros or internal hyphens', () => {
    expect(normalizeInvoice('\u200b OA–0001. ')).toBe('OA-0001');
    expect(normalizeInvoice('00123.0')).toBe('00123');
    expect(normalizeInvoice('nan')).toBe('');
  });
  it('keeps cross-project duplicates for review instead of allowing paid to win', () => {
    const results = reconcile(
      [record('INV-TEST7')],
      [
        record('INV-TEST7', { id: 'a', project: '200', status: 'PAID', notes: 'paid note' }),
        record('INV-TEST7.', { id: 'b', project: '201', stage: 'SRPM', notes: 'approval note' }),
      ],
    );
    expect(results[0].resolution).toBe('review');
    expect(results[0].candidates).toHaveLength(2);
    expect(buildSummary(results, 'external')[0].Status).toBe('Needs review');
    const internalReview = buildSummary(results, 'internal')[0];
    expect(internalReview.Notes).toContain('Unconfirmed candidate INV-TEST7; project 200');
    expect(internalReview.Notes).toContain('paid note');
    expect(internalReview.Notes).toContain('approval note');
    expect(buildSummary(results, 'external')[0].Notes).toBe('');
    expect(buildSummary(results, 'internal', { 'INV-TEST7': [] })[0].Notes).toContain(
      'Rejected candidate',
    );
    const reviewed = buildSummary(results, 'internal', { 'INV-TEST7': ['a', 'b'] });
    expect(reviewed.map((r) => r.Status)).toEqual(['PAID', 'SRPM']);
    expect(reviewed.map((r) => r.Notes)).toEqual(['paid note', 'approval note']);
  });
  it('retains split project components and flags mixed statuses', () => {
    const result = reconcile(
      [record('SPLIT-TEST')],
      [
        record('SPLIT-TEST[201]', { project: '201', status: 'PAID' }),
        record('SPLIT-TEST [202]', { project: '202', stage: 'PM' }),
      ],
    )[0];
    expect(result.method).toBe('project-suffix');
    expect(result.resolution).toBe('review');
    expect(result.candidates).toHaveLength(2);
  });
  it('includes suffixed split components even when an exact parent invoice exists', () => {
    const source = [
      record('INV-A', { project: '100', status: 'PAID' }),
      record('INV-A [101]', { project: '101', stage: 'PM' }),
    ];
    const result = reconcile([record('INV-A')], source)[0];
    expect(result.method).toBe('project-suffix');
    expect(result.resolution).toBe('review');
    expect(result.candidates.map((candidate) => candidate.record.project)).toEqual(['100', '101']);
    const constrained = reconcile([record('INV-A', { project: '100' })], source)[0];
    expect(constrained.resolution).toBe('matched');
    expect(constrained.candidates.map((candidate) => candidate.record.project)).toEqual(['100']);
    const suffixOnlyContext = reconcile(
      [record('INV-A', { project: '100' })],
      [source[0], record('INV-A [101]', { stage: 'PM' })],
    )[0];
    expect(suffixOnlyContext.candidates).toHaveLength(1);
    const conflictingSource = reconcile(
      [record('INV-A')],
      [record('INV-A [100]', { project: '101', status: 'PAID' })],
    )[0];
    expect(conflictingSource.resolution).toBe('review');
  });
  it('honors a request project and custom AP/PM ownership', () => {
    const result = reconcile(
      [record('123', { project: '120' })],
      [
        record('123', { id: 'a', project: '120', status: 'APPROVED' }),
        record('123', { id: 'b', project: '220', status: 'PAID' }),
      ],
      settings({
        ap: [{ Name: 'Assigned AP', Portfolio: '120', Include: '', Exclude: '' }],
        pm: { '120': 'Assigned PM' },
      }),
    );
    const summary = buildSummary(result, 'internal')[0];
    expect(summary.Status).toBe('APPROVED');
    expect(summary['AP name']).toBe('Assigned AP');
    expect(summary['PM name']).toBe('Assigned PM');
  });
  it('does not confuse a matched blank status with an absent invoice', () => {
    const rows = buildSummary(reconcile([record('a'), record('b')], [record('a')]), 'external');
    expect(rows.map((r) => r.Status)).toEqual(['Unknown', 'Missing']);
  });
  it('matches literal custom templates without evaluating regular expressions', () => {
    const results = reconcile(
      [record('OA-0001')],
      [record('COPY+OA-0001 (310)', { project: '310', status: 'PAID' })],
      settings({ customTemplate: 'COPY+{invoice} ({project})' }),
    );
    expect(results[0].method).toBe('custom-template');
    expect(results[0].resolution).toBe('matched');
    expect(() => compileTemplate('{invoice}{invoice}')).toThrow();
  });
  it('keeps tied fuzzy alternatives for review', () => {
    const results = reconcile(
      [record('1234567')],
      [record('1234568', { status: 'PAID' }), record('1234569', { stage: 'SCAN' })],
      settings({ fuzzyThreshold: 80, autoAcceptFuzzy: true }),
    );
    expect(results[0].method).toBe('fuzzy');
    expect(results[0].resolution).toBe('review');
    expect(results[0].candidates).toHaveLength(2);
    expect(buildSummary(results, 'external', { '1234567': [] })[0].Status).toBe('Missing');
    expect(editDistance('kitten', 'sitting', 3)).toBe(3);
  });
  it('requires a unique best fuzzy key even when the runner-up margin is zero', () => {
    const result = reconcile(
      [record('FUZZY-100')],
      [
        record('FUZZY-101', { project: '100', status: 'PAID' }),
        record('FUZZY-102', { project: '100', status: 'PAID' }),
      ],
      settings({ fuzzyThreshold: 80, fuzzyMargin: 0, autoAcceptFuzzy: true }),
    )[0];
    expect(result.method).toBe('fuzzy');
    expect(result.resolution).toBe('review');
    expect(result.candidates).toHaveLength(2);
    expect(result.accepted).toHaveLength(0);
  });
  it('checks the fuzzy runner-up even when it is below the acceptance threshold', () => {
    const invoice = '1234567890123456789012345';
    const near = '1234567890123456789012346';
    const next = '1234567890123456789012356';
    const result = reconcile(
      [record(invoice)],
      [record(near, { status: 'PAID' }), record(next, { status: 'PAID' })],
      settings({ fuzzyThreshold: 96, fuzzyMargin: 5, autoAcceptFuzzy: true }),
    )[0];
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].score).toBe(96);
    expect(result.resolution).toBe('review');
  });
  it('constrains custom project captures and rejects project/suffix conflicts', () => {
    const matched = reconcile(
      [record('COPY+OA-0001 (310)')],
      [record('COPY+OA-0001 (311)', { project: '311', status: 'PAID' })],
      settings({ fuzzy: false, customTemplate: 'COPY+{invoice} ({project})' }),
    );
    expect(matched[0].resolution).toBe('missing');
    const conflict = reconcile(
      [record('OA-0001')],
      [record('OA-0001 [310]', { project: '311', status: 'PAID' })],
      settings({ fuzzy: false }),
    );
    expect(conflict[0].resolution).toBe('review');
  });
  it('assigns explicit AP includes before ranges and preserves assignment gaps', () => {
    const rules = [
      { Name: 'AP North', Portfolio: '100-199', Include: '250', Exclude: '150' },
      { Name: 'AP South', Portfolio: '200-299', Include: '150', Exclude: '250' },
    ];
    expect(assignAP('250', rules)).toBe('AP North');
    expect(assignAP('150', rules)).toBe('AP South');
    expect(assignAP('120', rules)).toBe('AP North');
    expect(assignAP('350', rules)).toBe('');
    expect(assignAP('RM9999', rules)).toBe('');
    expect(assignAP('120')).toBe('');
  });
});

describe('internal and external summaries', () => {
  it('maps requested external statuses and retains only SCAN notes externally', () => {
    const source = [
      record('a', { stage: 'AP', notes: 'internal' }),
      record('b', { stage: 'SITE A', notes: 'internal' }),
      record('c', { stage: 'SCAN', notes: 'Please supply detail' }),
      record('d', { status: 'IN-PAYABLE', notes: 'internal' }),
    ];
    const result = reconcile(
      source.map((r) => record(r.invoice)),
      source,
    );
    expect(buildSummary(result, 'external').map((r) => [r.Status, r.Notes])).toEqual([
      ['Approved for payment', ''],
      ['Pending Approval', ''],
      ['Pending Approval', 'Please supply detail'],
      ['IN-PAYABLE', ''],
    ]);
    expect(buildSummary(result, 'internal').every((r) => r.Notes)).toBe(true);
    expect(externalStatus('APPROVED')).toBe('Approved for payment');
  });
  it('exports UTF-8 BOM CSV, guards formulas, and round-trips XLSX as strings', () => {
    const rows = [{ Invoice: '00001', Status: 'PAID', Notes: '=HYPERLINK("malicious")' }];
    const csv = summaryCSV(rows);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=HYPERLINK");
    const wb = XLSX.read(summaryWorkbook(rows, 'internal'), { type: 'array' });
    expect(wb.Sheets['Internal summary'].A2.v).toBe('00001');
    expect(wb.Sheets['Internal summary'].C2.f).toBeUndefined();
    expect(wb.Sheets['Internal summary'].C2.v).toContain("'=HYPERLINK");
  });
});
