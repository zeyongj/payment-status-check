import type {
  InvoiceRecord,
  MatchCandidate,
  MatchMethod,
  MatchResult,
  MatchSettings,
} from './types';
import { assignAP, DEFAULT_SETTINGS } from './defaults';

export function normalizeInvoice(
  value: string,
  settings: Pick<MatchSettings, 'ignoreCase' | 'normalizePunctuation'> = DEFAULT_SETTINGS,
): string {
  let s = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:nan|none|null|undefined)$/i.test(s)) return '';
  if (settings.normalizePunctuation) s = s.replace(/,/g, '').replace(/\.0$/, '').replace(/\.$/, '');
  return settings.ignoreCase ? s.toUpperCase() : s;
}

function splitInvoice(value: string): { invoice: string; project: string } {
  const match = value.match(/^(.*?)\s*\[([\w-]+)\]$/);
  return match ? { invoice: match[1].trim(), project: match[2] } : { invoice: value, project: '' };
}

export function compileTemplate(template: string, ignoreCase = true): RegExp | null {
  if (!template.trim()) return null;
  if (
    template.length > 160 ||
    (template.match(/\{invoice\}/g) ?? []).length !== 1 ||
    (template.match(/\{project\}/g) ?? []).length > 1 ||
    /\{(?!invoice\}|project\})[^}]*\}/.test(template)
  ) {
    throw new Error(
      'Use exactly one {invoice} and optionally one {project}, for example: {invoice} [{project}]. Other text is treated literally.',
    );
  }
  const pieces = template.split(/(\{invoice\}|\{project\})/);
  const pattern = pieces
    .map((piece) =>
      piece === '{invoice}'
        ? '(?<invoice>.+?)'
        : piece === '{project}'
          ? '(?<project>[A-Za-z0-9_-]+)'
          : piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'),
    )
    .join('');
  return new RegExp(`^${pattern}$`, ignoreCase ? 'i' : '');
}

/** Bounded edit distance: stops work when the configured similarity is impossible. */
export function editDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = new Array<number>(b.length + 1).fill(maxDistance + 1);
    current[0] = i;
    let minimum = current[0];
    for (let j = Math.max(1, i - maxDistance); j <= Math.min(b.length, i + maxDistance); j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      minimum = Math.min(minimum, current[j]);
    }
    if (minimum > maxDistance) return maxDistance + 1;
    previous = current;
  }
  return previous[b.length];
}

export function effectiveStatus(record: InvoiceRecord): string {
  const meaningful = (s: string) => (/^(?:nan|none|null)?$/i.test(s.trim()) ? '' : s.trim());
  return meaningful(record.stage) || meaningful(record.status) || 'Unknown';
}

function contextualMatch(request: InvoiceRecord, record: InvoiceRecord): boolean {
  if (
    request.project &&
    record.project &&
    request.project.toUpperCase() !== record.project.toUpperCase()
  )
    return false;
  if (
    request.vendor &&
    record.vendor &&
    normalizeInvoice(request.vendor) !== normalizeInvoice(record.vendor)
  )
    return false;
  return true;
}

function unique(values: string[]): string {
  return [...new Set(values.filter(Boolean))].join(' / ');
}

function ambiguity(candidates: MatchCandidate[], method: MatchMethod): string {
  const projects = new Set(
    candidates.map((c) => c.record.project || c.record.company || 'unassigned'),
  );
  const vendors = new Set(candidates.map((c) => normalizeInvoice(c.record.vendor)).filter(Boolean));
  const statuses = new Set(candidates.map((c) => effectiveStatus(c.record).toUpperCase()));
  if (
    candidates.some((c) => {
      const suffix = splitInvoice(normalizeInvoice(c.record.invoice)).project;
      return suffix && c.record.project && suffix.toUpperCase() !== c.record.project.toUpperCase();
    })
  )
    return 'A source invoice suffix conflicts with its project column. Review the source record.';
  if (vendors.size > 1)
    return 'The invoice number occurs for different vendors. Select the correct source records.';
  if (projects.size > 1 && method !== 'project-suffix')
    return 'The invoice number occurs in different projects. Review every component before assigning a status.';
  if (statuses.size > 1 && method !== 'project-suffix')
    return 'Source records have conflicting statuses. Review all records; PAID does not automatically take priority.';
  if (candidates.length > 1 && projects.size === 1 && statuses.size === 1) return '';
  return '';
}

