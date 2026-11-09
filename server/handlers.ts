import { createAuthorizer, createAdministratorLookup, ownerEmail } from './admin.js';
import { createBlobStore } from './blob-store.js';
import { createHandlers } from './config.js';

export function productionHandlers() {
  return createHandlers({
    store: createBlobStore(),
    authorize: createAuthorizer(),
    lookupAdministrator: createAdministratorLookup(),
    ownerEmail: ownerEmail(process.env),
    reportFailure: (operation) => console.error(`[Payment Status Check] ${operation} failed.`),
  });
}
