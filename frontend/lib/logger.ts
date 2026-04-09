/**
 * Structured logger — pino wrapper with scope-based child loggers,
 * redaction, and environment-aware transport.
 *
 * See docs/NAMESPACES.md §"Log scope names" for the binding registry
 * of scope values. Every `logger.child({ scope: ... })` call must use
 * one of the listed scopes; adding a new scope requires updating the
 * registry in NAMESPACES.md in the same PR.
 *
 * Rules (from docs/ERROR_HANDLING.md §"Logging rules"):
 *   - NEVER use raw console.error in application code. Call `logger.error`.
 *   - console.log is banned everywhere (enforced by a grep in CI).
 *   - Every caught error is logged BEFORE being handled (re-thrown,
 *     translated, or swallowed).
 *   - Log payloads are redacted for password, password_hash,
 *     AUTH_SECRET, API_KEY_ENCRYPTION_SECRET, STRIPE_SECRET_KEY,
 *     bearer tokens, and session cookies.
 *   - In production: JSON lines to stdout. In development:
 *     pino-pretty human-readable output.
 *
 * The only place console.* is permitted is inside this file, as a
 * fallback when pino itself fails (breaks the circular dependency of
 * logging a logging failure).
 */

import pino, { type LoggerOptions, type Logger as PinoLogger } from 'pino';

// ─── Redaction list ─────────────────────────────────────────────────
// Pino redaction paths — any field matching one of these is replaced
// with '[REDACTED]' before serialization. Covers the common leak
// vectors without being exhaustive; individual call sites must also
// avoid logging secrets in message strings.
const REDACT_PATHS = [
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'authSecret',
  'AUTH_SECRET',
  'apiKey',
  'api_key',
  'apiKeyEncryptionSecret',
  'encrypted_key',
  'stripeSecretKey',
  'sessionToken',
  'cookie',
  'Cookie',
  'authorization',
  'Authorization',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.api_key',
  '*.apiKey',
  '*.cookie',
  '*.authorization',
  'req.headers.cookie',
  'req.headers.authorization',
];

// ─── Base logger configuration ──────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  base: {
    service: 'frontend',
    env: process.env.NODE_ENV ?? 'development',
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  // Avoid logging hostname; it's noisy in container environments.
  // Timestamps are ISO 8601 for interop with Railway's log viewer.
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
};

// In development we use pino-pretty for human-readable output. In
// test environments we suppress log output entirely to keep test
// output clean (override via LOG_LEVEL=debug if needed for debugging
// a specific test).
let rootLogger: PinoLogger;
try {
  if (isTest && !process.env.LOG_LEVEL) {
    rootLogger = pino({ ...baseOptions, level: 'silent' });
  } else if (!isProduction) {
    rootLogger = pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,service,env,version',
          messageFormat: '[{scope}] {msg}',
        },
      },
    });
  } else {
    rootLogger = pino(baseOptions);
  }
} catch (err) {
  // Pino itself failed to initialize — fall back to a no-op logger
  // shape + console.error to break the circular dependency. This
  // should never happen in practice; if it does, we still need the
  // rest of the app to run.
  // eslint-disable-next-line no-console
  console.error('[logger] pino init failed, falling back to console:', err);
  rootLogger = pino({ level: 'silent' });
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * The base application logger. Prefer `createLogger(scope)` in
 * individual modules so every log line carries a scope — searching
 * logs by scope is how you narrow blast radius during incident
 * response.
 */
export const logger = rootLogger;

/**
 * Create a scoped child logger. The `scope` value must come from the
 * registry in docs/NAMESPACES.md §"Log scope names".
 *
 * Example:
 *   const log = createLogger('auth');
 *   log.info({ userId }, 'user signed in');
 *
 * Multiple scopes can be chained for nested contexts:
 *   const log = createLogger('auth').child({ subScope: 'credentials' });
 */
export function createLogger(scope: string): PinoLogger {
  return rootLogger.child({ scope });
}

/**
 * Type export so consumers can annotate their own logger fields
 * without reaching into the pino package directly.
 */
export type Logger = PinoLogger;
