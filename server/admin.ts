import { createClerkClient } from '@clerk/backend';
import { ApiError, normalizeEmail, type Actor, type Identity } from './config.js';

interface ClerkUser {
  id?: string;
  banned?: boolean;
  locked?: boolean;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[];
  externalAccounts?: {
    provider: string;
    providerUserId: string;
    verification: { status: string } | null;
  }[];
}
export function verifiedPrimaryEmail(user: ClerkUser): string | null {
  if (user.banned || user.locked) return null;
  const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  return primary?.verification?.status === 'verified' ? normalizeEmail(primary.emailAddress) : null;
}
export const ownerEmail = (env: NodeJS.ProcessEnv) =>
  env.INVOICE_CHECK_ADMIN_EMAIL ?? env.AP_COUNT_ADMIN_EMAIL;
export function isBootstrapOwner(user: ClerkUser, env: NodeJS.ProcessEnv): boolean {
  if (user.banned || user.locked) return false;
  const email = verifiedPrimaryEmail(user);
  const emailOwner = Boolean(
    email && ownerEmail(env)?.trim() && email === normalizeEmail(ownerEmail(env)!),
  );
  const githubId = env.INVOICE_CHECK_OWNER_GITHUB_ID?.trim();
  // Compare a trusted provider's immutable user ID, never a mutable username or client claim.
  const githubOwner = Boolean(
    githubId &&
      /^\d+$/.test(githubId) &&
      user.externalAccounts?.some(
        (account) =>
          ['github', 'oauth_github'].includes(account.provider) &&
          account.providerUserId === githubId &&
          account.verification?.status === 'verified',
      ),
  );
  return emailOwner || githubOwner;
}
export function authorizedOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = new Set<string>();
  if (env.INVOICE_CHECK_ORIGIN) {
    try {
      const url = new URL(env.INVOICE_CHECK_ORIGIN);
      if (url.protocol === 'https:') origins.add(url.origin);
    } catch {
      /* Invalid deployment settings fail closed. */
    }
  }
  for (const host of [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_URL]) {
    if (host && /^[a-z0-9.-]+\.vercel\.app$/i.test(host)) origins.add(`https://${host}`);
  }
  if (env.NODE_ENV !== 'production') {
    for (const host of ['localhost', '127.0.0.1'])
      for (const port of [4173, 5173]) origins.add(`http://${host}:${port}`);
  }
  return [...origins];
}
function clerkClient(env: NodeJS.ProcessEnv) {
  if (
    !env.CLERK_SECRET_KEY ||
    !env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    (!ownerEmail(env)?.trim() && !/^\d+$/.test(env.INVOICE_CHECK_OWNER_GITHUB_ID ?? ''))
  )
    throw new Error('Administrator authentication is not configured.');
  return createClerkClient({
    secretKey: env.CLERK_SECRET_KEY,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    telemetry: { disabled: true },
  });
}
export function createAuthorizer(env: NodeJS.ProcessEnv = process.env) {
  return async (request: Request): Promise<Identity> => {
    const header = request.headers.get('authorization');
    if (!header) return { signedIn: false, isOwner: false };
    if (!/^Bearer [^\s]+$/i.test(header) || header.length > 16_384)
      throw new ApiError(401, 'unauthorized', 'The sign-in session is invalid. Sign in again.');
    const parties = authorizedOrigins(env);
    if (!parties.length) throw new Error('The application origin is not configured.');
    const client = clerkClient(env);
    const state = await client.authenticateRequest(request, {
      authorizedParties: parties,
      acceptsToken: 'session_token',
    });
    if (!state.isAuthenticated)
      throw new ApiError(
        401,
        'unauthorized',
        'The sign-in session has expired or is invalid. Sign in again.',
      );
    const auth = state.toAuth();
    if (!auth?.userId) throw new ApiError(401, 'unauthorized', 'The sign-in session is invalid.');
    const user = await client.users.getUser(auth.userId);
    const email = verifiedPrimaryEmail(user);
    const isOwner = isBootstrapOwner(user, env);
    const actorEmail = email ?? (isOwner ? `github:${env.INVOICE_CHECK_OWNER_GITHUB_ID}` : null);
    return {
      signedIn: true,
      isOwner,
      ...(actorEmail ? { actor: { userId: auth.userId, email: actorEmail } } : {}),
    };
  };
}
export function createAdministratorLookup(env: NodeJS.ProcessEnv = process.env) {
  return async (email: string): Promise<Actor> => {
    const normalized = normalizeEmail(email);
    const result = await clerkClient(env).users.getUserList({
      emailAddress: [normalized],
      limit: 100,
    });
    const matches = result.data.filter((user) => {
      const primary = user.emailAddresses.find((item) => item.id === user.primaryEmailAddressId);
      return primary && normalizeEmail(primary.emailAddress) === normalized;
    });
    if (matches.length !== 1)
      throw new ApiError(
        422,
        'account_not_found',
        'Ask this person to sign up with this primary email first.',
      );
    if (!verifiedPrimaryEmail(matches[0]))
      throw new ApiError(
        422,
        'email_not_verified',
        'This account needs an active, verified primary email before access can be granted.',
      );
    return { userId: matches[0].id, email: normalized };
  };
}
