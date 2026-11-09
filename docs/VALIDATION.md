# Validation notes

Validated on 9 November 2026. Original invoice files are not committed to this public repository. Counts below are aggregate checks against the provided attachments.

| Input | Rows |
| --- | ---: |
| Inqflow system export | 29,724 |
| Prepared requested-invoice CSV | 707 |
| Original statement: invoice activity | 672 |
| Original statement: credit-note activity | 38 |
| Original statement: invoices and credits | 710 |

With the standard 96% similarity threshold and five-point runner-up margin:

| Request input | Matched | Needs review | Missing |
| --- | ---: | ---: | ---: |
| Prepared CSV, all supplied IDs | 608 | 2 | 97 |
| Workbook, including credit notes | 610 | 2 | 98 |

The workbook contains three entries absent from the prepared CSV: one invoice and two credit notes. Automated extraction deliberately does not reproduce unexplained manual omissions. Each request is preserved. The CSV reconciliation has 708 summary rows because one accepted invoice has multiple retained system records.

The request CSV is identified as Mac Roman using the nonbreaking-space context. The system CSV defaults to Windows-1252; a single non-ASCII note character remains inherently ambiguous between legacy encodings. Invoice IDs in the system file are ASCII. The UI provides per-file encoding override and a source preview rather than silently discarding undecodable bytes.

The privately seeded PM table has 463 rows and 458 distinct project keys. Its mappings and all actual AP names are excluded from public source and history. Multiple supplied PM values for one project are retained. Some values are initials or annotations, so the app preserves those values without inventing full names.

Automated regression coverage includes:

- Legacy XLS, XLSX, quoted multiline CSV, encoding and leading zeros.
- Repeated statement headers, invoice/credit labels, balance filtering and project-group context.
- Exact and normalized IDs, project suffixes, custom templates, fuzzy thresholds and runner-up margins.
- Duplicate/conflicting statuses, split components and explicit manual selection.
- Internal note preservation, external SCAN-only notes and formula-safe CSV/XLSX downloads.
- Anonymous and ungranted-account directory denial, viewer read-only access, verified owner identity, and grant/revocation checks.
- Config validation, request size limits, private storage paths and strong ETag concurrency.

The Vercel production build and emitted API module boot check are also verified. Browser checks cover sample reconciliation, split-record review, both download formats, actual attachment uploads, language switching and responsive layout. Owner/admin mutation handlers are covered by service tests; an interactive owner sign-in requires the account holder’s existing session.

The Windows CSV update adds byte-level CP437/CP850 regression checks and compares their non-ASCII mappings against the SheetJS code-page decoder. A template integration test reads all four published template assets, preserves leading-zero identifiers and validates both summary policies.
