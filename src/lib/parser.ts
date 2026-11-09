import * as XLSX from 'xlsx';
import type {
  ColumnMapping,
  EncodingChoice,
  ExtractOptions,
  InvoiceRecord,
  ParsedFile,
  ParsedSheet,
} from './types';

const emptyMapping = (): ColumnMapping => ({
  headerRow: 0,
  invoice: -1,
  stage: -1,
  status: -1,
  notes: -1,
  project: -1,
  company: -1,
  amount: -1,
  balance: -1,
  vendor: -1,
});
const clean = (s: unknown) =>
  String(s ?? '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
const headerKey = (s: unknown) =>
  clean(s)
    .toLowerCase()
    .replace(/[\s_\-:#./()]+/g, '');
const aliases: Record<Exclude<keyof ColumnMapping, 'headerRow'>, string[]> = {
  invoice: [
    'invoices',
    'invoice',
    'invoiceno',
    'invoicenumber',
    'invno',
    'invnumber',
    'activity',
    '发票',
    '发票号码',
    '发票编号',
  ],
  stage: ['stage', 'workflowstage', '阶段'],
  status: ['status', 'paymentstatus', 'invoicestatus', '状态', '付款状态'],
  notes: ['invoicenotes', 'notes', 'note', 'comments', 'comment', '备注'],
  project: ['project', 'projectno', 'projectnumber', 'proj', 'projno', 'proj#', '项目', '项目编号'],
  company: ['company', 'property', 'propertyname', 'customer', '公司', '物业'],
  amount: ['invoiceamount', 'amount', 'originalamount', '金额', '发票金额'],
  balance: [
    'balancecad',
    'balance',
    'outstanding',
    'outstandingamount',
    'amountdue',
    'balancedue',
    '未付金额',
    '余额',
  ],
  vendor: ['vendor', 'vendorname', 'supplier', 'suppliername', '供应商'],
};

/** Decode each CSV independently. A Windows export and Mac export can coexist. */
export function decodeCSV(
  bytes: Uint8Array,
  choice: EncodingChoice = 'auto',
): { text: string; encoding: string; warnings: string[] } {
  if (choice !== 'auto')
    return {
      text: new TextDecoder(choice, { fatal: true }).decode(bytes),
      encoding: choice,
      warnings: [],
    };
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le', warnings: [] };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be', warnings: [] };
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      encoding: 'utf-8',
      warnings: [],
    };
  } catch {
    /* Legacy encodings need a separate fallback, without losing invalid bytes. */
  }
  const mac = new TextDecoder('macintosh').decode(bytes);
  const win = new TextDecoder('windows-1252').decode(bytes);
  // CA is NBSP in Mac Roman. Excel's Mac CSV exports commonly contain it between
  // invoice IDs and letter suffixes. Requiring this context avoids global guesses.
  const macSpace = (mac.match(/[\dA-Za-z]\u00a0[A-Za-z0-9]/g) ?? []).length;
  const macScore = macSpace * 8 - (mac.match(/[\uFFFD\u0000-\u0008]/g) ?? []).length * 20;
  const winScore = -(win.match(/[\uFFFD\u0080-\u009F]/g) ?? []).length * 20;
  const encoding = macScore > winScore ? 'macintosh' : 'windows-1252';
  return {
    text: encoding === 'macintosh' ? mac : win,
    encoding,
    warnings: [
      `Legacy CSV encoding detected: ${encoding}. Check the preview; choose another encoding if accents or spaces look wrong.`,
    ],
  };
}

export async function readInput(
  file: File,
  encoding: EncodingChoice = 'auto',
): Promise<ParsedFile> {
  if (!/\.(xlsx?|csv|tsv)$/i.test(file.name))
    throw new Error('Please select an XLS, XLSX, or CSV file.');
  if (file.size > 30 * 1024 * 1024)
    throw new Error('This file exceeds the 30 MB limit. Please split it into smaller files.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseBytes(bytes, file.name, encoding);
}

export function parseBytes(
  bytes: Uint8Array,
  name: string,
  choice: EncodingChoice = 'auto',
): ParsedFile {
  const isText = /\.(csv|tsv)$/i.test(name);
  const decoded = isText ? decodeCSV(bytes, choice) : null;
  const workbook = decoded
    ? XLSX.read(decoded.text, { type: 'string', raw: true, cellFormula: false, dense: true })
    : XLSX.read(bytes, { type: 'array', cellText: true, cellFormula: false, dense: true });
  const sheets = workbook.SheetNames.map((sheetName) => ({
    name: sheetName,
    rows: XLSX.utils
      .sheet_to_json<
        string[]
      >(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '', blankrows: true })
      .map((row) => row.map((v) => String(v ?? ''))),
  }));
  if (!sheets.some((s) => s.rows.some((r) => r.some((v) => v.trim()))))
    throw new Error('The selected file has no readable rows.');
  return {
    name,
    sheets,
    encoding: decoded?.encoding ?? 'Excel workbook',
    warnings: decoded?.warnings ?? [],
  };
}

export function suggestMapping(sheet: ParsedSheet): ColumnMapping {
  let best = emptyMapping();
  let bestScore = -1;
  for (let index = 0; index < Math.min(sheet.rows.length, 100); index++) {
    const suggestion = mappingAtRow(sheet, index);
    const score =
      (suggestion.invoice >= 0 ? 10 : 0) +
      Object.entries(suggestion).filter(
        ([key, value]) => key !== 'headerRow' && key !== 'invoice' && value >= 0,
      ).length;
    if (score > bestScore) {
      best = suggestion;
      bestScore = score;
    }
  }
  return best;
}

