import { describe, it, expect } from 'vitest';

// Enable when the artist schema lands (TOV-194). The in-memory provider is
// swapped for a TypeORM repository bound to the same ARTIST_READ_REPOSITORY
// token; this suite then asserts DB-backed reads.
describe.skip('Artists (integration) — enable when TOV-194 schema lands', () => {
  it('lists artists from DB', () => {
    expect(true).toBe(true);
  });
});
