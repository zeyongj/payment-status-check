import { useId, useState, type KeyboardEvent } from 'react';
import { Download, FileSpreadsheet, Info } from 'lucide-react';
import type { Lang } from '../i18n';
import samples from '../lib/template-samples.json' with { type: 'json' };

type TemplateKind = 'statement' | 'system';
type Field = { column: string; required: boolean; en: string; zh: string };
const schema: Record<TemplateKind, Field[]> = {
  statement: [
    {
      column: 'Invoices',
      required: true,
      en: 'One invoice number per row. Keep identifiers as text.',
      zh: '每行填写一个发票号码，号码按文本保存。',
    },
    {
      column: 'Project number',
      required: false,
      en: 'Helps distinguish the same invoice across projects.',
      zh: '用于区分不同项目中重复的发票号码。',
    },
    {
      column: 'Balance',
      required: false,
      en: 'Outstanding amount. Positive rows are included by the default filter.',
      zh: '未结金额。默认筛选包含正余额记录。',
    },
    {
      column: 'Notes',
      required: false,
      en: 'Your statement notes for reference.',
      zh: '供核对时参考的对账单备注。',
    },
  ],
  system: [
    {
      column: 'Invoice No',
      required: true,
      en: 'Invoice number as recorded in the system. Project suffixes are supported.',
      zh: '系统中的发票号码，支持附加项目编号后缀。',
    },
    {
      column: 'Company',
      required: false,
      en: 'Project text such as [1001] Example building A. A separate Project number column also works.',
      zh: '项目文字，例如 [1001] Example building A；也可使用单独的 Project number 列。',
    },
    {
      column: 'Stage',
      required: false,
      en: 'Workflow stage. Takes priority over Status when both are present.',
      zh: '审批阶段；同时存在 Stage 和 Status 时，优先使用 Stage。',
    },
    {
      column: 'Status',
      required: false,
      en: 'Used when Stage is blank. Map at least one of Stage or Status for meaningful payment results.',
      zh: 'Stage 为空时使用。建议至少提供 Stage 或 Status 其中一列以获得有效付款状态。',
    },
    {
      column: 'Invoice Notes',
      required: false,
      en: 'All notes appear internally. External notes are included only for SCAN records.',
      zh: '内部汇总保留全部备注；外部汇总仅保留 SCAN 记录的备注。',
    },
  ],
};

