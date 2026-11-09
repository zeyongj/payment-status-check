import { BlobPreconditionFailedError, get, put } from '@vercel/blob';
import {
  INITIAL_REVISION,
  MAX_STORED_BYTES,
  parseStoredConfig,
  RevisionConflictError,
  type ConfigStore,
  type StoredConfig,
} from './config.js';

// Isolated from AP Count even when the same private store is connected.
export const CONFIG_PATH = 'invoice-check/config-v1.json';
const strongETag = (value: string) => /^"[\x21\x23-\x7e\x80-\xff]+"$/.test(value);
export function createBlobStore(env: NodeJS.ProcessEnv = process.env): ConfigStore {
  function options() {
    if (env.BLOB_READ_WRITE_TOKEN)
      return { token: env.BLOB_READ_WRITE_TOKEN, access: 'private' as const };
    if (env.BLOB_STORE_ID) return { storeId: env.BLOB_STORE_ID, access: 'private' as const };
    throw new Error('The private directory store is not configured.');
  }
  async function read() {
    const result = await get(CONFIG_PATH, {
      ...options(),
      useCache: false,
      headers: { 'accept-encoding': 'identity' },
    });
    if (!result) return null;
    if (
      result.statusCode !== 200 ||
      result.blob.size > MAX_STORED_BYTES ||
      !strongETag(result.blob.etag)
    )
      throw new Error('Unexpected directory storage response.');
    const value = await new Response(result.stream).text();
    if (new TextEncoder().encode(value).byteLength > MAX_STORED_BYTES)
      throw new Error('Stored directory is too large.');
    return { document: parseStoredConfig(JSON.parse(value)), revision: result.blob.etag };
  }
  async function write(document: StoredConfig, expectedRevision: string) {
    const initial = expectedRevision === INITIAL_REVISION;
    if (!initial && !strongETag(expectedRevision))
      throw new Error('A strong storage revision is required.');
    const serialized = JSON.stringify(document);
    if (new TextEncoder().encode(serialized).byteLength > MAX_STORED_BYTES)
      throw new Error('The directory is too large.');
    try {
      const result = await put(CONFIG_PATH, serialized, {
        ...options(),
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: !initial,
        ...(initial ? {} : { ifMatch: expectedRevision }),
      });
      if (!strongETag(result.etag)) throw new Error('The updated storage revision is invalid.');
      return result.etag;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) throw new RevisionConflictError();
      if (initial) {
        try {
          if (await read()) throw new RevisionConflictError();
        } catch (readError) {
          if (readError instanceof RevisionConflictError) throw readError;
        }
      }
      throw error;
    }
  }
  return { read, write };
}
