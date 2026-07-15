import { describe, it, expect } from 'vitest';
import { HandleService } from '@modules/users/handle/handle.service';
import { IUserRepository } from '@modules/users/repositories/user-repository.interface';
import { User } from '@modules/users/entities/user.entity';

/**
 * Guards the `CheckHandleResponseDto` invariant that the type system can't express (the DTO is a class
 * for Swagger, so `reason` is an optional field, not a discriminated union): **`reason` is present iff
 * `available` is false.** If any `check()` return site ever drifts, these assertions fail. [TOV-26 #169]
 */
describe('HandleService.check invariant', () => {
  /** Fake repo: `taken` controls whether findByHandleCanonical reports an existing owner. */
  function service(taken: boolean): HandleService {
    const repo: IUserRepository = {
      findByEmail: () => Promise.resolve(null),
      findByHandleCanonical: () => Promise.resolve(taken ? ({ id: 'x' } as User) : null),
      findHandleByUserId: () => Promise.resolve(null),
      setHandle: () => Promise.resolve(true),
    };
    return new HandleService(repo);
  }

  const cases = [
    { name: 'available', input: 'freehandle', taken: false, available: true, reason: undefined },
    { name: 'taken', input: 'maya', taken: true, available: false, reason: 'taken' },
    { name: 'reserved', input: 'admin', taken: false, available: false, reason: 'reserved' },
    { name: 'invalid_format', input: 'ma ya', taken: false, available: false, reason: 'invalid_format' },
  ] as const;

  for (const c of cases) {
    it(`${c.name}: reason present iff unavailable`, async () => {
      const res = await service(c.taken).check(c.input);

      // The invariant, asserted directly:
      expect(res.reason !== undefined).toBe(res.available === false);

      // And the concrete expected shape for this case:
      expect(res.available).toBe(c.available);
      expect(res.reason).toBe(c.reason);
      expect(res.handle).toBe(c.input);
    });
  }
});
