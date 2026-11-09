import {
  BookOpen,
  FileSpreadsheet,
  GitCompareArrows,
  Download,
  Users,
  ShieldCheck,
} from 'lucide-react';
import { words, type Lang } from '../i18n';

export function Guide({ lang }: { lang: Lang }) {
  const t = words[lang];
  const sections =
    lang === 'en'
      ? [
          {
            icon: FileSpreadsheet,
            title: '1. Add the original files',
            text: 'Upload the vendor statement on the left and the Inqflow export on the right. XLS, XLSX and CSV are supported; no Colab or Python installation is needed. Each file can be up to 30 MB. Workbooks can contain multiple sheets.',
            details:
              'The parser scans the first 100 rows for a header, recognizes common invoice / balance / project labels, carries project headings forward, skips repeated headers and total rows, and extracts outstanding invoices. Open “Preview & map columns” to check every selected sheet. If a vendor uses unusual labels, choose the header row and map the invoice, project and balance columns yourself. Unrecognized sheets are excluded until mapped.',
          },
          {
            icon: BookOpen,
            title: '2. Check encoding and extraction',
            text: 'CSV encoding is detected automatically where possible. Excel CSV (MS-DOS) is supported: choose MS-DOS CP437 (US) or CP850 (Western Europe) for accented characters and check the preview. UTF-8, Mac Roman, Windows-1252, GB18030/GBK and Big5 are also available.',
            details:
              'Legacy CSV does not reliably identify its code page; it depends on the export locale. Prefer CSV UTF-8 or XLSX for new exports. Review the original cell preview and extracted row count before running. Outstanding-only filtering applies when a balance column is mapped; otherwise every valid invoice row is included. Credits can be included separately. PDF scans, images, password-protected workbooks and arbitrary unstructured statements need an invoice table extracted first. Formatting differences cannot always be resolved automatically.',
          },
          {
            icon: GitCompareArrows,
            title: '3. Choose a matching strategy',
            text: 'The engine tries exact identifiers, normalization, project suffixes, your optional format template, and then similar identifiers. Leading zeros are preserved where the source file still contains them. A zero already removed by an earlier CSV conversion cannot be recovered.',
            details:
              'Normalization cleans invisible spaces, case, commas and a trailing dot or .0. Internal hyphens remain meaningful. The project rule recognizes INV-100[5749] and INV-100 [5749]. A format such as {invoice}-{project} is interpreted literally with those two placeholders, not as arbitrary code. Fuzzy similarity is based on edit distance, not a correctness probability. High similarity auto acceptance is enabled by default as requested: the best candidate must reach the threshold, lead the next candidate by the configured margin, and have no conflicting project, vendor or status context. A 96% threshold may reject every single-character change in short invoice IDs; lower it deliberately when needed.',
          },
          {
            icon: ShieldCheck,
            title: '4. Review uncertain records',
            text: 'Records with conflicting statuses, vendors or project context stay in “Needs review”. Different split-project statuses are kept separately. PAID never silently wins over a pending or rejected component.',
            details:
              'Use “Review matches” to inspect the original invoice number, stage, status, notes, source sheet and row. Select one or more source records and confirm, or explicitly mark an invoice as missing. A found record with no stage or status is Unknown, not Missing. Until resolved, external output shows Needs review. Duplicate rows are preserved so their notes and provenance remain visible. If you change inputs, matching rules or the directory, run the check again before exporting.',
          },
          {
            icon: Download,
            title: '5. Export internal and external summaries',
            text: 'Both versions are visible in the Payment summaries page and can be downloaded as UTF-8 CSV or Excel. Download includes all rows, even when the table is filtered. No external email or TXT file is generated.',
            details:
              'Internal: stage takes precedence over status, while both original values and all notes remain in the audit columns. Project number, AP name and PM name are included. External: AP / APPROVED become Approved for payment; Site A / Site B / PM / SRPM / SCAN become Pending Approval. SCAN source notes remain; other notes are removed. PAID, IN-PAYABLE and other statuses keep their source wording. Split components retain their project numbers. The app makes no promise about a payment date or check run.',
          },
          {
            icon: Users,
            title: '6. Maintain the shared team directory',
            text: 'Owner and administrator accounts can edit AP portfolio rules and the PM directory. Only the owner can grant or revoke viewer or administrator access for an existing verified account. Sign in using the same Clerk account as AP Count.',
            details:
              'AP explicit inclusions take precedence over portfolio ranges; exclusions are respected. Conflicting AP assignments are displayed, and unassigned projects remain blank. The PM seed data contains the supplied initials and annotations; full names are not invented. Changes use a shared private settings store and revision checks to prevent overwriting someone else’s update. Uploaded invoice data and matching results never enter that store. The directory is private and absent from public source. Only explicitly authorized owner, administrator or viewer accounts can read it; creating an account alone does not grant access. Sign-in changes clear cached directory data and summaries.',
          },
        ]
      : [
          {
            icon: FileSpreadsheet,
            title: '1. 上传原始文件',
            text: '左侧上传供应商对账单，右侧上传 Inqflow 导出文件。支持 XLS、XLSX、CSV，每份最大 30 MB，可读取多个工作表，不需要安装 Python 或使用 Colab。',
            details:
              '程序扫描前 100 行识别表头，识别常见发票、余额、项目字段，向下填充项目分组，并跳过重复表头及合计行。请打开“预览及设置列映射”检查选中的工作表；特殊格式可手动选择表头及发票、项目、余额列。未识别的工作表需映射后再包含。',
          },
          {
            icon: BookOpen,
            title: '2. 检查编码和提取结果',
            text: '支持 Excel 的 CSV（MS-DOS）。有重音字符时，请在编码中选择 MS-DOS CP437（美国）或 CP850（西欧），并检查预览。也支持 UTF-8、Mac Roman、Windows-1252、GB18030/GBK 和 Big5。',
            details:
              '旧式 CSV 无法可靠标明编码，具体取决于导出时的区域设置；新文件建议使用 CSV UTF-8 或 XLSX。运行前请检查原始单元格预览及提取记录数。仅未结余额选项在存在余额列时生效，否则保留所有有效发票行；贷项可单独选择包含。PDF 扫描件、图片、加密工作簿或任意非结构化对账单，需要先提取为发票表格。格式差异无法保证全部自动解决。',
          },
          {
            icon: GitCompareArrows,
            title: '3. 设置匹配规则',
            text: '依次尝试精确号码、规范化、项目后缀、自定义格式和相似号码。源文件仍包含前导零时会保留；此前 CSV 转换已丢失的零无法恢复。',
            details:
              '规范化清理不可见空格、大小写、逗号以及末尾的点或 .0，保留内部连字符。支持 INV-100[5749] 及 INV-100 [5749]；额外格式可填写 {invoice}-{project}，占位符之外按字面处理。模糊分数基于编辑距离，并非正确概率。按你的要求默认允许高分自动接受，但必须达到阈值、领先次优候选达到指定分差，且无供应商、项目或状态冲突。96% 对短号码较严格，可能不接受任何单字符变动，请按需降低。',
          },
          {
            icon: ShieldCheck,
            title: '4. 复核不确定记录',
            text: '状态、供应商、项目冲突保留为 Needs review。跨项目拆分的不同状态分别呈现，PAID 不会自动覆盖其他未付款状态。',
            details:
              '在“匹配复核”查看候选原始号码、阶段、状态、备注、来源表及行号；可选择多条并确认，或明确标记为未找到。记录存在但没有阶段和状态时显示 Unknown，而非 Missing。待复核记录在外部汇总中也保持 Needs review。重复行保留以展示所有备注和来源。修改文件、规则或分配表后需重新查询才能导出。',
          },
          {
            icon: Download,
            title: '5. 查看及下载两种汇总',
            text: '“付款状态汇总”中可查看内部及外部版本，支持 UTF-8 CSV 和 Excel 下载；下载始终包含全部记录，不受页面筛选影响。不生成邮件或 TXT 文件。',
            details:
              '内部版优先使用 Stage，再使用 Status，同时在审计列保留两者原值及全部备注，并增加 Project number、AP name、PM name。外部版：AP / APPROVED 转为 Approved for payment；Site A / Site B / PM / SRPM / SCAN 转为 Pending Approval；只保留 SCAN 的来源备注，移除其余备注。PAID、IN-PAYABLE 及其他状态保留原文，拆分记录保留项目编号。应用不会承诺付款日期或支票批次。',
          },
          {
            icon: Users,
            title: '6. 维护共享团队分配',
            text: 'owner 及 administrator 可以修改 AP 范围规则及 PM 项目分配。只有 owner 可以为已注册且已验证的账号授予或撤销查看或管理权限。使用与 AP Count 相同的 Clerk 账号登录。',
            details:
              'AP 的额外包含优先于项目范围，排除列表会生效；分配冲突会显示多个姓名，未分配项目留空。PM 保留你提供的缩写及注释，不推测全名。共享设置使用独立的私有存储和版本检查，避免覆盖他人更新。发票数据及匹配结果不会写入共享存储。目录仅保存在私有存储，不包含在公开代码中；只有明确获授权的 owner、administrator 或 viewer 可读取，注册账号本身不会获得权限。切换登录身份会清除缓存的目录和汇总。',
          },
        ];
  return (
    <div className="guide-page">
      <div className="page-heading">
        <span className="eyebrow">{t.guide}</span>
        <h1>{t.guideTitle}</h1>
        <p>{t.guideSub}</p>
      </div>
      <div className="guide-grid">
        {sections.map(({ icon: Icon, title, text, details }) => (
          <article className="card guide-section" key={title}>
            <span className="guide-icon">
              <Icon size={21} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
            <p className="muted">{details}</p>
          </article>
        ))}
      </div>
      <aside className="privacy-strip">
        <ShieldCheck size={20} />
        <div>
          <strong>{t.local}</strong>
          <p>
            {t.localDetail}{' '}
            {lang === 'en'
              ? 'Clear workspace or close the tab to discard invoice data. Language preference is the only setting kept in browser storage.'
              : '清空工作空间或关闭标签页即可清除发票数据。浏览器仅保存语言偏好。'}
          </p>
        </div>
      </aside>
    </div>
  );
}
