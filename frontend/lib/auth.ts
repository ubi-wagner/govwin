/**
 * Re-export from the root auth.ts. NextAuth v5 expects the canonical
 * config file at the app root so that auth.config.ts (if added) can
 * be picked up automatically. Existing imports of '@/lib/auth' keep
 * working via this shim.
 */
export { auth, signIn, signOut, handlers, ROLES, type Role } from '../auth';
