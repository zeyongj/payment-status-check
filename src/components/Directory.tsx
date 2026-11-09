import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { useIdentity } from '../main';
import { words, type Lang } from '../i18n';
import type { APEntry } from '../lib/types';

type Config = { ap: APEntry[]; pm: Record<string, string> };
type Role = 'visitor' | 'viewer' | 'admin' | 'owner';
interface Grant {
  role: 'viewer' | 'admin';
  userId: string;
  email: string;
  addedAt: string;
}
interface Props {
  lang: Lang;
  config: Config;
  revision: string | number;
  onSaved: (data: { config: Config; revision: string | number }) => void;
}
const clone = (value: Config): Config => ({
  ap: value.ap.map((row) => ({ ...row })),
  pm: { ...value.pm },
});
const PAGE_SIZE = 15;

export default function Directory({ lang, config, revision, onSaved }: Props) {
  const t = words[lang];
  const tr = (en: string, zh: string) => (lang === 'en' ? en : zh);
  const { userId, loaded, getToken, controls } = useIdentity();
  const [draft, setDraft] = useState<Config>(() => clone(config));
  const [baseline, setBaseline] = useState(() => JSON.stringify(config));
  const [baseRevision, setBaseRevision] = useState(revision);
  const dirty = JSON.stringify(draft) !== baseline;
  const [role, setRole] = useState<Role>('visitor');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'ap' | 'pm' | 'access'>('ap');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [newProject, setNewProject] = useState('');
  const [newPM, setNewPM] = useState('');
  const [grants, setGrants] = useState<Grant[]>([]);
  const [grantRevision, setGrantRevision] = useState<string | number>('');
  const [email, setEmail] = useState('');
  const [grantRole, setGrantRole] = useState<'viewer' | 'admin'>('viewer');
  const [accessUserId, setAccessUserId] = useState<string | null>(null);
  const identityGeneration = useRef(0);
  const activeUser = useRef(userId);
  if (activeUser.current !== userId) {
    activeUser.current = userId;
    identityGeneration.current += 1;
  }
  const [grantBusy, setGrantBusy] = useState(false);
  const accessSequence = useRef(0);
  const canRead =
    loaded && Boolean(userId) && accessUserId === userId && role !== 'visitor' && !checking;
  const canEdit = canRead && (role === 'owner' || role === 'admin');
  const clearPrivate = useCallback(() => {
    identityGeneration.current += 1;
    setRole('visitor');
    setAccessUserId(null);
    setDraft({ ap: [], pm: {} });
    setBaseline(JSON.stringify({ ap: [], pm: {} }));
    setBaseRevision('initial');
    setGrants([]);
    setGrantRevision('');
    setEmail('');
    setNewProject('');
    setNewPM('');
    setSearch('');
    setSuccess('');
    setConflict(false);
    setSaving(false);
    setGrantBusy(false);
    setChecking(false);
  }, []);
  const textError = useCallback(
    (code: string, message: string) => {
      if (lang === 'en') return message;
      const translations: Record<string, string> = {
        revision_conflict:
          '另一位管理员已保存更新。你的草稿仍然保留，请载入最新共享分配后核对再保存。',
        unauthorized: '登录会话无效或已过期，请重新登录。',
        forbidden: '此账号没有执行该操作的权限。',
        service_unavailable: '共享分配服务暂时不可用，请稍后重试。',
        account_not_found: '请先让对方使用该主要邮箱注册账号。',
        email_not_verified: '该账号需要有效且已验证的主要邮箱。',
        already_admin: '该账号已经是管理员。',
        owner_fixed: '所有者已拥有永久管理权限，无需重复授权。',
        admin_not_found: '此管理员权限已被移除。',
        invalid_config: '分配设置无效。请检查姓名、项目范围、包含及排除列表。',
      };
      return translations[code] ?? message;
    },
    [lang],
  );
  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const token = await getToken();
      const response = await fetch(path, {
        ...init,
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...init.headers,
        },
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || !value || typeof value !== 'object') {
        const code = value?.error?.code ?? 'service_unavailable';
        const err = new Error(
          textError(
            code,
            value?.error?.message ?? 'The shared directory service is unavailable. Please retry.',
          ),
        ) as Error & { code: string };
        err.code = code;
        throw err;
      }
      return value;
    },
    [getToken, textError],
  );
  const readAccess = useCallback(async () => {
    const sequence = ++accessSequence.current;
    const generation = identityGeneration.current;
    if (!userId) {
      clearPrivate();
      setChecking(false);
      return;
    }
    setChecking(true);
    setError('');
    try {
      const status = await api('/api/admin');
      if (!['visitor', 'viewer', 'admin', 'owner'].includes(status.role)) {
        throw new Error(
          textError(
            'service_unavailable',
            'The shared directory service is unavailable. Please retry.',
          ),
        );
      }
      if (sequence !== accessSequence.current || generation !== identityGeneration.current) return;
      if (!status.canRead || status.role === 'visitor') {
        clearPrivate();
        return;
      }
      setRole(status.role);
      setAccessUserId(userId);
      if (status.role === 'owner') {
        const roster = await api('/api/admins');
        if (sequence !== accessSequence.current || generation !== identityGeneration.current)
          return;
        setGrants(roster.administrators);
        setGrantRevision(roster.revision);
      } else {
        setGrants([]);
        setGrantRevision('');
      }
    } catch (err) {
      if (sequence === accessSequence.current && generation === identityGeneration.current) {
        if (['unauthorized', 'forbidden'].includes((err as Error & { code?: string }).code ?? ''))
          clearPrivate();
        else {
          // A temporary service outage hides the directory but preserves this
          // same account's unsaved draft for a successful access retry.
          identityGeneration.current += 1;
          setRole('visitor');
          setAccessUserId(null);
          setChecking(false);
        }
        setError((err as Error).message);
      }
    } finally {
      if (sequence === accessSequence.current && generation === identityGeneration.current)
        setChecking(false);
    }
  }, [api, userId, clearPrivate]);
  useEffect(() => {
    clearPrivate();
  }, [userId, clearPrivate]);
  useEffect(() => {
    if (!loaded) return;
    void readAccess();
    return () => {
      accessSequence.current += 1;
    };
  }, [loaded, userId, readAccess]);
  // Parent refreshes never silently replace an administrator's unsaved draft.
  useEffect(() => {
    if (dirty || !canRead) return;
    const serialized = JSON.stringify(config);
    setDraft(clone(config));
    setBaseline(serialized);
    setBaseRevision(revision);
  }, [config, revision, dirty, canRead]);
  useEffect(() => {
    setPage(1);
  }, [search]);
  useEffect(() => {
    if (role !== 'owner' && tab === 'access') setTab('ap');
  }, [role, tab]);
  const pmRows = useMemo(
    () =>
      Object.entries(draft.pm)
        .filter(([project, name]) =>
          `${project} ${name}`.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    [draft.pm, search],
  );
  const pages = Math.max(1, Math.ceil(pmRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shownPM = pmRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const updateAP = (index: number, field: keyof APEntry, value: string) => {
    setDraft((current) => ({
      ...current,
      ap: current.ap.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
    setSuccess('');
  };
  async function save() {
    const generation = identityGeneration.current;
    setSaving(true);
    setError('');
    setSuccess('');
    setConflict(false);
    try {
      const result = await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ revision: baseRevision, config: draft }),
      });
      if (generation !== identityGeneration.current) return;
      setDraft(clone(result.config));
      setBaseline(JSON.stringify(result.config));
      setBaseRevision(result.revision);
      onSaved(result);
      setSuccess(t.saved);
      if (role === 'owner') {
        const roster = await api('/api/admins');
        if (generation !== identityGeneration.current) return;
        setGrants(roster.administrators);
        setGrantRevision(roster.revision);
      }
    } catch (err) {
      if (generation !== identityGeneration.current) return;
      if (['unauthorized', 'forbidden'].includes((err as Error & { code?: string }).code ?? ''))
        clearPrivate();
      setError((err as Error).message);
      setConflict((err as Error & { code?: string }).code === 'revision_conflict');
    } finally {
      if (generation === identityGeneration.current) setSaving(false);
    }
  }
  async function reloadDirectory() {
    const generation = identityGeneration.current;
    if (
      dirty &&
      !window.confirm(
        tr(
          'Replace your unsaved directory draft with the latest shared version?',
          '用最新共享版本替换未保存的分配草稿？',
        ),
      )
    )
      return;
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      const result = await api('/api/config');
      if (generation !== identityGeneration.current) return;
      setDraft(clone(result.config));
      setBaseline(JSON.stringify(result.config));
      setBaseRevision(result.revision);
      setConflict(false);
      onSaved(result);
      await readAccess();
    } catch (err) {
      if (generation !== identityGeneration.current) return;
      if (['unauthorized', 'forbidden'].includes((err as Error & { code?: string }).code ?? ''))
        clearPrivate();
      setError((err as Error).message);
    } finally {
      if (generation === identityGeneration.current) setSaving(false);
    }
  }
  function addProject() {
    const project = newProject.trim();
    if (!/^\d{1,9}$/.test(project)) {
      setError(tr('Enter a valid whole project number.', '请输入有效的整数项目编号。'));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(draft.pm, project)) {
      setError(
        tr(
          'This project already exists. Search for it to edit its PM.',
          '此项目已存在，请搜索后修改 PM。',
        ),
      );
      return;
    }
    if (!newPM.trim()) {
      setError(tr('Enter a PM name.', '请输入 PM 姓名。'));
      return;
    }
    setDraft((current) => ({ ...current, pm: { ...current.pm, [project]: newPM.trim() } }));
    setNewProject('');
    setNewPM('');
    setSearch(project);
    setSuccess('');
    setError('');
  }
  async function changeGrant(action: 'grant' | 'revoke', user?: Grant) {
    const generation = identityGeneration.current;
    if (
      action === 'revoke' &&
      !window.confirm(
        tr(`Revoke directory access for ${user!.email}?`, `撤销 ${user!.email} 的目录访问权限？`),
      )
    )
      return;
    setGrantBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api('/api/admins', {
        method: 'POST',
        body: JSON.stringify({
          revision: grantRevision,
          action,
          ...(action === 'grant' ? { email, role: grantRole } : { userId: user!.userId }),
        }),
      });
      if (generation !== identityGeneration.current) return;
      setGrants(result.administrators);
      setGrantRevision(result.revision);
      setEmail('');
      // Grants share the same revision as the directory. Keep a dirty draft but advance
      // only its revision after our own successful access change against that revision.
      if (baseRevision === grantRevision) {
        setBaseRevision(result.revision);
        onSaved({ config: JSON.parse(baseline) as Config, revision: result.revision });
      }
      setSuccess(tr('Directory access updated.', '目录访问权限已更新。'));
    } catch (err) {
      if (generation !== identityGeneration.current) return;
      if (['unauthorized', 'forbidden'].includes((err as Error & { code?: string }).code ?? ''))
        clearPrivate();
      setError((err as Error).message);
    } finally {
      if (generation === identityGeneration.current) setGrantBusy(false);
    }
  }
  return (
    <section className="page directory-page">
      <style>{`
      .directory-page .page-heading { display:flex; align-items:center; justify-content:space-between; gap:24px; margin-bottom:26px }
      .directory-page .page-heading h1 { margin:8px 0 10px }
      .directory-page .page-heading p { color:#74849b; line-height:1.7 }
      .directory-actions,.directory-role,.directory-message,.directory-notice,.directory-footer>div { display:flex; align-items:center; gap:9px }
      .directory-actions { flex-wrap:wrap; justify-content:flex-end; flex-shrink:0 }
      .directory-role { padding:7px 10px; border-radius:7px; color:#67809f; background:#edf2f8; font-size:12px }
      .directory-role.owner,.directory-role.admin { color:#2866d7; background:#edf3ff }
      .directory-card { padding:26px; overflow:hidden }
      .directory-intro { display:flex; align-items:flex-start; gap:11px; color:#5d7492; font-size:13px; line-height:1.7 }
      .directory-intro svg { flex-shrink:0; margin-top:3px; color:#2866d7 }
      .directory-intro p { margin:0 }
      .directory-notice,.directory-help { color:#7a8ba2; font-size:12px; line-height:1.8 }
      .directory-dirty { font-size:12px; color:#9a732f; margin:16px 0 }
      .directory-warning { background:#fff8ec; border:1px solid #f1dfb8; color:#976e29; padding:12px 14px; border-radius:7px; font-size:12px; line-height:1.7 }
      .directory-success { background:#eef9f3; border:1px solid #c9e9d6; color:#378260; padding:12px 14px; border-radius:7px; font-size:12px }
      .directory-message { margin:16px 0; align-items:flex-start }
      .directory-message svg { flex-shrink:0; margin-top:2px }
      .directory-tabs { display:flex; gap:26px; border-bottom:1px solid #e6ecf4; margin:24px 0 20px; overflow:auto }
      .directory-tabs button { white-space:nowrap; gap:8px; padding:13px 0; border:0; border-bottom:2px solid transparent; border-radius:0; background:transparent; color:#7b8da5 }
      .directory-tabs button[aria-selected=true] { color:#2866d7; border-bottom-color:#2866d7 }
      .directory-tabs span { border-radius:4px; font-size:10px; padding:2px 6px; background:#edf2f9 }
      .directory-page [hidden] { display:none }
      .directory-table-wrap { overflow:auto; width:100% }
      .directory-page table { width:100%; border-collapse:collapse; text-align:left; font-size:12px }
      .directory-page th { font-size:10px; text-transform:uppercase; color:#8b9bb0; letter-spacing:.6px; background:#f8fafc; padding:13px 12px; border-bottom:1px solid #e8edf5 }
      .directory-page td { padding:13px 12px; border-bottom:1px solid #edf1f6; color:#4a607d; vertical-align:top }
      .directory-page td span { display:block; max-width:330px; overflow-wrap:anywhere; line-height:1.8 }
      .directory-page input,.directory-page select { width:100%; min-width:90px; border:1px solid #dce5f0; border-radius:6px; padding:9px 10px; font-size:12px; background:white; color:#425772 }
      .directory-page th:first-child { min-width:130px }
      .directory-page td:first-child input { min-width:130px }
      .directory-page td:nth-child(2) input { min-width:110px }
      .directory-page td:nth-child(3) input,.directory-page td:nth-child(4) input { min-width:200px }
      .directory-page .icon-button { padding:7px; min-width:32px; color:#a26c6a }
      .directory-section-footer,.directory-footer { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-top:18px }
      .directory-section-footer p,.directory-footer p { color:#8a9ab0; font-size:11px; line-height:1.8; margin:0; max-width:600px }
      .directory-search { display:flex; align-items:center; gap:9px; max-width:340px; margin-bottom:18px; color:#9aacc1 }
      .directory-search input { min-width:0 }
      .directory-pagination { display:flex; align-items:center; justify-content:flex-end; gap:12px; margin:17px 0; font-size:11px; color:#899bb2 }
      .directory-pagination>span:first-child { margin-right:auto }
      .directory-pagination button { font-size:11px; padding:6px 9px; min-height:30px }
      .directory-add { display:flex; gap:12px; align-items:flex-end; padding:16px; margin:18px 0; background:#f8faff; border:1px solid #e6edf7; border-radius:8px }
      .directory-add label { display:grid; gap:7px; font-size:11px; color:#7185a0; flex:1 }
      .directory-add button { flex-shrink:0 }
      .directory-empty { text-align:center; padding:28px!important; color:#98a6b9!important }
      .directory-footer { border-top:1px solid #e8edf5; padding-top:20px; margin-top:22px }
      .directory-footer button { white-space:nowrap }
      .directory-private-gate { text-align:center; padding:44px 18px; color:#7890ac; line-height:1.8 } .directory-private-gate>svg { color:#2866d7 } .directory-private-gate h2 { color:#405b7a; font-size:18px } .directory-private-gate p { max-width:600px; margin:12px auto 24px }
      .directory-page .sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%) }
      @media(max-width:760px) { .directory-page .page-heading { align-items:flex-start; flex-direction:column } .directory-actions { justify-content:flex-start } .directory-card { padding:18px } .directory-footer,.directory-section-footer { align-items:flex-start; flex-direction:column } .directory-footer>div { width:100%; flex-wrap:wrap } .directory-add { flex-wrap:wrap } .directory-add label { flex-basis:150px } .directory-tabs { gap:18px } }
    `}</style>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{t.shared}</p>
          <h1>{t.teamTitle}</h1>
          <p>{t.teamSub}</p>
        </div>
        <div className="directory-actions">
          <span className={`directory-role ${role}`}>
            <ShieldCheck size={15} />
            {checking ? (
              <LoaderCircle size={15} className="spin" />
            ) : role === 'viewer' ? (
              tr('Viewer', '获授权查看者')
            ) : (
              t[role]
            )}
          </span>
          {controls}
          <button onClick={() => void readAccess()} disabled={checking || saving}>
            <RefreshCw size={15} />
            {t.refresh}
          </button>
        </div>
      </div>
      <div className="card directory-card">
        {!canRead ? (
          <div className="directory-private-gate">
            <LockKeyhole size={28} />
            <h2>{tr('Private team directory', '私有团队目录')}</h2>
            <p>
              {checking
                ? tr('Checking directory access…', '正在验证目录权限…')
                : userId
                  ? tr(
                      'Your account has not been granted directory access. Ask the Owner for viewer or administrator permission.',
                      '你的账号尚未获得目录权限，请联系所有者授予查看或管理权限。',
                    )
                  : tr(
                      'Sign in with an authorized account to view team names and project assignments.',
                      '请使用获授权账号登录后查看团队姓名及项目分配。',
                    )}
            </p>
            {error && <p role="alert">{error}</p>}
            {controls}
          </div>
        ) : (
          <>
            <div className="directory-intro">
              <Users size={20} />
              <p>{t.directoryHelp}</p>
            </div>
            {!canEdit && (
              <p className="directory-notice">
                <LockKeyhole size={15} />
                {tr(
                  'Read-only access. Only the Owner and administrators can edit this private directory.',
                  '只读权限；仅所有者和管理员可以编辑此私有目录。',
                )}
              </p>
            )}
            {dirty && (
              <p className="directory-dirty" role="status">
                {tr('You have unsaved directory changes.', '你有尚未保存的分配修改。')}
              </p>
            )}
            {String(revision) !== String(baseRevision) && dirty && (
              <p className="directory-warning">
                {tr(
                  'A newer shared directory is available. Your draft is preserved; reload it before saving.',
                  '共享分配已有更新。草稿已保留，请载入最新版本后再保存。',
                )}
              </p>
            )}
            {error && (
              <div className="directory-message directory-warning" role="alert">
                <AlertCircle size={17} />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="directory-message directory-success" role="status">
                <CheckCircle2 size={17} />
                {success}
              </div>
            )}
            {conflict && (
              <button onClick={() => void reloadDirectory()} disabled={saving}>
                {tr('Load latest shared directory', '载入最新共享分配')}
              </button>
            )}
            <div className="directory-tabs" role="tablist" aria-label={t.directory}>
              <button
                role="tab"
                aria-selected={tab === 'ap'}
                aria-controls="directory-ap"
                id="directory-tab-ap"
                onClick={() => setTab('ap')}
              >
                {t.apRules}
                <span>{draft.ap.length}</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'pm'}
                aria-controls="directory-pm"
                id="directory-tab-pm"
                onClick={() => setTab('pm')}
              >
                {t.pmMap}
                <span>{Object.keys(draft.pm).length}</span>
              </button>
              {role === 'owner' && (
                <button
                  role="tab"
                  aria-selected={tab === 'access'}
                  aria-controls="directory-access"
                  id="directory-tab-access"
                  onClick={() => setTab('access')}
                >
                  {t.admins}
                </button>
              )}
            </div>
            <div
              role="tabpanel"
              id="directory-ap"
              aria-labelledby="directory-tab-ap"
              hidden={tab !== 'ap'}
            >
              <div className="directory-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t.name}</th>
                      <th>{t.portfolio}</th>
                      <th>{t.include}</th>
                      <th>{t.exclude}</th>
                      {canEdit && (
                        <th>
                          <span className="sr-only">{t.remove}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.ap.map((entry, index) => (
                      <tr key={index}>
                        {(['Name', 'Portfolio', 'Include', 'Exclude'] as const).map((field) => (
                          <td key={field}>
                            {canEdit ? (
                              <input
                                aria-label={`${t.apRules} ${index + 1}: ${field}`}
                                value={entry[field]}
                                onChange={(event) => updateAP(index, field, event.target.value)}
                                disabled={saving}
                              />
                            ) : (
                              <span>{entry[field] || '—'}</span>
                            )}
                          </td>
                        ))}
                        {canEdit && (
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`${t.remove} ${entry.Name || index + 1}`}
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  ap: current.ap.filter((_, i) => i !== index),
                                }))
                              }
                              disabled={saving || draft.ap.length === 1}
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="directory-section-footer">
                <p>
                  {tr(
                    'Portfolio examples: 5528-5626, 5791+, or 5200. Separate explicit projects with commas.',
                    '范围示例：5528-5626、5791+ 或 5200；额外包含及排除项目以逗号分隔。',
                  )}
                </p>
                {canEdit && (
                  <button
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        ap: [...current.ap, { Name: '', Portfolio: '', Include: '', Exclude: '' }],
                      }))
                    }
                    disabled={saving}
                  >
                    <Plus size={15} />
                    {t.addRule}
                  </button>
                )}
              </div>
            </div>
            <div
              role="tabpanel"
              id="directory-pm"
              aria-labelledby="directory-tab-pm"
              hidden={tab !== 'pm'}
            >
              <label className="directory-search">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tr('Search project or PM…', '搜索项目或 PM…')}
                  aria-label={tr('Search project or PM', '搜索项目或 PM')}
                />
              </label>
              <div className="directory-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t.project}</th>
                      <th>{t.name}</th>
                      {canEdit && (
                        <th>
                          <span className="sr-only">{t.remove}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {shownPM.map(([project, name]) => (
                      <tr key={project}>
                        <td>{project}</td>
                        <td>
                          {canEdit ? (
                            <input
                              aria-label={`${project} PM`}
                              value={name}
                              disabled={saving}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDraft((current) => ({
                                  ...current,
                                  pm: { ...current.pm, [project]: value },
                                }));
                                setSuccess('');
                              }}
                            />
                          ) : (
                            name || '—'
                          )}
                        </td>
                        {canEdit && (
                          <td>
                            <button
                              className="icon-button"
                              aria-label={`${t.remove} ${project}`}
                              disabled={saving}
                              onClick={() =>
                                setDraft((current) => {
                                  const pm = { ...current.pm };
                                  delete pm[project];
                                  return { ...current, pm };
                                })
                              }
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                    {!shownPM.length && (
                      <tr>
                        <td colSpan={canEdit ? 3 : 2} className="directory-empty">
                          {t.noRows}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="directory-pagination">
                <span>
                  {pmRows.length} {tr('projects', '个项目')}
                </span>
                <button onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1}>
                  {t.previous}
                </button>
                <span>
                  {currentPage} / {pages}
                </span>
                <button onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pages}>
                  {t.next}
                </button>
              </div>
              {canEdit && (
                <div className="directory-add">
                  <label>
                    {t.project}
                    <input
                      value={newProject}
                      onChange={(event) => setNewProject(event.target.value)}
                      inputMode="numeric"
                      placeholder="5749"
                      disabled={saving}
                    />
                  </label>
                  <label>
                    PM {t.name}
                    <input
                      value={newPM}
                      onChange={(event) => setNewPM(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <button onClick={addProject} disabled={saving}>
                    <Plus size={15} />
                    {t.addProject}
                  </button>
                </div>
              )}
            </div>
            {role === 'owner' && (
              <div
                role="tabpanel"
                id="directory-access"
                aria-labelledby="directory-tab-access"
                hidden={tab !== 'access'}
              >
                <p className="directory-help">
                  {tr(
                    'Only the Owner can grant private directory access. Viewer can read assignments; administrator can also edit them. Enter an existing account’s verified primary email. Granting again changes its role.',
                    '只有所有者可以授予私有目录权限。查看者可读取分配，管理员还可编辑。请输入现有账号已验证的主要邮箱；再次授权可修改角色。',
                  )}
                </p>
                <p className="directory-help">
                  {tr(
                    'The fixed Owner cannot be revoked here. Directory drafts are preserved when access changes.',
                    '固定所有者无法在此撤销；修改访问权限时会保留分配草稿。',
                  )}
                </p>
                <div className="directory-add">
                  <label>
                    {t.email}
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={grantBusy}
                      placeholder="name@example.com"
                    />
                  </label>
                  <label>
                    {tr('Access role', '访问角色')}
                    <select
                      value={grantRole}
                      onChange={(event) => setGrantRole(event.target.value as 'viewer' | 'admin')}
                      disabled={grantBusy}
                    >
                      <option value="viewer">{tr('Viewer (read only)', '查看者（只读）')}</option>
                      <option value="admin">
                        {tr('Administrator (read and edit)', '管理员（读写）')}
                      </option>
                    </select>
                  </label>
                  <button
                    onClick={() => void changeGrant('grant')}
                    disabled={grantBusy || !email.trim()}
                  >
                    <Plus size={15} />
                    {tr('Grant / update access', '授予／更新权限')}
                  </button>
                </div>
                <div className="directory-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.email}</th>
                        <th>{tr('Role', '角色')}</th>
                        <th>{tr('Granted', '授权时间')}</th>
                        <th>{t.admins}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grants.map((grant) => (
                        <tr key={grant.userId}>
                          <td>{grant.email}</td>
                          <td>{grant.role === 'viewer' ? tr('Viewer', '查看者') : t.admin}</td>
                          <td>
                            {new Date(grant.addedAt).toLocaleString(
                              lang === 'zh' ? 'zh-CN' : 'en-CA',
                            )}
                          </td>
                          <td>
                            <button
                              onClick={() => void changeGrant('revoke', grant)}
                              disabled={grantBusy}
                            >
                              {t.revoke}
                            </button>
                          </td>
                        </tr>
                      ))}
                      {!grants.length && (
                        <tr>
                          <td colSpan={4} className="directory-empty">
                            {tr('No additional authorized accounts.', '尚无其他获授权账号。')}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="directory-footer">
              <p>
                {tr(
                  'Team names and project assignments are private and visible only to authorized accounts. Invoice files are never stored here.',
                  '团队姓名及项目分配为私有数据，仅供获授权账号查看；此处不会保存发票文件。',
                )}
              </p>
              <div>
                <button onClick={() => void reloadDirectory()} disabled={saving || grantBusy}>
                  <RefreshCw size={15} />
                  {tr('Load latest', '载入最新')}
                </button>
                {canEdit && (
                  <button
                    className="primary"
                    onClick={() => void save()}
                    disabled={!dirty || saving || grantBusy}
                  >
                    {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}
                    {saving ? t.saving : t.save}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
