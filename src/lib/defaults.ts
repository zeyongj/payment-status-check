import type { APEntry, MatchSettings } from './types';
// Staff assignments are fetched only after server-authorized sign-in.
export const DEFAULT_AP: APEntry[] = [];
export const DEFAULT_PM: Record<string, string> = {};

export const DEFAULT_SETTINGS: MatchSettings = {
  ignoreCase: true,
  normalizePunctuation: true,
  splitProjects: true,
  customTemplate: '',
  fuzzy: true,
  fuzzyThreshold: 96,
  fuzzyMargin: 5,
  autoAcceptFuzzy: true,
  ap: DEFAULT_AP,
  pm: DEFAULT_PM,
};

export function assignAP(project: string, rules: APEntry[] = DEFAULT_AP): string {
  if (!/^\d+$/.test(project.trim())) return '';
  const n = Number(project);
  const list = (s: string) =>
    s
      .split(/[,;\s]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  const explicitlyIncluded = rules.filter(
    (r) => list(r.Include).includes(project) && !list(r.Exclude).includes(project),
  );
  const eligible = explicitlyIncluded.length
    ? explicitlyIncluded
    : rules.filter((r) => {
        if (list(r.Exclude).includes(project)) return false;
        return r.Portfolio.split(/[,;]/).some((range) => {
          const plus = range.trim().match(/^(\d+)\+$/);
          if (plus) return n >= Number(plus[1]);
          const between = range.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
          if (between) return n >= Number(between[1]) && n <= Number(between[2]);
          return Number(range.trim()) === n;
        });
      });
  return [...new Set(eligible.map((r) => r.Name))].join(' / ');
}
