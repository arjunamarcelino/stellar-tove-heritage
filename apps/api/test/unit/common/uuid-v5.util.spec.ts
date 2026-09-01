import { describe, it, expect } from 'vitest';
import { uuidV5 } from '../../../src/common/utils/uuid-v5.util';

const DNS_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidV5', () => {
  it('matches the RFC 4122 well-known DNS vector (www.example.com)', () => {
    // Canonical golden vector for v5(DNS, "www.example.com").
    expect(uuidV5('www.example.com', DNS_NS)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('is deterministic for the same (name, namespace)', () => {
    expect(uuidV5('CCNR6WXKK42KPM2A', DNS_NS)).toBe(uuidV5('CCNR6WXKK42KPM2A', DNS_NS));
  });

  it('differs for different names', () => {
    expect(uuidV5('a', DNS_NS)).not.toBe(uuidV5('b', DNS_NS));
  });

  it('emits a valid version-5, RFC-4122-variant UUID', () => {
    const u = uuidV5('anything', DNS_NS);
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('throws on a non-UUID namespace', () => {
    expect(() => uuidV5('x', 'not-a-uuid')).toThrow();
  });
});
