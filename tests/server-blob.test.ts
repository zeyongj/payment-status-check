import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobPreconditionFailedError, get, put } from '@vercel/blob';
import { CONFIG_PATH, createBlobStore } from '../server/blob-store';
import { defaultConfig, RevisionConflictError, type StoredConfig } from '../server/config';

vi.mock('@vercel/blob', async (original) => ({
  ...(await original<typeof import('@vercel/blob')>()),
  get: vi.fn(),
  put: vi.fn(),
}));
const document: StoredConfig = {
  version: 1,
  updatedAt: '2026-11-09T12:00:00Z',
  config: defaultConfig(),
  administrators: [],
};
const response = (etag = '"rev-1"') =>
  ({
    statusCode: 200,
    stream: new Response(JSON.stringify(document)).body,
    blob: { size: JSON.stringify(document).length, etag },
  }) as Awaited<ReturnType<typeof get>>;
describe('private Blob conditional directory storage', () => {
  beforeEach(() => {
    vi.mocked(get).mockReset();
    vi.mocked(put).mockReset();
  });
  it('uses an isolated private path and uncached identity encoding for strong revisions', async () => {
    vi.mocked(get).mockResolvedValue(response());
    const result = await createBlobStore({ BLOB_STORE_ID: 'test-store' }).read();
    expect(result?.revision).toBe('"rev-1"');
    expect(get).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.objectContaining({
        access: 'private',
        useCache: false,
        headers: { 'accept-encoding': 'identity' },
      }),
    );
    expect(CONFIG_PATH).toBe('payment-status-check/config-v1.json');
  });
  it('rejects a weak read revision instead of allowing a non-atomic overwrite', async () => {
    vi.mocked(get).mockResolvedValue(response('W/"rev-1"'));
    await expect(createBlobStore({ BLOB_STORE_ID: 'test-store' }).read()).rejects.toThrow();
  });
  it('creates the first config without overwriting an existing object', async () => {
    vi.mocked(put).mockResolvedValue({ etag: '"rev-1"' } as Awaited<ReturnType<typeof put>>);
    await createBlobStore({ BLOB_STORE_ID: 'test-store' }).write(document, 'initial');
    expect(put).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.any(String),
      expect.objectContaining({ allowOverwrite: false, addRandomSuffix: false, access: 'private' }),
    );
  });
  it('binds updates to the exact strong ETag read from storage', async () => {
    vi.mocked(put).mockResolvedValue({ etag: '"rev-2"' } as Awaited<ReturnType<typeof put>>);
    await createBlobStore({ BLOB_STORE_ID: 'test-store' }).write(document, '"rev-1"');
    expect(put).toHaveBeenCalledWith(
      CONFIG_PATH,
      expect.any(String),
      expect.objectContaining({ ifMatch: '"rev-1"', allowOverwrite: true }),
    );
  });
  it('translates a concurrent update to a revision conflict', async () => {
    vi.mocked(put).mockRejectedValue(new BlobPreconditionFailedError());
    await expect(
      createBlobStore({ BLOB_STORE_ID: 'test-store' }).write(document, '"rev-1"'),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
  it('requires configured private storage and refuses weak write revisions', async () => {
    await expect(createBlobStore({}).read()).rejects.toThrow(/not configured/);
    await expect(
      createBlobStore({ BLOB_STORE_ID: 'test-store' }).write(document, 'W/"rev-1"'),
    ).rejects.toThrow(/strong storage revision/);
    expect(put).not.toHaveBeenCalled();
  });
});