export function reconcile(
  requested: InvoiceRecord[],
  source: InvoiceRecord[],
  settings: MatchSettings = DEFAULT_SETTINGS,
): MatchResult[] {
  if (requested.length > 10000)
    throw new Error('Please reconcile no more than 10,000 requested invoices at once.');
  if (source.length > 150000)
    throw new Error('Please use a system file with no more than 150,000 invoice rows.');
  const template = compileTemplate(settings.customTemplate, settings.ignoreCase);
  const index = new Map<string, InvoiceRecord[]>();
  const splitIndex = new Map<string, InvoiceRecord[]>();
  const customIndex = new Map<string, InvoiceRecord[]>();
  const customProjects = new Map<string, string>();
  const add = (map: Map<string, InvoiceRecord[]>, key: string, record: InvoiceRecord) => {
    if (!key) return;
    const group = map.get(key) ?? [];
    group.push(record);
    map.set(key, group);
  };
  for (const record of source) {
    const key = normalizeInvoice(record.invoice, settings);
    add(index, key, record);
    const split = splitInvoice(key);
    add(splitIndex, split.invoice, record);
    if (template) {
      const groups = normalizeInvoice(record.invoice, settings).match(template)?.groups;
      if (groups?.invoice) {
        add(customIndex, normalizeInvoice(groups.invoice, settings), record);
        if (groups.project) customProjects.set(record.id, groups.project);
      }
    }
  }
  const allKeys = [...index.keys()];
  return requested.map((request) => {
    const key = normalizeInvoice(request.invoice, settings);
    const requestGroups = template ? key.match(template)?.groups : undefined;
    const requestProject =
      request.project || splitInvoice(key).project || requestGroups?.project || '';
    const effectiveRequest = { ...request, project: requestProject };
    const context = (record: InvoiceRecord) =>
      contextualMatch(effectiveRequest, record) &&
      (!requestProject ||
        !customProjects.get(record.id) ||
        customProjects.get(record.id)!.toUpperCase() === requestProject.toUpperCase());
    let records = (index.get(key) ?? []).filter(context);
    let method: MatchMethod = records.length
      ? records.every((r) => r.invoice.trim() === request.invoice.trim())
        ? 'exact'
        : 'normalized'
      : 'none';
    let candidates: MatchCandidate[] = [];
    let reason = '';
    let fuzzyAuto = false;
    if (!records.length && settings.splitProjects && key) {
      const base = splitInvoice(key);
      records = (splitIndex.get(base.invoice) ?? []).filter(
        (r) =>
          context(r) &&
          (!base.project ||
            splitInvoice(normalizeInvoice(r.invoice, settings)).project === base.project ||
            r.project.toUpperCase() === base.project.toUpperCase()),
      );
      if (records.length) method = 'project-suffix';
    }
    if (!records.length && template && key) {
      records = (
        customIndex.get(
          requestGroups?.invoice ? normalizeInvoice(requestGroups.invoice, settings) : key,
        ) ?? []
      ).filter(context);
      if (records.length) method = 'custom-template';
    }
    if (records.length) {
      candidates = records.map((record) => ({ id: record.id, record, score: 100, method }));
      reason = ambiguity(candidates, method);
      if (
        method === 'custom-template' &&
        candidates.some(
          (c) =>
            customProjects.get(c.id) &&
            c.record.project &&
            customProjects.get(c.id)!.toUpperCase() !== c.record.project.toUpperCase(),
        )
      )
        reason =
          'The project captured by the custom template conflicts with the source project column.';
      // Project splits retain all components, but conflicting statuses are still
      // reviewed; no component's paid state is allowed to conceal another.
      if (
        method === 'project-suffix' &&
        new Set(records.map((r) => effectiveStatus(r).toUpperCase())).size > 1
      )
        reason = 'Split-project components have different statuses. Review all components.';
    } else if (settings.fuzzy && key && key.length <= 160) {
      const threshold = Math.max(50, Math.min(100, settings.fuzzyThreshold));
      const margin = Math.max(0, Math.min(25, settings.fuzzyMargin));
      const searchFloor = threshold - margin;
      const scored: { key: string; score: number }[] = [];
      for (const sourceKey of allKeys) {
        const length = Math.max(key.length, sourceKey.length);
        if (!length || length > 160) continue;
        const distanceLimit = Math.floor(length * (1 - searchFloor / 100) + 1e-9);
        if (Math.abs(key.length - sourceKey.length) > distanceLimit) continue;
        const distance = editDistance(key, sourceKey, distanceLimit);
        if (distance > distanceLimit) continue;
        const score = Math.round((1 - distance / length) * 10000) / 100;
        if (score >= searchFloor && (index.get(sourceKey) ?? []).some(context))
          scored.push({ key: sourceKey, score });
      }
      scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
      for (const hit of scored.filter((hit) => hit.score >= threshold).slice(0, 10))
        for (const record of index.get(hit.key) ?? []) {
          if (context(record))
            candidates.push({ id: record.id, record, score: hit.score, method: 'fuzzy' });
        }
      if (candidates.length) {
        method = 'fuzzy';
        const best = scored[0];
        const next = scored[1];
        const topCandidates = candidates.filter((c) => c.score === best.score);
        fuzzyAuto =
          settings.autoAcceptFuzzy &&
          (!next || best.score - next.score >= margin) &&
          !ambiguity(topCandidates, 'fuzzy');
        reason = fuzzyAuto
          ? ''
          : 'Similar invoice numbers require review. Confirm the correct source record before sharing its status.';
        if (fuzzyAuto) candidates = topCandidates;
      }
    }
    candidates = candidates.map((candidate) => ({
      ...candidate,
      ap: assignAP(candidate.record.project, settings.ap),
      pm: settings.pm[candidate.record.project] ?? '',
    }));
    const accepted =
      candidates.length && !reason && (method !== 'fuzzy' || fuzzyAuto) ? candidates : [];
    const resolution = accepted.length ? 'matched' : candidates.length ? 'review' : 'missing';
    const acceptedRecords = accepted.map((c) => c.record);
    const projects = acceptedRecords.map((r) => r.project);
    return {
      id: request.id,
      request,
      candidates,
      accepted,
      resolution,
      method,
      score: candidates[0]?.score ?? 0,
      status: accepted.length
        ? unique(acceptedRecords.map(effectiveStatus))
        : resolution === 'review'
          ? 'Needs review'
          : 'Missing',
      notes: unique(acceptedRecords.map((r) => r.notes)),
      project: unique(projects) || request.project,
      ap: unique(projects.map((p) => assignAP(p, settings.ap))),
      pm: unique(projects.map((p) => settings.pm[p] ?? '')),
      reason:
        reason ||
        (resolution === 'missing'
          ? 'No matching invoice number was found within the selected rules.'
          : ''),
    };
  });
}