/** Content only: use inside the shared Modal or another documentation surface. */
export function Templates({ lang }: { lang: Lang }) {
  const [kind, setKind] = useState<TemplateKind>('statement');
  const id = useId();
  const tr = (en: string, zh: string) => (lang === 'en' ? en : zh);
  const sample = samples[kind];
  const selectTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: TemplateKind =
      event.key === 'Home'
        ? 'statement'
        : event.key === 'End'
          ? 'system'
          : kind === 'statement'
            ? 'system'
            : 'statement';
    setKind(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };
  return (
    <div className="templates-view">
      <style>{`
      .templates-view { padding:22px 26px 26px; color:#607694; font-size:13px }
      .templates-view .templates-intro { line-height:1.8; margin:0 0 18px }
      .templates-tabs { display:flex; gap:8px; border-bottom:1px solid #e5ecf5; margin-bottom:20px }
      .templates-tabs button { border:0; border-bottom:2px solid transparent; border-radius:0; padding:12px 10px; background:transparent; color:#8495ad }
      .templates-tabs button[aria-selected=true] { color:#2866d7; border-bottom-color:#2866d7 }
      .templates-toolbar { display:flex; justify-content:space-between; align-items:center; gap:16px; margin-bottom:18px }
      .templates-toolbar h3 { margin:0 0 5px; font-size:16px; color:#3e5778 }
      .templates-toolbar p { margin:0; color:#8698b0; font-size:12px; line-height:1.7 }
      .templates-downloads { display:flex; gap:8px; flex-shrink:0 }
      .templates-downloads a { display:inline-flex; align-items:center; gap:7px; border:1px solid #dce6f4; border-radius:7px; padding:9px 12px; color:#2866d7; font-size:12px; text-decoration:none; background:#f8faff }
      .templates-downloads a:hover { background:#edf4ff; border-color:#a8c6f4 }
      .templates-downloads a:focus-visible { outline:3px solid #93bfff; outline-offset:3px }
      .templates-table-scroll { overflow:auto; margin-bottom:20px }
      .templates-view table { width:100%; border-collapse:collapse; font-size:12px; text-align:left }
      .templates-view th { color:#778da9; background:#f6f9fd; font-size:11px; padding:11px 12px; white-space:nowrap }
      .templates-view td { border-bottom:1px solid #eaf0f7; padding:12px; line-height:1.75; vertical-align:top }
      .templates-schema td:first-child { color:#3d5f8c; font-family:ui-monospace,monospace; white-space:nowrap }
      .templates-schema td:nth-child(2) { white-space:nowrap; color:#8a9cb2; font-size:11px }
      .templates-required { color:#2866d7; font-weight:600 }
      .templates-view h4 { font-size:13px; color:#4b6689; margin:20px 0 10px }
      .templates-preview td { white-space:nowrap; color:#7890ac }
      .templates-note { display:flex; align-items:flex-start; gap:9px; padding:13px 15px; background:#f3f7fd; border-radius:8px; font-size:12px; line-height:1.8; margin-top:12px }
      .templates-note svg { flex-shrink:0; color:#7094c3; margin-top:3px }
      .templates-note p { margin:0 }
      @media(max-width:650px) { .templates-view { padding:18px } .templates-toolbar { align-items:flex-start; flex-direction:column } .templates-downloads { width:100% } .templates-downloads a { flex:1; justify-content:center } }
    `}</style>
      <p className="templates-intro">
        {tr(
          'Upload XLS, XLSX or CSV files. These templates show a simple layout; other column names and report layouts can be mapped in Preview & map columns.',
          '支持上传 XLS、XLSX 或 CSV。这些模板展示简易格式；其他列名或报表布局可在“预览及设置列映射”中调整。',
        )}
      </p>
      <div className="templates-tabs" role="tablist" aria-label={tr('File templates', '文件模板')}>
        {(['statement', 'system'] as const).map((tab) => (
          <button
            key={tab}
            id={`${id}-${tab}`}
            role="tab"
            aria-selected={kind === tab}
            aria-controls={`${id}-panel`}
            tabIndex={kind === tab ? 0 : -1}
            onClick={() => setKind(tab)}
            onKeyDown={selectTab}
          >
            <FileSpreadsheet size={16} />
            {tab === 'statement'
              ? tr('Vendor statement', '供应商对账单')
              : tr('System export', '系统导出文件')}
          </button>
        ))}
      </div>
      <section id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${kind}`}>
        <div className="templates-toolbar">
          <div>
            <h3>
              {kind === 'statement'
                ? tr('Outstanding invoices to check', '需要查询的未结发票')
                : tr('Invoice records in the system', '系统中的发票记录')}
            </h3>
            <p>
              {tr(
                'Each download contains a header and three fictional example rows. Replace them with your own data.',
                '下载文件包含表头及三行虚构示例，请替换为自己的数据。',
              )}
            </p>
          </div>
          <div className="templates-downloads">
            <a href={`/templates/${kind}.xlsx`} download>
              <Download size={15} />
              {tr('Excel template', 'Excel 模板')}
            </a>
            <a href={`/templates/${kind}.csv`} download>
              <Download size={15} />
              {tr('CSV template', 'CSV 模板')}
            </a>
          </div>
        </div>
        <div className="templates-table-scroll">
          <table className="templates-schema">
            <thead>
              <tr>
                <th>{tr('Column', '列名')}</th>
                <th>{tr('Requirement', '要求')}</th>
                <th>{tr('What to enter', '填写内容')}</th>
              </tr>
            </thead>
            <tbody>
              {schema[kind].map((field) => (
                <tr key={field.column}>
                  <td>{field.column}</td>
                  <td>
                    {field.required ? (
                      <span className="templates-required">{tr('Required', '必需')}</span>
                    ) : (
                      tr('Optional', '可选')
                    )}
                  </td>
                  <td>{field[lang]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h4>{tr('Example preview', '示例预览')}</h4>
        <div className="templates-table-scroll">
          <table className="templates-preview">
            <thead>
              <tr>
                {sample.headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((value, column) => (
                    <td key={column}>{value === '' ? '—' : value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="templates-note">
          <Info size={16} />
          <p>
            {tr(
              'Keep invoice numbers as text to preserve leading zeros, such as 000101. The Excel templates already format invoice cells as text. When editing CSV in Excel, import the invoice column as Text before saving.',
              '发票号码请按文本保存，以保留 000101 等前导零。Excel 模板中的发票列已设为文本；在 Excel 编辑 CSV 时，请先按“文本”导入发票列再保存。',
            )}
          </p>
        </div>
      </section>
    </div>
  );
}

export default Templates;
