import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Check, ChevronDown, Settings2, LoaderCircle } from 'lucide-react';
import { extractRecords, mappingAtRow, readInput, suggestMapping } from '../lib';
import type { ColumnMapping, EncodingChoice, ExtractOptions, ParsedFile } from '../lib/types';
import { words, type Lang } from '../i18n';

export interface InputState {
  parsed: ParsedFile;
  mappings: Record<string, ColumnMapping>;
  included: string[];
  file?: File;
}
export const makeInput = (parsed: ParsedFile, file?: File): InputState => {
  const mappings = Object.fromEntries(parsed.sheets.map((s) => [s.name, suggestMapping(s)]));
  return {
    parsed,
    mappings,
    included: parsed.sheets.filter((s) => mappings[s.name].invoice >= 0).map((s) => s.name),
    file,
  };
};

export function recordsFrom(
  input: InputState | null,
  kind: 'statement' | 'system',
  options: ExtractOptions,
) {
  if (!input) return { records: [], warnings: [] };
  return extractRecords(
    { ...input.parsed, sheets: input.parsed.sheets.filter((s) => input.included.includes(s.name)) },
    input.mappings,
    kind,
    options,
  );
}

const fields: (keyof Omit<ColumnMapping, 'headerRow'>)[] = [
  'invoice',
  'project',
  'stage',
  'status',
  'notes',
  'company',
  'vendor',
  'amount',
  'balance',
];

