/** Run after `vercel build --prod` to verify the emitted Node ESM graph. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadFunction(name) {
  const directory = resolve(`.vercel/output/functions/api/${name}.func`);
  const config = JSON.parse(await readFile(resolve(directory, '.vc-config.json'), 'utf8'));
  return import(pathToFileURL(resolve(directory, config.handler)).href);
}
const [config, admin, admins] = await Promise.all(['config', 'admin', 'admins'].map(loadFunction));
const anonymous = await admin.GET(new Request('https://payment-status-check.vercel.app/api/admin'));
assert.equal(anonymous.status, 200);
assert.deepEqual(await anonymous.json(), {
  role: 'visitor',
  canRead: false,
  canEdit: false,
  canManageAdmins: false,
});
const privateDirectory = await config.GET(
  new Request('https://payment-status-check.vercel.app/api/config'),
);
assert.equal(privateDirectory.status, 401);
assert.equal((await privateDirectory.json()).error.code, 'unauthorized');
const roster = await admins.GET(new Request('https://payment-status-check.vercel.app/api/admins'));
assert.equal(roster.status, 401);
const grant = await admins.POST(
  new Request('https://payment-status-check.vercel.app/api/admins', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: 'initial', action: 'grant', email: 'untrusted@example.test' }),
  }),
);
assert.equal(grant.status, 401);
const mutation = await config.PUT(
  new Request('https://payment-status-check.vercel.app/api/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revision: 'initial', config: { ap: [], pm: {} } }),
  }),
);
assert.equal(mutation.status, 401);
assert.equal((await mutation.json()).error.code, 'unauthorized');
console.log('Compiled Vercel functions boot; anonymous directory reads and mutations are denied.');
