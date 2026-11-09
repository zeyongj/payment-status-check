export interface APEntry {
  Name: string;
  Portfolio: string;
  Include: string;
  Exclude: string;
}
export interface SharedConfig {
  ap: APEntry[];
  pm: Record<string, string>;
}
export interface Actor {
  userId: string;
  email: string;
}
export interface AdminGrant extends Actor {
  role: 'viewer' | 'admin';
  addedAt: string;
  addedBy: Actor;
}
export interface StoredConfig {
  version: 1;
  updatedAt: string;
  config: SharedConfig;
  administrators: AdminGrant[];
}
export interface ConfigStore {
  read(): Promise<{ document: StoredConfig; revision: string } | null>;
  write(document: StoredConfig, expectedRevision: string): Promise<string>;
}
export interface Identity {
  signedIn: boolean;
  isOwner: boolean;
  actor?: Actor;
}
export interface Dependencies {
  store: ConfigStore;
  authorize(request: Request): Promise<Identity>;
  lookupAdministrator(email: string): Promise<Actor>;
  ownerEmail?: string;
  now?: () => Date;
  reportFailure?: (operation: string) => void;
}
export const INITIAL_REVISION = 'initial';
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_STORED_BYTES = 2 * MAX_JSON_BYTES;
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export class RevisionConflictError extends Error {}
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new ApiError(422, 'invalid_config', 'Configuration contains an invalid text value.');
  const clean = value.trim();
  if (required && !clean)
    throw new ApiError(422, 'invalid_config', 'Names and project ranges cannot be blank.');
  return clean;
}
function projectList(value: unknown): string {
  const clean = text(value, 20_000);
  if (clean && clean.split(/[,;\s]+/).some((item) => !/^\d{1,9}$/.test(item)))
    throw new ApiError(
      422,
      'invalid_config',
      'Explicit projects must be whole numbers separated by commas or spaces.',
    );
  return clean;
}
/** Sanitize exactly the private directory schema. Uploaded invoice fields are never stored. */
export function cleanConfig(value: unknown): SharedConfig {
  if (!isRecord(value) || !Array.isArray(value.ap) || value.ap.length > 100 || !isRecord(value.pm))
    throw new ApiError(
      422,
      'invalid_config',
      'The configuration must contain AP rules and a PM directory.',
    );
  const ap = value.ap.map((item): APEntry => {
    if (!isRecord(item)) throw new ApiError(422, 'invalid_config', 'An AP rule is invalid.');
    const Name = text(item.Name, 100, true);
    const Portfolio = text(item.Portfolio, 100);
    for (const interval of Portfolio ? Portfolio.split(/[,;]/) : []) {
      const range = interval.trim().match(/^(\d{1,9})(?:\s*([-–])\s*(\d{1,9})|(\+))?$/);
      if (!range || (range[3] && Number(range[1]) > Number(range[3])))
        throw new ApiError(
          422,
          'invalid_config',
          'Use a project, an inclusive range such as 5528-5626, or 5791+.',
        );
    }
    const Include = projectList(item.Include);
    const Exclude = projectList(item.Exclude);
    if (!Portfolio && !Include)
      throw new ApiError(422, 'invalid_config', 'Each AP needs a range or explicit projects.');
    const excluded = new Set(
      Exclude.split(/[,;\s]+/)
        .filter(Boolean)
        .map(Number),
    );
    if (
      Include.split(/[,;\s]+/)
        .filter(Boolean)
        .some((p) => excluded.has(Number(p)))
    )
      throw new ApiError(
        422,
        'invalid_config',
        'An AP cannot both include and exclude the same project.',
      );
    return { Name, Portfolio, Include, Exclude };
  });
  if (new Set(ap.map((item) => item.Name.toLowerCase())).size !== ap.length)
    throw new ApiError(422, 'invalid_config', 'AP names must be unique.');
  const entries = Object.entries(value.pm);
  if (entries.length > 20_000)
    throw new ApiError(422, 'invalid_config', 'The PM directory is too large.');
  const pm: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!/^\d{1,9}$/.test(key))
      throw new ApiError(422, 'invalid_config', 'PM directory keys must be project numbers.');
    pm[key] = text(value, 200);
  }
  return { ap, pm };
}
export function defaultConfig(): SharedConfig {
  // Real assignments live only in the private store, never in deployable source.
  return { ap: [], pm: {} };
}
function cleanActor(value: unknown): Actor {
  if (!isRecord(value)) throw new Error('Invalid stored identity.');
  return {
    userId: text(value.userId, 200, true),
    email: normalizeEmail(text(value.email, 254, true)),
  };
}
export function parseStoredConfig(value: unknown): StoredConfig {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Array.isArray(value.administrators) ||
    value.administrators.length > 50
  )
    throw new Error('Invalid stored configuration.');
  const administrators = value.administrators.map((item): AdminGrant => {
    if (
      !isRecord(item) ||
      typeof item.addedAt !== 'string' ||
      !Number.isFinite(Date.parse(item.addedAt))
    )
      throw new Error('Invalid stored grant.');
    if (item.role !== undefined && item.role !== 'viewer' && item.role !== 'admin')
      throw new Error('Invalid stored access role.');
    return {
      ...cleanActor(item),
      role: item.role === 'viewer' ? 'viewer' : 'admin',
      addedAt: item.addedAt,
      addedBy: cleanActor(item.addedBy),
    };
  });
  if (
    new Set(administrators.map((g) => g.userId)).size !== administrators.length ||
    new Set(administrators.map((g) => g.email)).size !== administrators.length
  )
    throw new Error('Duplicate stored grants.');
  return {
    version: 1,
    updatedAt: value.updatedAt,
    config: cleanConfig(value.config),
    administrators,
  };
}
const headers = {
  'Cache-Control': 'no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new ApiError(415, 'unsupported_media_type', 'Send application/json.');
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_JSON_BYTES))
    throw new ApiError(413, 'request_too_large', 'The configuration request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json', 'A JSON request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new ApiError(413, 'request_too_large', 'The configuration request is too large.');
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!isRecord(value)) throw new Error('Object required');
    return value;
  } catch {
    throw new ApiError(400, 'invalid_json', 'A valid JSON object is required.');
  }
}
function revision(value: unknown, current: string) {
  if (typeof value !== 'string' || value !== current) throw new RevisionConflictError();
  return value;
}
export function createHandlers(deps: Dependencies) {
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  async function current() {
    const stored = await deps.store.read();
    return (
      stored ?? {
        revision: INITIAL_REVISION,
        document: {
          version: 1 as const,
          updatedAt: '',
          config: defaultConfig(),
          administrators: [],
        },
      }
    );
  }
  function snapshot(state: Awaited<ReturnType<typeof current>>) {
    return {
      revision: state.revision,
      config: state.document.config,
      updatedAt: state.document.updatedAt || null,
    };
  }
  async function role(request: Request, state: Awaited<ReturnType<typeof current>>) {
    const identity = await deps.authorize(request);
    const grant =
      identity.actor &&
      state.document.administrators.find(
        (grant) => grant.userId === identity.actor!.userId && grant.email === identity.actor!.email,
      );
    const role = !identity.signedIn
      ? 'visitor'
      : identity.isOwner && identity.actor
        ? 'owner'
        : grant
          ? (grant.role ?? 'admin')
          : 'visitor';
    return {
      identity,
      role,
      canRead: role !== 'visitor',
      canEdit: role === 'admin' || role === 'owner',
      canManageAdmins: role === 'owner',
    };
  }
  async function protect(operation: string, work: () => Promise<Response>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ApiError)
        return json({ error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof RevisionConflictError)
        return json(
          {
            error: {
              code: 'revision_conflict',
              message:
                'Another administrator saved changes. Reload the shared directory before saving again.',
            },
          },
          409,
        );
      deps.reportFailure?.(operation);
      return json(
        {
          error: {
            code: 'service_unavailable',
            message: 'The shared directory service is unavailable. Please retry later.',
          },
        },
        503,
      );
    }
  }
  return {
    getConfig: (request: Request) =>
      protect('read configuration', async () => {
        if (!request.headers.has('authorization'))
          throw new ApiError(
            401,
            'unauthorized',
            'Sign in with an authorized account to read the private directory.',
          );
        const state = await current();
        const access = await role(request, state);
        if (!access.canRead)
          throw new ApiError(
            403,
            'forbidden',
            'This account has not been granted access to the private directory.',
          );
        return json(snapshot(state));
      }),
    getAdmin: (request: Request) =>
      protect('check access', async () => {
        // Anonymous access checks do not need authentication or storage credentials.
        if (!request.headers.has('authorization'))
          return json({ role: 'visitor', canRead: false, canEdit: false, canManageAdmins: false });
        const access = await role(request, await current());
        return json({
          role: access.role,
          canRead: access.canRead,
          canEdit: access.canEdit,
          canManageAdmins: access.canManageAdmins,
        });
      }),
    putConfig: (request: Request) =>
      protect('save configuration', async () => {
        if (!request.headers.has('authorization'))
          throw new ApiError(401, 'unauthorized', 'Sign in as an administrator before saving.');
        const state = await current();
        const access = await role(request, state);
        if (!access.canEdit)
          throw new ApiError(403, 'forbidden', 'This account cannot edit the shared directory.');
        const input = await body(request);
        const expected = revision(input.revision, state.revision);
        const document: StoredConfig = {
          ...state.document,
          config: cleanConfig(input.config),
          updatedAt: now(),
        };
        const nextRevision = await deps.store.write(document, expected);
        return json(snapshot({ document, revision: nextRevision }));
      }),
    getAdmins: (request: Request) =>
      protect('read administrators', async () => {
        if (!request.headers.has('authorization'))
          throw new ApiError(401, 'unauthorized', 'Sign in as Owner to manage administrators.');
        const state = await current();
        const access = await role(request, state);
        if (!access.canManageAdmins)
          throw new ApiError(403, 'forbidden', 'Only the Owner can manage administrators.');
        return json({
          revision: state.revision,
          administrators: state.document.administrators.map(({ userId, email, role, addedAt }) => ({
            userId,
            email,
            role: role ?? 'admin',
            addedAt,
          })),
        });
      }),
    postAdmins: (request: Request) =>
      protect('change administrator access', async () => {
        if (!request.headers.has('authorization'))
          throw new ApiError(401, 'unauthorized', 'Sign in as Owner to manage administrators.');
        const state = await current();
        const access = await role(request, state);
        if (!access.canManageAdmins || !access.identity.actor)
          throw new ApiError(403, 'forbidden', 'Only the Owner can manage administrators.');
        const input = await body(request);
        const expected = revision(input.revision, state.revision);
        let administrators = [...state.document.administrators];
        if (input.action === 'grant') {
          if (input.role !== undefined && input.role !== 'viewer' && input.role !== 'admin')
            throw new ApiError(422, 'invalid_role', 'Choose viewer or administrator access.');
          const grantedRole = input.role === 'viewer' ? 'viewer' : 'admin';
          const email = normalizeEmail(text(input.email, 254, true));
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new ApiError(422, 'invalid_email', 'Enter a valid primary email.');
          if (email === normalizeEmail(deps.ownerEmail ?? ''))
            throw new ApiError(
              422,
              'owner_fixed',
              'The Owner already has permanent administrator access.',
            );
          const actor = await deps.lookupAdministrator(email);
          if (actor.userId === access.identity.actor.userId)
            throw new ApiError(
              422,
              'owner_fixed',
              'The Owner already has permanent administrator access.',
            );
          const existing = administrators.find(
            (g) => g.userId === actor.userId || g.email === actor.email,
          );
          if (existing && (existing.userId !== actor.userId || existing.email !== actor.email))
            throw new ApiError(
              422,
              'identity_changed',
              'Revoke the previous access grant before granting this changed identity.',
            );
          if (!existing && administrators.length >= 50)
            throw new ApiError(
              422,
              'admin_limit',
              'The limit of 50 directory access grants has been reached.',
            );
          administrators = administrators.filter((g) => g.userId !== actor.userId);
          administrators.push({
            ...actor,
            role: grantedRole,
            addedAt: now(),
            addedBy: access.identity.actor,
          });
        } else if (input.action === 'revoke') {
          const userId = text(input.userId, 200, true);
          if (!administrators.some((g) => g.userId === userId))
            throw new ApiError(
              404,
              'admin_not_found',
              'This administrator grant no longer exists.',
            );
          administrators = administrators.filter((g) => g.userId !== userId);
        } else throw new ApiError(422, 'invalid_action', 'Choose grant or revoke.');
        const document: StoredConfig = { ...state.document, administrators, updatedAt: now() };
        const nextRevision = await deps.store.write(document, expected);
        return json({
          revision: nextRevision,
          administrators: administrators.map(({ userId, email, role, addedAt }) => ({
            userId,
            email,
            role: role ?? 'admin',
            addedAt,
          })),
        });
      }),
  };
}
