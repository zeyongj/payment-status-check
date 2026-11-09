export type EncodingChoice =
  | 'auto'
  | 'utf-8'
  | 'windows-1252'
  | 'macintosh'
  | 'cp437'
  | 'cp850'
  | 'gb18030'
  | 'big5';
export interface ParsedSheet {
  name: string;
  rows: string[][];
}
export interface ParsedFile {
  name: string;
  sheets: ParsedSheet[];
  encoding: string;
  warnings: string[];
}
export interface ColumnMapping {
  headerRow: number;
  invoice: number;
  stage: number;
  status: number;
  notes: number;
  project: number;
  company: number;
  amount: number;
  balance: number;
  vendor: number;
}
export interface InvoiceRecord {
  id: string;
  invoice: string;
  stage: string;
  status: string;
  notes: string;
  project: string;
  company: string;
  vendor: string;
  amount: number | null;
  balance: number | null;
  sheet: string;
  row: number;
  source: string;
}
export interface ExtractOptions {
  outstandingOnly: boolean;
  includeCreditNotes: boolean;
}
export interface APEntry {
  Name: string;
  Portfolio: string;
  Include: string;
  Exclude: string;
}
export interface MatchSettings {
  ignoreCase: boolean;
  normalizePunctuation: boolean;
  splitProjects: boolean;
  customTemplate: string;
  fuzzy: boolean;
  fuzzyThreshold: number;
  fuzzyMargin: number;
  autoAcceptFuzzy: boolean;
  ap: APEntry[];
  pm: Record<string, string>;
}
export type MatchMethod =
  | 'exact'
  | 'normalized'
  | 'project-suffix'
  | 'custom-template'
  | 'fuzzy'
  | 'none';
export interface MatchCandidate {
  id: string;
  record: InvoiceRecord;
  score: number;
  method: MatchMethod;
  ap?: string;
  pm?: string;
}
export interface MatchResult {
  id: string;
  request: InvoiceRecord;
  candidates: MatchCandidate[];
  accepted: MatchCandidate[];
  resolution: 'matched' | 'review' | 'missing';
  method: MatchMethod;
  score: number;
  status: string;
  notes: string;
  project: string;
  ap: string;
  pm: string;
  reason: string;
}
export type ReviewSelections = Record<string, string[]>;
export interface SummaryRow {
  Invoice: string;
  Status: string;
  Notes: string;
  'Original stage'?: string;
  'Original status'?: string;
  'Project number'?: string;
  'AP name'?: string;
  'PM name'?: string;
  'Matched invoice'?: string;
  'Match method'?: string;
  'Match score'?: number;
  Review?: string;
  'Source file'?: string;
  'Source sheet'?: string;
  'Source row'?: number;
  'Statement sheet'?: string;
  'Statement row'?: number;
}
