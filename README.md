# Payment Status Check

A browser-based workspace for checking outstanding vendor invoices against an Inqflow export. The interface follows AP Count’s blue-and-white workspace, with English as the default and a Chinese language switch.

- **Website:** https://payment-status-check.vercel.app
- **User manual:** Open **User guide / 使用手册** in the website, or read [the bilingual manual](docs/MANUAL.md).
- **Hosting:** Vercel Hobby, with the existing Clerk sign-in and a separate private settings store.

## What it does

Upload XLS, XLSX or CSV files directly. The statement parser recognizes repeated account-statement blocks, invoice and credit-note labels, project headings, common column names and outstanding balances. Every sheet can be included or excluded, and its header row and column mapping can be corrected in a source preview. CSV encoding is detected independently for each file and can be overridden.

Matching proceeds through exact IDs, conservative normalization, project suffixes, an optional `{invoice}` / `{project}` format, and edit-distance similarity. High-similarity auto acceptance is enabled by default at 96%, with a five-point lead over the next candidate. Conflicting vendors, projects or statuses require review. Split components and duplicate source rows retain their separate status, notes and provenance; PAID never wins merely because of a priority rank.

The results page displays internal and external summaries and downloads either as UTF-8 CSV or XLSX. Internal output includes original stage/status, all notes, project, AP, PM and matching evidence. External output maps AP/APPROVED to **Approved for payment**, and Site A/Site B/PM/SRPM/SCAN to **Pending Approval**. Only SCAN source notes are included externally. No external email text or TXT file is generated.

Invoice files and reconciliation results remain in browser memory. Language preference is saved locally. Shared server storage contains only the AP/PM directory and administrator grants. AP/PM assignments are held only in private storage and are returned only to accounts explicitly authorized as owner, administrator or viewer. They are absent from public source, build assets and repository history. Real statement files and invoice fixtures are also excluded.

## Development

Use Node 24 and npm.

```sh
npm ci
npm run dev
npm run build
npm test
```

Vite serves the browser app at `http://127.0.0.1:5173`. Plain Vite does not execute the Vercel API endpoints: file reconciliation works without sign-in; private AP/PM assignments require the authenticated Vercel API. Use `vercel dev` for the API locally, or use the deployed site.

## File formats and templates

The homepage and User guide include **Formats & templates**, with column requirements, a fictional preview and downloadable examples:

- [Statement CSV](https://payment-status-check.vercel.app/templates/statement.csv) / [Statement Excel](https://payment-status-check.vercel.app/templates/statement.xlsx)
- [System CSV](https://payment-status-check.vercel.app/templates/system.csv) / [System Excel](https://payment-status-check.vercel.app/templates/system.xlsx)

Templates are optional; existing report labels can be mapped after upload. Invoice numbers should remain text. The examples contain no real invoices or staff assignments.

Windows Excel **CSV (MS-DOS)** is supported through explicit OEM CP437 and CP850 encoding options. ASCII-only files work automatically; accented characters require the appropriate code page. UTF-8, Windows-1252, Mac Roman, GB18030/GBK and Big5 remain available. Prefer UTF-8 CSV or XLSX for new files.

## Authentication and shared settings

Copy `.env.example` to an ignored `.env.local` and configure the variables through your hosting environment. Only the Clerk publishable key enters the browser bundle. Clerk server credentials and Blob tokens must have no public environment prefix.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk browser sign-in |
| `CLERK_SECRET_KEY` | Server verification of active sessions and accounts |
| `PAYMENT_STATUS_CHECK_ADMIN_EMAIL` | Owner’s verified primary email |
| `PAYMENT_STATUS_CHECK_OWNER_GITHUB_ID` | Optional immutable GitHub identity linked through verified Clerk OAuth |
| `PAYMENT_STATUS_CHECK_ORIGIN` | Canonical application origin used to verify session parties |
| `BLOB_READ_WRITE_TOKEN` | Private settings store, server only |

The current Hobby deployment reuses AP Count’s development Clerk instance. Sign in with the existing account. Clerk may display its development-mode notice; moving to a live Clerk instance requires its own domain setup. This app does not create passwords or use a browser role selector.

Only an owner or explicitly granted administrator can update the shared directory. Authorized viewers have read-only access; a new sign-up alone grants no directory access. Guests can reconcile files, with AP/PM names left blank. Only the owner can grant or revoke viewer/administrator access, using an existing account’s verified primary email. Grants are bound to the Clerk user ID and rechecked against the current account. Settings use isolated `payment-status-check/` Blob paths, strong ETags and conditional writes. A stale save returns 409 and preserves the editor’s draft.

The production Blob store is separate from AP Count’s store and is connected only to production. Local and preview environments cannot accidentally edit production settings unless an operator deliberately connects a store to those environments. Staff data must be seeded through a trusted private process and must never be placed in tracked defaults or fixtures.

## Deployment

The Vercel project is linked to this repository’s `main` branch. Pushes trigger production builds. The framework is Vite, with `npm ci`, `npm run build`, `dist/`, and Node 24. API routes are ordinary Vercel Functions using web `Request` and `Response` objects.

For a local production package check:

```sh
vercel pull --yes --environment=production
vercel build --prod
node scripts/check-functions.mjs
```

Keep `.vercel`, all `.env` files, uploaded invoices and build artifacts out of Git. [Validation notes](docs/VALIDATION.md) describe the tested attachment counts and important limits.

## Code map

| Path | Responsibility |
| --- | --- |
| `src/lib/parser.ts` | File decoding, header detection, field mapping and statement extraction |
| `src/lib/matching.ts` | Invoice normalization, indexed matching and ambiguity handling |
| `src/lib/summary.ts` | Internal/external policies and formula-safe downloads |
| `src/reconcile.worker.ts` | Reconciliation outside the UI thread |
| `src/components/Directory.tsx` | Bilingual AP/PM editor and owner access management |
| `server/` and `api/` | Session verification, validation, concurrency and private storage |
| `tests/` | Parsing, matching, export and authorization regression checks |

