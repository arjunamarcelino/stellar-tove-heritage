import { describe, it, expect } from 'vitest';
import { redactUrlQueryParams, REDACTED_QUERY_PARAMS } from '@common/logging/redact-query.util';

describe('redactUrlQueryParams', () => {
  const keys = ['handle'];

  it('redacts the handle value on the check endpoint URL', () => {
    expect(redactUrlQueryParams('/api/v1/handles/check?handle=maya', keys)).toBe(
      '/api/v1/handles/check?handle=[REDACTED]',
    );
  });

  it('leaves the path and other query params intact', () => {
    expect(redactUrlQueryParams('/api/v1/handles/check?before=1&handle=maya&after=2', keys)).toBe(
      '/api/v1/handles/check?before=1&handle=[REDACTED]&after=2',
    );
  });

  it('redacts a handle at the start of the query string', () => {
    expect(redactUrlQueryParams('/x?handle=maya&y=1', keys)).toBe('/x?handle=[REDACTED]&y=1');
  });

  it('redacts an empty handle value', () => {
    expect(redactUrlQueryParams('/x?handle=', keys)).toBe('/x?handle=[REDACTED]');
  });

  it('does not touch params whose name merely contains "handle" as a substring', () => {
    expect(redactUrlQueryParams('/x?myhandle=maya&handled=1', keys)).toBe('/x?myhandle=maya&handled=1');
  });

  it('is case-insensitive on the key, preserving the original key casing', () => {
    expect(redactUrlQueryParams('/x?Handle=maya', keys)).toBe('/x?Handle=[REDACTED]');
    expect(redactUrlQueryParams('/x?HANDLE=maya', keys)).toBe('/x?HANDLE=[REDACTED]');
  });

  it('returns URLs without a query string unchanged', () => {
    expect(redactUrlQueryParams('/api/v1/me/handle', keys)).toBe('/api/v1/me/handle');
  });

  it('returns the URL unchanged when no keys are given', () => {
    expect(redactUrlQueryParams('/x?handle=maya', [])).toBe('/x?handle=maya');
  });

  it('redacts every configured key', () => {
    expect(redactUrlQueryParams('/x?handle=maya&handle=bob', REDACTED_QUERY_PARAMS)).toBe(
      '/x?handle=[REDACTED]&handle=[REDACTED]',
    );
  });
});
