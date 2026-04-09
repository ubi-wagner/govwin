import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  UnauthenticatedError,
  ValidationError,
  isAppError,
} from '@/lib/errors';

describe('AppError hierarchy', () => {
  it('constructs with message, code, httpStatus, details', () => {
    const err = new AppError('boom', 'BOOM_CODE', 418, { extra: 1 });
    expect(err.message).toBe('boom');
    expect(err.code).toBe('BOOM_CODE');
    expect(err.httpStatus).toBe(418);
    expect(err.details).toEqual({ extra: 1 });
    expect(err.name).toBe('AppError');
  });

  it('toResponseBody returns the on-the-wire shape', () => {
    const err = new AppError('boom', 'BOOM_CODE', 418);
    expect(err.toResponseBody()).toEqual({ error: 'boom', code: 'BOOM_CODE' });
  });

  it('toResponseBody omits details when undefined', () => {
    const err = new AppError('boom', 'BOOM_CODE', 418);
    const body = err.toResponseBody();
    expect('details' in body).toBe(false);
  });

  it('toResponseBody includes details when present', () => {
    const err = new AppError('boom', 'BOOM_CODE', 418, { hint: 'try again' });
    expect(err.toResponseBody().details).toEqual({ hint: 'try again' });
  });
});

describe('subclass HTTP status codes', () => {
  it.each([
    [new UnauthenticatedError(), 401, 'UNAUTHENTICATED'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new NotFoundError(), 404, 'NOT_FOUND'],
    [new ConflictError(), 409, 'CONFLICT'],
    [new ValidationError(), 422, 'VALIDATION_ERROR'],
    [new RateLimitError(), 429, 'RATE_LIMIT_EXCEEDED'],
    [new InternalError(), 500, 'INTERNAL_ERROR'],
    [new ExternalServiceError(), 502, 'EXTERNAL_SERVICE_ERROR'],
    [new ServiceUnavailableError(), 503, 'SERVICE_UNAVAILABLE'],
  ])('%o → %i %s', (err, status, code) => {
    expect((err as AppError).httpStatus).toBe(status);
    expect((err as AppError).code).toBe(code);
  });
});

describe('isAppError', () => {
  it('narrows AppError subclasses', () => {
    expect(isAppError(new UnauthenticatedError())).toBe(true);
    expect(isAppError(new ValidationError('bad', { field: 'email' }))).toBe(true);
  });

  it('rejects plain Error, null, strings, objects', () => {
    expect(isAppError(new Error('plain'))).toBe(false);
    expect(isAppError(null)).toBe(false);
    expect(isAppError('error')).toBe(false);
    expect(isAppError({ httpStatus: 400 })).toBe(false);
  });
});