export function mappingAtRow(sheet: ParsedSheet, headerRow: number): ColumnMapping {
  const result = { ...emptyMapping(), headerRow };
  const row = sheet.rows[headerRow] ?? [];
  for (const [field, names] of Object.entries(aliases)) {
    result[field as keyof typeof aliases] = row.findIndex((v) =>
      names.map(headerKey).includes(headerKey(v)),
    );
  }
  return result;
}

export function parseAmount(value: string): number | null {
  const s = clean(value);
  if (!s) return null;
  const numeric = s.replace(/[,$£€¥\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d*(?:\.\d+)?$/.test(numeric) || !/\d/.test(numeric)) return null;
  const n = Number(numeric);
  return Number.isFinite(n) ? n : null;
}

function projectFrom(value: string): string {
  const text = clean(value);
  return (
    text.match(/^\[([^\]]+)\]/)?.[1] ??
    text.match(/\[([^\]]+)\]\.?$/)?.[1] ??
    text.match(/^((?:RM)?\d{4,}(?:-[A-Za-z0-9]+)?)(?:\s|$)/i)?.[1] ??
    ''
  );
}

export function extractRecords(
  file: ParsedFile,
  mappings: Record<string, ColumnMapping>,
  kind: 'statement' | 'system',
  options: ExtractOptions = { outstandingOnly: true, includeCreditNotes: false },
): { records: InvoiceRecord[]; warnings: string[] } {
  const records: InvoiceRecord[] = [];
  const warnings = [...file.warnings];
  let skippedSettled = 0,
    skippedCredit = 0,
    skippedNonInvoice = 0;
  for (const sheet of file.sheets) {
    const mapping = mappings[sheet.name];
    if (!mapping) continue;
    if (mapping.invoice < 0) {
      warnings.push(`${sheet.name}: select an invoice column before running.`);
      continue;
    }
    const header = sheet.rows[mapping.headerRow] ?? [];
    const activityColumn = headerKey(header[mapping.invoice]) === 'activity';
    let contextProject = '';
    let contextCompany = '';
    for (let index = mapping.headerRow + 1; index < sheet.rows.length; index++) {
      const row = sheet.rows[index];
      const get = (column: number) => (column < 0 ? '' : clean(row[column]));
      let invoice = get(mapping.invoice);
      const project = get(mapping.project);
      const company = get(mapping.company);
      const groupHeading =
        /^(?:project|property|customer|company|项目|物业)(?:\s*(?:#|no\.?|number|:|：)\s*|\s+)/i.test(
          invoice,
        );
      // Only explicit group headings establish a carry-forward context. A blank
      // project on a normal invoice row is unknown, not the previous row's project.
      if (kind === 'statement' && (!invoice || groupHeading)) {
        if (project) contextProject = projectFrom(project) || project;
        else if (groupHeading) {
          const headingValue = invoice.replace(
            /^(?:project|property|customer|company|项目|物业)\s*(?:#|no\.?|number|:|：)?\s*/i,
            '',
          );
          const headingProject = projectFrom(headingValue);
          if (headingProject) contextProject = headingProject;
        }
        if (company) contextCompany = company;
      }
      if (kind === 'statement' && groupHeading) continue;
      if (!invoice || /^(?:nan|none|null)$/i.test(invoice)) continue;
      if (aliases.invoice.map(headerKey).includes(headerKey(invoice))) continue;
      const labelled = invoice.match(
        /^\s*(invoice|credit\s*note|credit\s*memo)\s*(?:#|no\.?|number)?\s*[:#]?\s+(.+)$/i,
      );
      const balance = parseAmount(get(mapping.balance));
      const amount = parseAmount(get(mapping.amount));
      // A CN-looking identifier is still an identifier. Only a credit label or
      // negative mapped financial value establishes that the row is a credit.
      const credit =
        /^(?:credit\s*note|credit\s*memo)/i.test(invoice) ||
        (balance !== null && balance < 0) ||
        (amount !== null && amount < 0);
      if (activityColumn && !labelled) {
        skippedNonInvoice++;
        continue;
      }
      if (
        /^(?:grand\s+)?total\b|^balance\s+due\b|^statement\b|^payment\s+advice\b|^overpayment\b|^thank\s+you\b/i.test(
          invoice,
        )
      ) {
        skippedNonInvoice++;
        continue;
      }
      if (labelled) invoice = clean(labelled[2]);
      if (kind === 'statement' && credit && !options.includeCreditNotes) {
        skippedCredit++;
        continue;
      }
      if (
        kind === 'statement' &&
        options.outstandingOnly &&
        balance !== null &&
        (balance === 0 || (balance < 0 && !options.includeCreditNotes))
      ) {
        skippedSettled++;
        continue;
      }
      records.push({
        id: `${file.name}:${sheet.name}:${index + 1}`,
        invoice,
        stage: get(mapping.stage),
        status: get(mapping.status),
        notes: get(mapping.notes),
        project:
          projectFrom(project) ||
          project ||
          projectFrom(company) ||
          projectFrom(invoice) ||
          (kind === 'statement' ? contextProject : ''),
        company: company || (kind === 'statement' ? contextCompany : ''),
        vendor: get(mapping.vendor),
        amount,
        balance,
        sheet: sheet.name,
        row: index + 1,
        source: file.name,
      });
    }
  }
  if (skippedSettled)
    warnings.push(`${skippedSettled} settled or non-positive balance rows excluded.`);
  if (skippedCredit)
    warnings.push(
      `${skippedCredit} credit-note rows excluded. Enable credit notes to include them.`,
    );
  if (skippedNonInvoice)
    warnings.push(`${skippedNonInvoice} subtotal, payment, or non-invoice rows excluded.`);
  if (!records.length)
    warnings.push(
      'No invoice rows were extracted. Check the selected sheets, header row, column mapping, and balance filters.',
    );
  return { records, warnings };
}
