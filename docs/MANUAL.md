# Invoice Check — User manual / 使用手册

## English

1. Open **Reconcile**. Add the vendor statement on the left and the Inqflow export on the right. XLS, XLSX and CSV are accepted, up to 30 MB each. A sample workspace is available with fictional invoices.
2. Check the invoice count and **Preview & map columns**. For each worksheet, choose its header row, invoice column and any optional project, vendor, amount, balance or notes columns. Include the sheets you want. Unknown headers need manual mapping.
3. In **Extraction & custom format**, choose whether to exclude settled balances and include credit notes. A prepared invoice-only CSV preserves its supplied IDs. The statement workbook distinguishes explicit invoice and credit-note activity rows.
4. Keep the standard normalization and project-suffix rules, or enter a custom format such as `{invoice}-{project}`. Literal prefixes and suffixes are supported; arbitrary regular expressions or code are not executed.
5. Adjust similarity and the runner-up margin as needed. At 96%, short invoice IDs rarely admit any typo. Auto acceptance requires the threshold, the configured margin and consistent context. Text similarity is not the probability that an invoice is correct.
6. Click **Check payment status**. The four counts represent requested invoices. Output can contain more rows when a request has several retained system components.
7. Use **Review matches** to inspect conflicts, source notes, original statuses and sheet/row references. Confirm one or more source records, or mark the request missing. Unresolved external rows remain **Needs review**. A record with no status is **Unknown**.
8. Switch between **Internal** and **External**, search or filter the table, and download CSV or Excel. Downloads contain all summary rows, regardless of visible filters. Changing inputs, rules or shared settings requires another check before exporting.
9. Open **Team directory** to view private AP and PM assignments after authorized sign-in. Viewers can read, owner/admin users can save edits, and only the owner can grant or revoke viewer/administrator access. New sign-ups have no directory access. Sign in with the existing AP Count Clerk account. A conflict leaves the unsaved draft in place; refresh only when ready to replace it with the latest shared version.
10. **Clear workspace** discards invoice files, results and review decisions from memory. Download the summaries before clearing or closing the tab. Only language preference persists in browser storage. Guests can reconcile files with AP/PM names blank. Staff directory data is never bundled in public source.

### Output rules

| Source result | Internal | External |
| --- | --- | --- |
| AP / APPROVED | Original wording | Approved for payment |
| Site A / Site B / PM / SRPM | Original wording | Pending Approval |
| SCAN | Original wording and all notes | Pending Approval and SCAN source notes |
| PAID / IN-PAYABLE / other status | Original wording | Original wording |
| No source match | Missing | Missing |
| Found row without stage/status | Unknown | Unknown |
| Unconfirmed candidate/conflict | Needs review with labelled candidate notes | Needs review, no notes |

Internal output includes project, AP, PM, original stage/status, matched invoice, rule, score and source references. External output excludes staff names, audit fields and non-SCAN notes. Source stage takes precedence over source status, matching the original workflow; both fields remain in the internal audit columns.

### File compatibility

CSV encoding is independent of operating system. The provided request CSV contains Mac Roman nonbreaking spaces, which cause strict UTF-8 decoding to fail. An encoding selector is available for each CSV. A legacy-encoding warning means the preview should be checked; encoding cannot always be inferred from a single accented character.

The parser recognizes repeated headers, totals and common statement layouts. It cannot guarantee correct extraction for arbitrary vendor layouts. Review mappings and counts. Scanned PDFs, images, encrypted workbooks and entirely unstructured statements need a table extracted first. Leading zeros already lost during an earlier conversion cannot be reconstructed.

## 中文

1. 打开**发票核对**，左侧上传供应商对账单，右侧上传 Inqflow 导出文件。支持 XLS、XLSX、CSV，每份最大 30 MB；也可先试用虚构示例数据。
2. 检查记录数并打开**预览及设置列映射**。逐个工作表选择表头行、发票号码列，以及项目、供应商、金额、余额、备注等可选列。无法识别的表头需手动映射。
3. 在**提取及自定义格式**中，选择是否仅提取未结余额及包含贷项。已整理的单列发票 CSV 会保留所提供的号码；原始 statement 根据明确的发票及贷项标签识别。
4. 可保留标准规范化和项目后缀规则，或填写 `{invoice}-{project}` 等格式。支持字面前后缀和两个占位符，不执行任意正则表达式或代码。
5. 按需调整相似度及领先次优候选的分差。96% 对短号码较严格，通常不会接受单字符错误。自动接受同时要求达到阈值、分差及上下文一致；相似度并非正确概率。
6. 点击**查询付款状态**。四个统计数按待查询发票计数；若一张发票保留了多个系统组件，汇总行数可能更多。
7. 使用**匹配复核**检查冲突、原始备注、原始状态及工作表/行号。可确认一条或多条来源记录，也可标记为未找到。未解决的外部记录显示 **Needs review**；记录存在但无状态时显示 **Unknown**。
8. 切换**内部版/外部版**，搜索或筛选后下载 CSV 或 Excel。下载包含全部汇总记录，不受页面筛选影响。修改文件、规则或共享分配后必须重新查询才能导出。
9. **团队分配**只向获授权的登录账号展示 AP 和 PM 负责人。viewer 仅可查看，owner/admin 可保存修改，只有 owner 可授予或撤销查看/管理权限。注册新账号本身不授予目录访问。使用与 AP Count 相同的 Clerk 账号登录。遇到并发版本冲突时，草稿会保留；确认可替换草稿后再刷新。
10. **清空工作空间**会清除内存中的发票文件、结果及复核决定。关闭标签页前请先下载；浏览器只持久保存语言偏好。

内部版保留原始状态和全部备注，并增加项目、AP、PM、原始 Stage/Status、匹配号码、规则、分数及来源。外部版将 AP/APPROVED 改为 **Approved for payment**，将 Site A/Site B/PM/SRPM/SCAN 改为 **Pending Approval**，仅保留 SCAN 来源备注；其他状态保持原文。应用不生成邮件或 TXT，也不承诺付款日期。

CSV 编码与运行 Python 的操作系统无关。附件中的 Mac Roman 不换行空格导致 UTF-8 解码失败。每份 CSV 均可独立选择编码；仅凭一个特殊字符无法保证推断正确，出现编码提示时请核对预览。

原始对账单可自动识别常见表头、分组及合计，但无法保证识别所有 vendor 的任意排版。请检查映射及数量。图片、扫描 PDF、加密工作簿和非结构化文件需要先提取成表格；此前转换已丢失的前导零无法恢复。

