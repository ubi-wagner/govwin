/**
 * POST /api/auth/change-password
 *
 * Refactored in Phase 0.5b Section D to use the canonical withHandler
 * wrapper from lib/api-helpers.ts. The wrapper handles:
 *   1. Session resolution + UnauthenticatedError on missing actor
 *   2. Zod validation of the body → ValidationError on schema failure
 *   3. Scoped logging via createLogger('auth')
 *   4. Error translation via the AppError hierarchy
 *   5. Response envelope construction ({ data } / { error })
 *
 * The handler just needs to verify the current password, update the
 * row, and return the success data. Everything else is free from
 * the wrapper.
 *
 * See docs/API_CONVENTIONS.md §"Worked examples" for the canonical
 * pattern this route follows.
 */

import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { withHandler } from '@/lib/api-helpers';
import {
  InternalError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '@/lib/errors';
import { zPassword } from '@/lib/validation';
import {
  emitEventEnd,
  emitEventStart,
  userActor,
} from '@/lib/events';

const InputSchema = z
  .object({
    currentPassword: z.string().min(1, 'current password required'),
    newPassword: zPassword,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'new password must differ from current',
  });

export const POST = withHandler({
  scope: 'auth',
  inputSchema: InputSchema,
  requireAuth: true,
  method: 'POST',
  async handler(input, ctx) {
    if (!ctx.actor) {
      throw new UnauthenticatedError();
    }
    const { currentPassword, newPassword } = input;
    const userId = ctx.actor.id;

    const startEventId = await emitEventStart({
      namespace: 'identity',
      type: 'user.password_changed',
      actor: userActor(userId, ctx.actor.email),
      payload: { userId },
    });

    try {
      const [row] = await sql<{ passwordHash: string | null }[]>`
        SELECT password_hash FROM users WHERE id = ${userId} LIMIT 1
      `;

      if (!row || !row.passwordHash) {
        throw new NotFoundError('user not found');
      }

      const currentPasswordOk = await bcrypt.compare(
        currentPassword,
        row.passwordHash,
      );
      if (!currentPasswordOk) {
        throw new ValidationError('current password incorrect');
      }

      const newHash = await bcrypt.hash(newPassword, 12);

      await sql`
        UPDATE users
        SET password_hash = ${newHash},
            temp_password = false,
            updated_at = now()
        WHERE id = ${userId}
      `;

      await emitEventEnd(startEventId, {
        result: { userId, outcome: 'success' },
      });

      ctx.log.info(
        { userId, email: ctx.actor.email },
        'user changed password',
      );

      return { ok: true };
    } catch (err) {
      // Make sure the end event captures the failure too, then
      // re-throw for the withHandler wrapper to translate to HTTP.
      const errorPayload =
        err instanceof Error
          ? {
              message: err.message,
              code: (err as { code?: string }).code ?? 'UNKNOWN',
            }
          : { message: String(err), code: 'UNKNOWN' };
      await emitEventEnd(startEventId, {
        result: { userId, outcome: 'error' },
        error: errorPayload,
      });

      // Re-throw AppError subclasses as-is. For unknown errors, wrap
      // in InternalError so the wrapper returns a clean 500.
      if (err instanceof Error && 'httpStatus' in err) {
        throw err;
      }
      throw new InternalError('password change failed');
    }
  },
});