export function UploadPanel({
  lang,
  kind,
  value,
  onChange,
  onError,
  options,
}: {
  lang: Lang;
  kind: 'statement' | 'system';
  value: InputState | null;
  onChange: (value: InputState) => void;
  onError: (message: string) => void;
  options: ExtractOptions;
}) {
  const t = words[lang],
    ref = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const [loading, setLoading] = useState(false),
    [dragging, setDragging] = useState(false),
    [open, setOpen] = useState(false),
    [sheetName, setSheetName] = useState(''),
    [encoding, setEncoding] = useState<EncodingChoice>('auto');
  const sheet = value?.parsed.sheets.find((s) => s.name === sheetName) || value?.parsed.sheets[0];
  const mapping = sheet && value?.mappings[sheet.name];
  const previewRows =
    sheet && mapping ? sheet.rows.slice(mapping.headerRow, mapping.headerRow + 5) : [];
  const columnCount = Math.max(1, ...previewRows.map((row) => row.length));
  const columnName = (index: number) => {
    let n = index + 1,
      label = '';
    while (n > 0) {
      n--;
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26);
    }
    return label;
  };
  const records = useMemo(() => recordsFrom(value, kind, options), [value, kind, options]);
  const upload = async (file?: File, enc: EncodingChoice = encoding) => {
    if (!file) return;
    if (!/\.(xlsx?|csv)$/i.test(file.name)) {
      onError(
        lang === 'en'
          ? 'Please choose an XLS, XLSX or CSV file.'
          : '请选择 XLS、XLSX 或 CSV 文件。',
      );
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      onError(lang === 'en' ? 'The file exceeds the 30 MB limit.' : '文件超过 30 MB 限制。');
      return;
    }
    const request = ++sequence.current;
    setLoading(true);
    try {
      const parsed = await readInput(file, enc);
      if (request !== sequence.current) return;
      const next = makeInput(parsed, file);
      onChange(next);
      setSheetName(next.included[0] || parsed.sheets[0]?.name || '');
      setOpen(next.included.length === 0);
    } catch (e) {
      if (request === sequence.current) onError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === sequence.current) {
        setLoading(false);
        if (ref.current) ref.current.value = '';
      }
    }
  };
  const update = (key: keyof ColumnMapping, n: number) => {
    if (!value || !sheet || !mapping) return;
    if (key === 'headerRow')
      n = Math.max(0, Math.min(sheet.rows.length - 1, Number.isFinite(n) ? Math.floor(n) : 0));
    let next = { ...mapping, [key]: n };
    if (key === 'headerRow') next = mappingAtRow(sheet, n);
    onChange({
      ...value,
      mappings: { ...value.mappings, [sheet.name]: next },
      included: value.included.includes(sheet.name)
        ? value.included
        : [...value.included, sheet.name],
    });
  };
  return (
    <section className={`card upload-card ${value ? 'loaded' : ''}`}>
      <div className="card-heading">
        <div className={`file-icon ${kind}`}>
          <FileSpreadsheet size={21} />
        </div>
        <div>
          <h3>{kind === 'statement' ? t.statement : t.system}</h3>
          <p>{kind === 'statement' ? t.statementSub : t.systemSub}</p>
        </div>
        <span className="number-label">{kind === 'statement' ? '01' : '02'}</span>
      </div>
      <input
        ref={ref}
        type="file"
        className="visually-hidden"
        accept=".xls,.xlsx,.csv"
        aria-label={kind === 'statement' ? t.statement : t.system}
        onChange={(e) => void upload(e.target.files?.[0])}
      />
      <button
        className={`drop-zone ${dragging ? 'dragging' : ''}`}
        disabled={loading}
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        }}
      >
        {loading ? (
          <LoaderCircle className="spin" size={26} />
        ) : value ? (
          <span className="file-success">
            <Check size={22} />
          </span>
        ) : (
          <span className="upload-icon">
            <Upload size={22} />
          </span>
        )}
        <strong>
          {loading
            ? lang === 'en'
              ? 'Reading spreadsheet…'
              : '正在读取表格…'
            : value
              ? value.parsed.name
              : t.drop}
        </strong>
        <span>
          {value
            ? `${records.records.length.toLocaleString()} ${t.rows} · ${value.included.length} ${t.sheets}`
            : t.browse}
        </span>
        <small>{value ? t.replace : t.formats}</small>
      </button>
      {value && (
        <>
          <div className="file-meta">
            <span className="status-dot" />
            {value.parsed.encoding}
            <button className="text-button" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Settings2 size={14} />
              {t.map}
              <ChevronDown className={open ? 'rotate' : ''} size={14} />
            </button>
          </div>
          {value.parsed.warnings.length > 0 && (
            <div className="notice compact">
              {value.parsed.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}
          {open && (
            <div className="mapping">
              <p className="muted">{t.mapHelp}</p>
              {/\.csv$/i.test(value.parsed.name) && (
                <label>
                  {t.encoding}
                  <select
                    value={encoding}
                    onChange={(e) => {
                      const enc = e.target.value as EncodingChoice;
                      setEncoding(enc);
                      void upload(value.file, enc);
                    }}
                    disabled={!value.file || loading}
                  >
                    <option value="auto">{t.automatic}</option>
                    <option value="utf-8">UTF-8</option>
                    <option value="macintosh">Mac Roman</option>
                    <option value="windows-1252">Windows-1252</option>
                    <option value="cp437">
                      {lang === 'en' ? 'MS-DOS CP437 (US)' : 'MS-DOS CP437（美国）'}
                    </option>
                    <option value="cp850">
                      {lang === 'en' ? 'MS-DOS CP850 (Western Europe)' : 'MS-DOS CP850（西欧）'}
                    </option>
                    <option value="gb18030">
                      {lang === 'en' ? 'GB18030 / GBK (Chinese)' : 'GB18030 / GBK（简体中文）'}
                    </option>
                    <option value="big5">Big5</option>
                  </select>
                </label>
              )}
              <div className="mapping-row">
                <label>
                  {t.sheet}
                  <select value={sheet?.name || ''} onChange={(e) => setSheetName(e.target.value)}>
                    {value.parsed.sheets.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                        {value.included.includes(s.name) ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t.header}
                  <input
                    type="number"
                    min={1}
                    max={sheet?.rows.length || 1}
                    value={(mapping?.headerRow || 0) + 1}
                    onChange={(e) => update('headerRow', Math.max(0, Number(e.target.value) - 1))}
                  />
                </label>
              </div>
              {sheet && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={value.included.includes(sheet.name)}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        included: e.target.checked
                          ? [...value.included, sheet.name]
                          : value.included.filter((n) => n !== sheet.name),
                      })
                    }
                  />
                  {sheet.name} {t.selected}
                </label>
              )}
              {value.parsed.sheets.length > 1 && (
                <button
                  className="text-button"
                  onClick={() =>
                    onChange({
                      ...value,
                      included: value.parsed.sheets
                        .filter((s) => value.mappings[s.name].invoice >= 0)
                        .map((s) => s.name),
                    })
                  }
                >
                  {t.allSheets}
                </button>
              )}
              {mapping && sheet && (
                <>
                  <div className="column-grid">
                    {fields
                      .filter(
                        (f) => kind === 'system' || !['stage', 'status', 'company'].includes(f),
                      )
                      .map((field) => (
                        <label key={field}>
                          {t[field]}
                          {field === 'invoice' ? ' *' : ''}
                          <select
                            value={mapping[field]}
                            onChange={(e) => update(field, Number(e.target.value))}
                          >
                            <option value={-1}>{t.unmapped}</option>
                            {Array.from(
                              {
                                length: Math.max(
                                  1,
                                  ...sheet.rows
                                    .slice(mapping.headerRow, mapping.headerRow + 9)
                                    .map((r) => r.length),
                                ),
                              },
                              (_, i) => (
                                <option key={i} value={i}>
                                  {columnName(i)} · {sheet.rows[mapping.headerRow]?.[i] || '—'}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                      ))}
                  </div>
                  <div className="preview-wrap">
                    <table className="preview-table">
                      <caption>{t.preview}</caption>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri}>
                            <th>{mapping.headerRow + ri + 1}</th>
                            {Array.from({ length: columnCount }, (_, i) => (
                              <td key={i} className={i === mapping.invoice ? 'mapped-cell' : ''}>
                                {row[i] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
