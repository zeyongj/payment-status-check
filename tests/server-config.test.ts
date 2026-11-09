import { describe, expect, it } from 'vitest';
import {
  cleanConfig,
  createHandlers,
  INITIAL_REVISION,
  MAX_JSON_BYTES,
  RevisionConflictError,
  type ConfigStore,
  type Identity,
  type StoredConfig,
} from '../server/config';
import { authorizedOrigins, isBootstrapOwner, verifiedPrimaryEmail } from '../server/admin';

const owner = { userId: 'owner-id', email: 'owner@example.test' };
const admin = { userId: 'admin-id', email: 'admin@example.test' };
const viewer = { userId: 'viewer-id', email: 'viewer@example.test' };
const fixtureConfig = () => ({
  ap: [{ Name: 'AP Example', Portfolio: '1000-1999', Include: '', Exclude: '' }],
  pm: { '1001': 'PM Example' },
});
function setup() {
  let state: { document: StoredConfig; revision: string } | null = null;
  let count = 0;
  const store: ConfigStore = {
    async read() {
      return structuredClone(state);
    },
    async write(document, revision) {
      if (revision !== (state?.revision ?? INITIAL_REVISION)) throw new RevisionConflictError();
      const next = `"rev-${++count}"`;
      state = { document: structuredClone(document), revision: next };
      return next;
    },
  };
  const handlers = createHandlers({
    store,
    authorize: async (request): Promise<Identity> => {
      const token = request.headers.get('authorization');
      if (token === 'Bearer owner') return { signedIn: true, isOwner: true, actor: owner };
      if (token === 'Bearer admin') return { signedIn: true, isOwner: false, actor: admin };
      if (token === 'Bearer viewer') return { signedIn: true, isOwner: false, actor: viewer };
      if (token === 'Bearer changed-email')
        return { signedIn: true, isOwner: false, actor: { ...admin, email: 'new@example.test' } };
      return { signedIn: false, isOwner: false };
    },
    lookupAdministrator: async (email) => (email === viewer.email ? viewer : admin),
    ownerEmail: owner.email,
    now: () => new Date('2026-11-09T12:00:00Z'),
  });
  const request = (data: unknown, token?: string) =>
    new Request('https://invoice.example.test/api/config', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
  return { handlers, request, getState: () => state };
}
describe('shared directory API', () => {
  it('denies anonymous directory reads without exposing data or metadata', async () => {
    const { handlers, request } = setup();
    const result = await handlers.getConfig(request({}));
    const value = await result.json();
    expect(result.status).toBe(401);
    expect(value).not.toHaveProperty('config');
    expect(value).not.toHaveProperty('revision');
    expect(result.headers.get('cache-control')).toContain('no-store');
  });
  it('denies registered but ungranted accounts directory access', async () => {
    const { handlers, request } = setup();
    const result = await handlers.getConfig(request({}, 'admin'));
    expect(result.status).toBe(403);
    expect(await result.json()).not.toHaveProperty('config');
    const access = await (await handlers.getAdmin(request({}, 'admin'))).json();
    expect(access).toEqual({
      role: 'visitor',
      canRead: false,
      canEdit: false,
      canManageAdmins: false,
    });
  });
  it('keeps the initial directory empty, then serves private assignments only to an authorized Owner', async () => {
    const { handlers, request } = setup();
    const initial = await (await handlers.getConfig(request({}, 'owner'))).json();
    expect(initial.config).toEqual({ ap: [], pm: {} });
    await handlers.putConfig(request({ revision: 'initial', config: fixtureConfig() }, 'owner'));
    const result = await handlers.getConfig(request({}, 'owner'));
    const value = await result.json();
    expect(result.status).toBe(200);
    expect(value.config).toEqual(fixtureConfig());
    expect(value).not.toHaveProperty('administrators');
  });
  it('grants read-only viewer access independently of administrator editing', async () => {
    const { handlers, request } = setup();
    const saved = await (
      await handlers.putConfig(request({ revision: 'initial', config: fixtureConfig() }, 'owner'))
    ).json();
    const grant = await handlers.postAdmins(
      request(
        { revision: saved.revision, action: 'grant', email: viewer.email, role: 'viewer' },
        'owner',
      ),
    );
    const granted = await grant.json();
    expect(grant.status).toBe(200);
    expect(granted.administrators[0].role).toBe('viewer');
    expect((await handlers.getConfig(request({}, 'viewer'))).status).toBe(200);
    expect(await (await handlers.getAdmin(request({}, 'viewer'))).json()).toEqual({
      role: 'viewer',
      canRead: true,
      canEdit: false,
      canManageAdmins: false,
    });
    expect(
      (
        await handlers.putConfig(
          request({ revision: granted.revision, config: fixtureConfig() }, 'viewer'),
        )
      ).status,
    ).toBe(403);
    expect((await handlers.getAdmins(request({}, 'viewer'))).status).toBe(403);
    expect(
      (
        await handlers.postAdmins(
          request({ revision: granted.revision, action: 'grant', email: admin.email }, 'viewer'),
        )
      ).status,
    ).toBe(403);
    await handlers.postAdmins(
      request({ revision: granted.revision, action: 'revoke', userId: viewer.userId }, 'owner'),
    );
    expect((await handlers.getConfig(request({}, 'viewer'))).status).toBe(403);
  });
  it('allows the Owner to change a grant from viewer to administrator', async () => {
    const { handlers, request } = setup();
    const first = await (
      await handlers.postAdmins(
        request(
          { revision: 'initial', action: 'grant', email: viewer.email, role: 'viewer' },
          'owner',
        ),
      )
    ).json();
    const upgraded = await handlers.postAdmins(
      request(
        { revision: first.revision, action: 'grant', email: viewer.email, role: 'admin' },
        'owner',
      ),
    );
    expect(upgraded.status).toBe(200);
    expect(await (await handlers.getAdmin(request({}, 'viewer'))).json()).toEqual({
      role: 'admin',
      canRead: true,
      canEdit: true,
      canManageAdmins: false,
    });
  });
  it('does not allow a client to invent a privileged access role', async () => {
    const { handlers, request } = setup();
    expect(
      (
        await handlers.postAdmins(
          request(
            { revision: 'initial', action: 'grant', email: viewer.email, role: 'owner' },
            'owner',
          ),
        )
      ).status,
    ).toBe(422);
  });
  it('denies anonymous edits before decoding their payload', async () => {
    const { handlers, request } = setup();
    expect((await handlers.putConfig(request({}))).status).toBe(401);
  });
  it('never grants an account access based on a client role', async () => {
    const { handlers, request } = setup();
    expect(
      (
        await handlers.putConfig(
          request({ role: 'owner', revision: 'initial', config: fixtureConfig() }, 'admin'),
        )
      ).status,
    ).toBe(403);
  });
  it('saves Owner edits and strips unknown uploaded fields', async () => {
    const { handlers, request, getState } = setup();
    const config = { ...fixtureConfig(), invoices: [{ invoice: 'PRIVATE' }] };
    const result = await handlers.putConfig(request({ revision: 'initial', config }, 'owner'));
    expect(result.status).toBe(200);
    expect(getState()?.document.config).not.toHaveProperty('invoices');
  });
  it('prevents a stale session overwriting a newer revision', async () => {
    const { handlers, request } = setup();
    expect(
      (await handlers.putConfig(request({ revision: 'initial', config: fixtureConfig() }, 'owner')))
        .status,
    ).toBe(200);
    expect(
      (await handlers.putConfig(request({ revision: 'initial', config: fixtureConfig() }, 'owner')))
        .status,
    ).toBe(409);
  });
  it('only lets Owner grant access, then allows the exact granted identity', async () => {
    const { handlers, request } = setup();
    expect(
      (
        await handlers.postAdmins(
          request({ revision: 'initial', action: 'grant', email: admin.email }, 'admin'),
        )
      ).status,
    ).toBe(403);
    const grant = await handlers.postAdmins(
      request({ revision: 'initial', action: 'grant', email: admin.email }, 'owner'),
    );
    expect(grant.status).toBe(200);
    const { revision } = await grant.json();
    expect(
      (await handlers.putConfig(request({ revision, config: fixtureConfig() }, 'admin'))).status,
    ).toBe(200);
    expect((await handlers.getAdmins(request({}, 'admin'))).status).toBe(403);
  });
  it('revokes access immediately, including a previous revision', async () => {
    const { handlers, request } = setup();
    const grant = await (
      await handlers.postAdmins(
        request({ revision: 'initial', action: 'grant', email: admin.email }, 'owner'),
      )
    ).json();
    const revoke = await handlers.postAdmins(
      request({ revision: grant.revision, action: 'revoke', userId: admin.userId }, 'owner'),
    );
    expect(revoke.status).toBe(200);
    expect(
      (
        await handlers.putConfig(
          request({ revision: grant.revision, config: fixtureConfig() }, 'admin'),
        )
      ).status,
    ).toBe(403);
  });
  it('does not preserve grants after a primary email changes', async () => {
    const { handlers, request } = setup();
    const grant = await (
      await handlers.postAdmins(
        request({ revision: 'initial', action: 'grant', email: admin.email }, 'owner'),
      )
    ).json();
    expect(
      (
        await handlers.putConfig(
          request({ revision: grant.revision, config: fixtureConfig() }, 'changed-email'),
        )
      ).status,
    ).toBe(403);
  });
  it('bounds streamed request size', async () => {
    const { handlers, request } = setup();
    expect(
      (await handlers.putConfig(request({ unused: 'x'.repeat(MAX_JSON_BYTES) }, 'owner'))).status,
    ).toBe(413);
  });
  it('rejects malformed JSON and invalid ranges', async () => {
    const { handlers, request } = setup();
    const malformed = new Request('https://example.test', {
      method: 'PUT',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: '{',
    });
    expect((await handlers.putConfig(malformed)).status).toBe(400);
    const config = fixtureConfig();
    config.ap[0].Portfolio = '6000-5000';
    expect(
      (await handlers.putConfig(request({ revision: 'initial', config }, 'owner'))).status,
    ).toBe(422);
  });
  it('validates names, project IDs and contradictory include/exclude rules', () => {
    const config = fixtureConfig();
    config.ap[0].Include = '5001';
    config.ap[0].Exclude = '5001';
    expect(() => cleanConfig(config)).toThrow(/both include and exclude/);
    expect(() => cleanConfig({ ap: fixtureConfig().ap, pm: { bad: 'PM' } })).toThrow(
      /project numbers/,
    );
  });
});

describe('trusted Owner identity', () => {
  const user = {
    primaryEmailAddressId: 'primary',
    emailAddresses: [
      { id: 'primary', emailAddress: 'owner@example.test', verification: { status: 'verified' } },
    ],
    externalAccounts: [
      {
        provider: 'oauth_github',
        providerUserId: '123456',
        verification: { status: 'verified' },
      },
    ],
  };
  it('requires a verified primary email for email ownership', () => {
    expect(isBootstrapOwner(user, { PAYMENT_STATUS_CHECK_ADMIN_EMAIL: 'OWNER@EXAMPLE.TEST' })).toBe(true);
    expect(
      isBootstrapOwner(
        {
          ...user,
          emailAddresses: [{ ...user.emailAddresses[0], verification: { status: 'unverified' } }],
        },
        { PAYMENT_STATUS_CHECK_ADMIN_EMAIL: 'owner@example.test' },
      ),
    ).toBe(false);
  });
  it('accepts only the verified immutable GitHub ID', () => {
    expect(isBootstrapOwner(user, { PAYMENT_STATUS_CHECK_OWNER_GITHUB_ID: '123456' })).toBe(true);
    expect(isBootstrapOwner(user, { PAYMENT_STATUS_CHECK_OWNER_GITHUB_ID: 'different' })).toBe(false);
    expect(
      isBootstrapOwner(
        { ...user, externalAccounts: [{ ...user.externalAccounts[0], verification: null }] },
        { PAYMENT_STATUS_CHECK_OWNER_GITHUB_ID: '123456' },
      ),
    ).toBe(false);
    expect(
      isBootstrapOwner(
        { ...user, externalAccounts: [{ ...user.externalAccounts[0], provider: 'oauth_google' }] },
        { PAYMENT_STATUS_CHECK_OWNER_GITHUB_ID: '123456' },
      ),
    ).toBe(false);
  });
  it('denies locked/banned users regardless of linked identity', () => {
    expect(verifiedPrimaryEmail({ ...user, banned: true })).toBeNull();
    expect(
      isBootstrapOwner({ ...user, locked: true }, { PAYMENT_STATUS_CHECK_OWNER_GITHUB_ID: '123456' }),
    ).toBe(false);
  });
  it('pins production authorized origins without accepting wildcards', () => {
    expect(
      authorizedOrigins({
        NODE_ENV: 'production',
        PAYMENT_STATUS_CHECK_ORIGIN: 'https://payment-status-check.vercel.app/path',
        VERCEL_URL: 'preview.example.evil',
      }),
    ).toEqual(['https://payment-status-check.vercel.app']);
    expect(authorizedOrigins({ NODE_ENV: 'production' })).toEqual([]);
  });
});
