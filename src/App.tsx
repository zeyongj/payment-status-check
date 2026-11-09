import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileCheck2,
  FileSpreadsheet,
  GitCompareArrows,
  Globe2,
  Info,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  buildSummary,
  DEFAULT_AP,
  DEFAULT_PM,
  DEFAULT_SETTINGS,
  downloadSummary,
  externalStatus,
} from './lib';
import type {
  ExtractOptions,
  MatchResult,
  MatchSettings,
  ParsedFile,
  ReviewSelections,
  SummaryRow,
} from './lib';
import { words, type Lang } from './i18n';
import { useIdentity } from './main';
import { UploadPanel, makeInput, recordsFrom, type InputState } from './components/UploadPanel';
import { Modal } from './components/Modal';
import { Guide } from './components/Guide';
import Directory from './components/Directory';

type Page = 'workbench' | 'results' | 'directory' | 'guide';
type Config = Pick<MatchSettings, 'ap' | 'pm'>;

function demoFiles(): [ParsedFile, ParsedFile] {
  return [
    {
      name: 'sample-vendor-statement.xlsx',
      encoding: 'Sample data',
      warnings: [],
      sheets: [
        {
          name: 'Outstanding invoices',
          rows: [
            ['Invoices', 'Project number', 'Balance', 'Notes'],
            ['DEMO-001', '5500', '125.00', ''],
            ['DEMO-002', '5500', '360.00', ''],
            ['DEMO-003', '', '250.00', 'Split between projects'],
            ['DEMO-004', '5500', '80.00', ''],
            ['DEMO-005', '5500', '95.00', ''],
            ['DEMO-006', '5500', '120.00', ''],
          ],
        },
      ],
    },
    {
      name: 'sample-inqflow-export.csv',
      encoding: 'Sample data',
      warnings: [],
      sheets: [
        {
          name: 'Inqflow',
          rows: [
            ['Invoice No', 'Company', 'Stage', 'Status', 'Invoice Notes'],
            ['DEMO-001.', '[5500] Sample building', 'PAID', '', 'Payment reference: sample only'],
            ['DEMO-002', '[5500] Sample building', 'AP', '', 'Ready for the payment team'],
            ['DEMO-003 [5500]', '[5500] Sample building', 'PAID', '', 'Project component A'],
            ['DEMO-003 [5501]', '[5501] Sample building', 'PM', '', 'Project component B'],
            ['DEMO-004', '[5500] Sample building', 'SCAN', '', 'Please provide the work order.'],
            ['DEMO-005', '[5500] Sample building', 'PAID', '', 'First source record'],
            ['DEMO-005', '[5500] Sample building', 'PM', '', 'Conflicting source record'],
          ],
        },
      ],
    },
  ];
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem('invoice-check-language') === 'zh' ? 'zh' : 'en';
    } catch {
      return 'en';
    }
  });
  const t = words[lang],
    identity = useIdentity();
  const [page, setPage] = useState<Page>('workbench'),
    [statement, setStatement] = useState<InputState | null>(null),
    [system, setSystem] = useState<InputState | null>(null);
  const [settings, setSettings] = useState<MatchSettings>({
    ...DEFAULT_SETTINGS,
    autoAcceptFuzzy: true,
  });
  const [options, setOptions] = useState<ExtractOptions>({
    outstandingOnly: true,
    includeCreditNotes: false,
  });
  const [config, setConfig] = useState<Config>({ ap: DEFAULT_AP, pm: DEFAULT_PM }),
    [revision, setRevision] = useState<string | number>('initial'),
    [shared, setShared] = useState(false),
    [sharedLoading, setSharedLoading] = useState(true),
    [sharedFailed, setSharedFailed] = useState(false),
    [configRetry, setConfigRetry] = useState(0),
    [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [results, setResults] = useState<MatchResult[]>([]),
    [selections, setSelections] = useState<ReviewSelections>({}),
    [busy, setBusy] = useState(false),
    [stale, setStale] = useState(false),
    [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [warnings, setWarnings] = useState<string[]>([]),
    [view, setView] = useState<'internal' | 'external'>('internal');
  const [search, setSearch] = useState(''),
    [statusFilter, setStatusFilter] = useState(''),
    [audit, setAudit] = useState(false),
    [tablePage, setTablePage] = useState(1),
    [reviewOpen, setReviewOpen] = useState(false),
    [reviewId, setReviewId] = useState(''),
    [candidateIds, setCandidateIds] = useState<string[]>([]),
    [reviewSearch, setReviewSearch] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const lastIdentity = useRef<string | null>(null);
  const cancelRun = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
  };

  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-Hans';
    try {
      localStorage.setItem('invoice-check-language', lang);
    } catch {
      /* preference storage may be disabled */
    }
  }, [lang]);
  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    const controller = new AbortController();
    if (!identity.loaded) return () => controller.abort();
    const identityKey = identity.userId || 'anonymous';
    if (lastIdentity.current !== identityKey) {
      lastIdentity.current = identityKey;
      cancelRun();
      setConfig({ ap: [], pm: {} });
      setResults([]);
      setSelections({});
      setReviewOpen(false);
      setShared(false);
      setRevision('initial');
    }
    setSharedLoading(true);
    setSharedFailed(false);
    const readDirectory = async () => {
      if (!identity.userId) {
        setSharedLoading(false);
        return;
      }
      const token = await identity.getToken();
      if (!token) throw Error('unauthorized');
      const headers = { authorization: `Bearer ${token}` };
      const accessResponse = await fetch('/api/admin', { headers, signal: controller.signal });
      if (!accessResponse.ok) throw Error('unavailable');
      const access = await accessResponse.json();
      if (!access.canRead) throw Error('forbidden');
      const response = await fetch('/api/config', { headers, signal: controller.signal });
      if (!response.ok) throw Error(response.status === 403 ? 'forbidden' : 'unavailable');
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!data.config?.ap || !data.config?.pm) throw Error('invalid');
      cancelRun();
      setStale(true);
      setConfig(data.config);
      setRevision(data.revision);
      setShared(true);
      setSharedLoading(false);
    };
    void readDirectory().catch((e) => {
      if (e.name !== 'AbortError') {
        if (controller.signal.aborted) return;
        cancelRun();
        setConfig({ ap: [], pm: {} });
        setResults([]);
        setSelections({});
        setReviewOpen(false);
        setShared(false);
        setSharedFailed(e.message !== 'forbidden');
        setSharedLoading(false);
      }
    });
    return () => controller.abort();
  }, [configRetry, identity.loaded, identity.userId, identity.getToken]);
  const invalidate = () => {
    cancelRun();
    if (results.length) setStale(true);
    setNotice('');
    setError('');
  };
  const updateSetting = <K extends keyof MatchSettings>(key: K, value: MatchSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    invalidate();
  };
  const statementExtract = useMemo(
    () => recordsFrom(statement, 'statement', options),
    [statement, options],
  );
  const systemExtract = useMemo(() => recordsFrom(system, 'system', options), [system, options]);
  const rows = useMemo(() => buildSummary(results, view, selections), [results, view, selections]);
  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!statusFilter || row.Status === statusFilter) &&
          (!search || Object.values(row).join(' ').toLowerCase().includes(search.toLowerCase())),
      ),
    [rows, search, statusFilter],
  );
  const statuses = useMemo(() => [...new Set(rows.map((r) => r.Status))].sort(), [rows]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / 50));
  useEffect(() => setTablePage(1), [search, statusFilter, view, results, selections]);
  const metrics = results.reduce(
    (count, result) => {
      const decision = selections[result.id];
      const state = decision ? (decision.length ? 'matched' : 'missing') : result.resolution;
      count[state]++;
      return count;
    },
    { matched: 0, review: 0, missing: 0 },
  );
  const selectedReview = results.find((r) => r.id === reviewId);
  const changeReview = useCallback(
    (result: MatchResult) => {
      setReviewId(result.id);
      setCandidateIds(selections[result.id] ?? result.accepted.map((c) => c.id));
    },
    [selections],
  );

  const run = () => {
    setError('');
    setNotice('');
    if (!statementExtract.records.length || !systemExtract.records.length) {
      setError(
        lang === 'en'
          ? 'Both files need at least one mapped invoice row. Open the column mapping to check the header and invoice column.'
          : '两份文件都需要至少一条有效发票记录，请检查表头和发票列映射。',
      );
      return;
    }
    setBusy(true);
    setWarnings([...statementExtract.warnings, ...systemExtract.warnings]);
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./reconcile.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      if (workerRef.current !== worker) return;
      setBusy(false);
      worker.terminate();
      workerRef.current = null;
      if (event.data.error) {
        setError(event.data.error);
        return;
      }
      setResults(event.data.results);
      setSelections({});
      setStale(false);
      setPage('results');
      setTablePage(1);
      setSearch('');
      setStatusFilter('');
    };
    worker.onerror = () => {
      if (workerRef.current !== worker) return;
      setBusy(false);
      worker.terminate();
      workerRef.current = null;
      setError(
        lang === 'en'
          ? 'The reconciliation could not finish. Try fewer rows or a stricter similarity threshold.'
          : '核对未能完成，请减少记录数或提高相似度阈值。',
      );
    };
    worker.postMessage({
      requested: statementExtract.records,
      system: systemExtract.records,
      settings: { ...settings, ...config },
    });
  };
  const loadDemo = () => {
    cancelRun();
    setWorkspaceVersion((v) => v + 1);
    const [a, b] = demoFiles();
    setStatement(makeInput(a));
    setSystem(makeInput(b));
    setIsDemo(true);
    setResults([]);
    setSelections({});
    setStale(false);
    setError('');
    setNotice('');
    setPage('workbench');
  };
  const clear = () => {
    cancelRun();
    setWorkspaceVersion((v) => v + 1);
    setStatement(null);
    setSystem(null);
    setResults([]);
    setSelections({});
    setWarnings([]);
    setStale(false);
    setIsDemo(false);
    setPage('workbench');
    setError('');
    setNotice(t.reset);
    setReviewOpen(false);
    setReviewId('');
    setCandidateIds([]);
    setReviewSearch('');
    setSearch('');
    setStatusFilter('');
  };
  const exportFile = (format: 'csv' | 'xlsx') => {
    try {
      downloadSummary(rows, view, format);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const navItems = [
    { key: 'workbench', icon: LayoutDashboard },
    { key: 'results', icon: FileCheck2 },
    { key: 'directory', icon: Users },
    { key: 'guide', icon: BookOpen },
  ] as const;
  const statusClass = (status: string) => {
    const s = status.toUpperCase();
    return s === 'PAID'
      ? 'paid'
      : s === 'MISSING'
        ? 'missing'
        : s === 'NEEDS REVIEW' || s === 'UNKNOWN'
          ? 'review'
          : ['AP', 'APPROVED', 'IN-PAYABLE', 'APPROVED FOR PAYMENT'].includes(s)
            ? 'approved'
            : 'pending';
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage('workbench');
          }}
        >
          <span className="brand-icon">
            <FileCheck2 size={24} />
          </span>
          <span>
            Invoice<span>Check</span>
            <small>{t.workspace}</small>
          </span>
        </a>
        <div className="top-actions">
          <span className="private-pill">
            <LockKeyhole size={13} />
            {t.local}
          </span>
          <button
            className="language"
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            aria-label={lang === 'en' ? 'Switch to Chinese' : '切换为英语'}
          >
            <Globe2 size={16} />
            {lang === 'en' ? '中文' : 'English'}
          </button>
          {identity.controls}
        </div>
      </header>
      <nav className="main-nav" aria-label={lang === 'en' ? 'Main navigation' : '主导航'}>
        {navItems.map(({ key, icon: Icon }) => (
          <button
            key={key}
            className={page === key ? 'active' : ''}
            onClick={() => {
              setPage(key);
              setError('');
            }}
            aria-current={page === key ? 'page' : undefined}
          >
            <Icon size={17} />
            {t[key]}
            {key === 'results' && results.length > 0 && (
              <span className="nav-count">{results.length}</span>
            )}
          </button>
        ))}
        <span className="nav-right">
          <span className={`status-dot ${shared ? '' : 'gray'}`} />
          {sharedLoading
            ? lang === 'en'
              ? 'Loading directory…'
              : '正在加载分配…'
            : shared
              ? t.shared
              : t.defaults}
        </span>
      </nav>
      <main>
        {sharedFailed && (
          <div className="alert warning" role="status">
            <Info size={17} />
            <p>{t.loadError}</p>
            <button className="small" onClick={() => setConfigRetry((n) => n + 1)}>
              {t.refresh}
            </button>
          </div>
        )}
        {!shared && !sharedLoading && !sharedFailed && (
          <div className="alert" role="status">
            <LockKeyhole size={17} />
            <p>
              {identity.userId
                ? lang === 'en'
                  ? 'This account has no directory access. Ask the owner for viewer or administrator access. File reconciliation remains available.'
                  : '此账号尚无目录权限。请联系 owner 授予查看或管理权限，文件核对功能仍可使用。'
                : lang === 'en'
                  ? 'Sign in with an authorized account to include private AP and PM assignments. You can check invoices without signing in.'
                  : '使用获授权的账号登录后，汇总可包含私有 AP/PM 分配。未登录时仍可查询发票。'}
            </p>
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            <Info size={19} />
            <div>
              <strong>{t.error}</strong>
              <p>{error}</p>
            </div>
            <button className="icon-button" onClick={() => setError('')} aria-label={t.close}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            <Check size={18} />
            <p>{notice}</p>
            <button className="icon-button" onClick={() => setNotice('')} aria-label={t.close}>
              <X size={16} />
            </button>
          </div>
        )}
        {page === 'workbench' && (
          <>
            <div className="page-heading hero-heading">
              <div>
                <span className="eyebrow">
                  <span />
                  {lang === 'en' ? 'PAYMENT STATUS WORKSPACE' : '付款状态工作空间'}
                </span>
                <h1>{t.headline}</h1>
                <p>{t.subtitle}</p>
              </div>
              <button onClick={loadDemo}>
                <Sparkles size={16} />
                {t.demo}
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="workflow-track">
              <span className="current">
                <b>1</b>
                {t.step1}
              </span>
              <i />
              <span>
                <b>2</b>
                {t.step2}
              </span>
              <i />
              <span>
                <b>3</b>
                {t.step3}
              </span>
            </div>
            {isDemo && (
              <div className="demo-banner">
                <Sparkles size={15} />
                {t.demoLabel} ·{' '}
                {lang === 'en'
                  ? 'Fictional invoices for exploring the workflow.'
                  : '用于体验流程的虚构发票。'}
                <button className="text-button" onClick={clear}>
                  {t.clear}
                </button>
              </div>
            )}
            <div className="workbench-grid">
              <div className="workspace-left">
                <div className="upload-grid">
                  <UploadPanel
                    key={`statement-${workspaceVersion}`}
                    lang={lang}
                    kind="statement"
                    value={statement}
                    onChange={(v) => {
                      setStatement(v);
                      setIsDemo(false);
                      invalidate();
                    }}
                    onError={setError}
                    options={options}
                  />
                  <UploadPanel
                    key={`system-${workspaceVersion}`}
                    lang={lang}
                    kind="system"
                    value={system}
                    onChange={(v) => {
                      setSystem(v);
                      setIsDemo(false);
                      invalidate();
                    }}
                    onError={setError}
                    options={options}
                  />
                </div>
                <section className="card preferences">
                  <div className="section-title">
                    <Settings2 size={18} />
                    <div>
                      <h3>{t.rules}</h3>
                      <p>{t.rulesSub}</p>
                    </div>
                  </div>
                  <div className="rule-grid">
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={settings.ignoreCase}
                        onChange={(e) => updateSetting('ignoreCase', e.target.checked)}
                      />
                      {t.case}
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={settings.normalizePunctuation}
                        onChange={(e) => updateSetting('normalizePunctuation', e.target.checked)}
                      />
                      {lang === 'en' ? 'Clean commas & trailing dots' : '清理逗号和末尾的点'}
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={settings.splitProjects}
                        onChange={(e) => updateSetting('splitProjects', e.target.checked)}
                      />
                      {t.split}
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={settings.fuzzy}
                        onChange={(e) => updateSetting('fuzzy', e.target.checked)}
                      />
                      {t.fuzzy}
                    </label>
                  </div>
                  <p className="field-help">{t.splitHelp}</p>
                  {settings.fuzzy && (
                    <div className="fuzzy-settings">
                      <div className="range-setting">
                        <label htmlFor="similarity">
                          {t.threshold}
                          <strong>{settings.fuzzyThreshold}%</strong>
                        </label>
                        <input
                          id="similarity"
                          type="range"
                          min="50"
                          max="100"
                          value={settings.fuzzyThreshold}
                          onChange={(e) => updateSetting('fuzzyThreshold', Number(e.target.value))}
                        />
                        <p>{t.thresholdHelp}</p>
                      </div>
                      <div className="auto-settings">
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={settings.autoAcceptFuzzy}
                            onChange={(e) => updateSetting('autoAcceptFuzzy', e.target.checked)}
                          />
                          {t.autoFuzzy}
                        </label>
                        <label className="inline-field">
                          {t.margin}
                          <input
                            type="number"
                            min="0"
                            max="25"
                            value={settings.fuzzyMargin}
                            onChange={(e) =>
                              updateSetting(
                                'fuzzyMargin',
                                Math.min(25, Math.max(0, Number(e.target.value))),
                              )
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}
                  <details className="advanced">
                    <summary>
                      {lang === 'en' ? 'Extraction & custom format' : '提取及自定义格式'}
                    </summary>
                    <div className="rule-grid">
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={options.outstandingOnly}
                          onChange={(e) => {
                            setOptions((o) => ({ ...o, outstandingOnly: e.target.checked }));
                            invalidate();
                          }}
                        />
                        {t.outstanding}
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={options.includeCreditNotes}
                          onChange={(e) => {
                            setOptions((o) => ({ ...o, includeCreditNotes: e.target.checked }));
                            invalidate();
                          }}
                        />
                        {t.credit}
                      </label>
                    </div>
                    <p className="field-help">{t.outstandingHelp}</p>
                    <label>
                      {t.template}
                      <input
                        type="text"
                        maxLength={160}
                        placeholder="{invoice} [{project}]"
                        value={settings.customTemplate}
                        onChange={(e) => updateSetting('customTemplate', e.target.value)}
                      />
                    </label>
                    <p className="field-help">{t.templateHelp}</p>
                  </details>
                </section>
                <div className="run-bar">
                  <p>
                    <ShieldCheck size={15} />
                    {t.local}
                  </p>
                  <button
                    className="primary run-button"
                    disabled={!statement || !system || busy}
                    onClick={run}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <GitCompareArrows size={17} />
                    )}{' '}
                    {busy ? t.running : t.run}
                    {!busy && <ArrowRight size={16} />}
                  </button>
                </div>
                <p className="run-help">{t.runHelp}</p>
              </div>
              <aside className="workspace-right">
                <div className="outcome-card">
                  <div className="invoice-art" aria-hidden="true">
                    <div className="art-dot a" />
                    <div className="art-dot b" />
                    <div className="paper back" />
                    <div className="paper front">
                      <FileSpreadsheet size={22} />
                      <i />
                      <i />
                      <i />
                      <span>
                        <CheckCheck size={22} />
                      </span>
                    </div>
                    <div className="art-tag">
                      <span />
                      {lang === 'en' ? 'Ready to reconcile' : '准备开始核对'}
                    </div>
                  </div>
                  <h2>{t.ready}</h2>
                  <p>{t.readySub}</p>
                  <div className="outcome-feature">
                    <GitCompareArrows size={18} />
                    <div>
                      <h4>{t.precise}</h4>
                      <p>{t.preciseSub}</p>
                    </div>
                  </div>
                  <div className="outcome-feature">
                    <Users size={18} />
                    <div>
                      <h4>{t.splitTitle}</h4>
                      <p>{t.splitSub}</p>
                    </div>
                  </div>
                  <div className="outcome-feature">
                    <Download size={18} />
                    <div>
                      <h4>{t.exportTitle}</h4>
                      <p>{t.exportSub}</p>
                    </div>
                  </div>
                </div>
                <button className="help-link" onClick={() => setPage('guide')}>
                  <CircleHelp size={16} />
                  {lang === 'en'
                    ? 'First time here? Read the quick guide'
                    : '首次使用？查看快速指南'}
                  <ArrowRight size={14} />
                </button>
              </aside>
            </div>
          </>
        )}
        {page === 'results' && (
          <>
            <div className="page-heading hero-heading">
              <div>
                <span className="eyebrow">{t.step3}</span>
                <h1>{t.summaryTitle}</h1>
                <p>{t.summarySub}</p>
              </div>
              <button onClick={() => setPage('workbench')}>
                <ChevronLeft size={16} />
                {t.workbench}
              </button>
            </div>
            {!results.length ? (
              <div className="card empty-state">
                <FileCheck2 size={40} />
                <h2>{t.noResults}</h2>
                <p>{t.noResultsSub}</p>
                <button className="primary" onClick={() => setPage('workbench')}>
                  {t.workbench}
                  <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <>
                {stale && (
                  <div className="alert warning">
                    <Info size={18} />
                    <p>{t.changed}</p>
                    <button className="small primary" disabled={busy} onClick={run}>
                      {t.run}
                    </button>
                  </div>
                )}
                <div className="metric-grid">
                  {(
                    [
                      { key: 'requests', value: results.length },
                      { key: 'matched', value: metrics.matched },
                      { key: 'review', value: metrics.review },
                      { key: 'missing', value: metrics.missing },
                    ] as const
                  ).map(({ key, value }) => (
                    <div className={`card metric ${key}`} key={key}>
                      <span>{t[key]}</span>
                      <strong>{value.toLocaleString()}</strong>
                      <div className="metric-line" />
                    </div>
                  ))}
                </div>
                <section className="card results-card">
                  <div className="results-header">
                    <div className="segmented">
                      <button
                        className={view === 'internal' ? 'active' : ''}
                        onClick={() => {
                          setView('internal');
                          setStatusFilter('');
                        }}
                      >
                        {t.internal}
                      </button>
                      <button
                        className={view === 'external' ? 'active' : ''}
                        onClick={() => {
                          setView('external');
                          setStatusFilter('');
                        }}
                      >
                        {t.external}
                      </button>
                    </div>
                    <div className="export-actions">
                      <button className="small" disabled={stale} onClick={() => exportFile('csv')}>
                        <Download size={15} />
                        {t.downloadCSV}
                      </button>
                      <button
                        className="primary small"
                        disabled={stale}
                        onClick={() => exportFile('xlsx')}
                      >
                        <FileSpreadsheet size={15} />
                        {t.downloadXLSX}
                      </button>
                    </div>
                  </div>
                  <p className="summary-help">
                    <Info size={14} />
                    {view === 'internal' ? t.internalHelp : t.externalHelp}
                  </p>
                  <div className="table-toolbar">
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t.search}
                        aria-label={t.search}
                      />
                    </div>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      aria-label={t.status}
                    >
                      <option value="">{t.all}</option>
                      {statuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <button
                      className="small"
                      onClick={() => {
                        setReviewOpen(true);
                        const target =
                          results.find((r) => r.resolution === 'review' && !selections[r.id]) ||
                          results[0];
                        changeReview(target);
                      }}
                    >
                      <GitCompareArrows size={15} />
                      {t.exceptions}
                      {metrics.review > 0 && <span className="count-pill">{metrics.review}</span>}
                    </button>
                  </div>
                  {view === 'internal' && (
                    <label className="audit-toggle check-label">
                      <input
                        type="checkbox"
                        checked={audit}
                        onChange={(e) => setAudit(e.target.checked)}
                      />
                      {t.audit}
                    </label>
                  )}
                  <div className="table-scroll">
                    <table className="summary-table">
                      <thead>
                        <tr>
                          <th>{t.invoice}</th>
                          {(view === 'internal' || rows.some((r) => r['Project number'])) && (
                            <th>{t.project}</th>
                          )}
                          <th>{view === 'internal' ? `${t.internal} · ${t.status}` : t.status}</th>
                          {view === 'internal' && (
                            <>
                              <th>
                                {t.external} · {t.status}
                              </th>
                              <th>AP</th>
                              <th>PM</th>
                            </>
                          )}
                          <th>{t.notes}</th>
                          {audit && view === 'internal' && (
                            <>
                              <th>{lang === 'en' ? 'Matched invoice' : '匹配号码'}</th>
                              <th>{lang === 'en' ? 'Method / score' : '方式 / 分数'}</th>
                              <th>{t.source}</th>
                              <th>{lang === 'en' ? 'Stage / Status' : '原始阶段 / 状态'}</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRows
                          .slice((tablePage - 1) * 50, tablePage * 50)
                          .map((row, index) => (
                            <tr key={`${index}-${tablePage}`}>
                              <td className="invoice-cell">{row.Invoice}</td>
                              {(view === 'internal' || rows.some((r) => r['Project number'])) && (
                                <td className="mono">{row['Project number'] || '—'}</td>
                              )}
                              <td>
                                <span className={`badge ${statusClass(row.Status)}`}>
                                  {row.Status}
                                </span>
                              </td>
                              {view === 'internal' && (
                                <>
                                  <td>
                                    <span
                                      className={`badge ${statusClass(externalStatus(row.Status))}`}
                                    >
                                      {externalStatus(row.Status)}
                                    </span>
                                  </td>
                                  <td>{row['AP name'] || '—'}</td>
                                  <td>{row['PM name'] || '—'}</td>
                                </>
                              )}
                              <td className="notes-cell">{row.Notes || '—'}</td>
                              {audit && view === 'internal' && (
                                <>
                                  <td className="mono">{row['Matched invoice'] || '—'}</td>
                                  <td>
                                    {row['Match method']}
                                    <small>
                                      {row['Match score'] || 0}% · {row.Review}
                                    </small>
                                  </td>
                                  <td>
                                    {row['Source file']}
                                    <small>
                                      {row['Source sheet']} · {row['Source row'] || '—'}
                                    </small>
                                  </td>
                                  <td>
                                    {row['Original stage'] || '—'} / {row['Original status'] || '—'}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {!filteredRows.length && <div className="table-empty">{t.noRows}</div>}
                  </div>
                  <div className="table-footer">
                    <span>
                      {filteredRows.length.toLocaleString()} {t.components}
                    </span>
                    <div>
                      <button
                        className="icon-button"
                        disabled={tablePage <= 1}
                        onClick={() => setTablePage((p) => p - 1)}
                        aria-label={t.previous}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span>
                        {t.page} {tablePage} {t.of} {pageCount}
                      </span>
                      <button
                        className="icon-button"
                        disabled={tablePage >= pageCount}
                        onClick={() => setTablePage((p) => p + 1)}
                        aria-label={t.next}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                </section>
                <p className="download-note">{t.downloadNote}</p>
                {warnings.length > 0 && (
                  <details className="card extraction-notes">
                    <summary>
                      {lang === 'en' ? 'Import notes' : '导入说明'} ({warnings.length})
                    </summary>
                    {warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </details>
                )}
              </>
            )}
          </>
        )}
        <div hidden={page !== 'directory'}>
          <Directory
            lang={lang}
            config={config}
            revision={revision}
            onSaved={(data) => {
              setConfig(data.config);
              setRevision(data.revision);
              setShared(true);
              invalidate();
            }}
          />
        </div>
        {page === 'guide' && <Guide lang={lang} />}
      </main>
      <footer>
        <span>
          InvoiceCheck <span>·</span> {t.footer}
        </span>
        <div>
          <span className="status-dot" />
          {t.local}
          {(statement || system) && (
            <button className="text-button" onClick={clear}>
              {t.clear}
            </button>
          )}
        </div>
      </footer>
      {reviewOpen && (
        <Modal title={t.reviewMatch} onClose={() => setReviewOpen(false)} wide>
          <p className="muted">{t.exceptionHelp}</p>
          <div className="review-layout">
            <div className="review-list">
              <div className="search-field">
                <Search size={15} />
                <input
                  aria-label={t.search}
                  placeholder={t.search}
                  value={reviewSearch}
                  onChange={(e) => setReviewSearch(e.target.value)}
                />
              </div>
              <div className="review-items">
                {results
                  .filter(
                    (r) =>
                      !reviewSearch ||
                      `${r.request.invoice} ${r.request.project}`
                        .toLowerCase()
                        .includes(reviewSearch.toLowerCase()),
                  )
                  .slice(0, 300)
                  .map((r) => (
                    <button
                      key={r.id}
                      className={reviewId === r.id ? 'active' : ''}
                      onClick={() => changeReview(r)}
                    >
                      <span>
                        {r.request.invoice}
                        <small>{r.request.project || '—'}</small>
                      </span>
                      <span
                        className={`badge ${selections[r.id] ? 'approved' : r.resolution === 'review' ? 'review' : r.resolution === 'missing' ? 'missing' : 'paid'}`}
                      >
                        {selections[r.id]
                          ? t.manual
                          : t[
                              r.resolution === 'review'
                                ? 'review'
                                : r.resolution === 'missing'
                                  ? 'missing'
                                  : 'matched'
                            ]}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="review-detail">
              {selectedReview && (
                <>
                  <div className="review-request">
                    <span className="eyebrow">{t.original}</span>
                    <h3>{selectedReview.request.invoice}</h3>
                    <p>
                      {selectedReview.request.project &&
                        `${t.project}: ${selectedReview.request.project} · `}
                      {selectedReview.request.sheet} / {selectedReview.request.row}
                    </p>
                  </div>
                  <p className="notice">
                    {selectedReview.reason || `${selectedReview.method} · ${selectedReview.score}%`}
                  </p>
                  <div className="candidates">
                    {selectedReview.candidates.length ? (
                      selectedReview.candidates.map((c) => (
                        <label
                          key={c.id}
                          className={`candidate ${candidateIds.includes(c.id) ? 'checked' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={candidateIds.includes(c.id)}
                            onChange={(e) =>
                              setCandidateIds((ids) =>
                                e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id),
                              )
                            }
                          />
                          <div>
                            <div className="candidate-title">
                              <strong>{c.record.invoice}</strong>
                              <span
                                className={`badge ${statusClass(c.record.stage || c.record.status || 'Unknown')}`}
                              >
                                {c.record.stage || c.record.status || 'Unknown'}
                              </span>
                              <b>{c.score}%</b>
                            </div>
                            <p>
                              {t.project}: {c.record.project || '—'} · {c.method}
                            </p>
                            <p className="candidate-notes">{c.record.notes || '—'}</p>
                            <small>
                              {c.record.source} · {c.record.sheet} / {c.record.row}
                            </small>
                          </div>
                        </label>
                      ))
                    ) : (
                      <p className="muted">{t.noCandidates}</p>
                    )}
                  </div>
                  <div className="review-buttons">
                    <button
                      onClick={() => {
                        setSelections((s) => ({ ...s, [selectedReview.id]: [] }));
                        setReviewOpen(false);
                      }}
                    >
                      {t.markMissing}
                    </button>
                    <button
                      className="primary"
                      disabled={!candidateIds.length}
                      onClick={() => {
                        setSelections((s) => ({ ...s, [selectedReview.id]: candidateIds }));
                        setReviewOpen(false);
                      }}
                    >
                      <Check size={16} />
                      {t.accept}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
