import { describe, it, expect } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ListNotificationsQueryDto } from '../../../../src/modules/marketplace/notifications/dto/list-notifications-query.dto';

const errorsFor = (q: Record<string, unknown>) =>
  validateSync(plainToInstance(ListNotificationsQueryDto, q));

describe('ListNotificationsQueryDto', () => {
  it('accepts an empty query (defaults page=1, limit=10, no filter)', () => {
    const dto = plainToInstance(ListNotificationsQueryDto, {});
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(10);
    expect(dto.filter).toBeUndefined();
  });

  it('accepts filter=unread and filter=all', () => {
    expect(errorsFor({ filter: 'unread' })).toHaveLength(0);
    expect(errorsFor({ filter: 'all' })).toHaveLength(0);
  });

  it('rejects an unknown filter value (no silent coercion)', () => {
    const errs = errorsFor({ filter: 'false' });
    expect(errs).toHaveLength(1);
    expect(errs[0].property).toBe('filter');
  });

  it('rejects limit > 100 and page < 1', () => {
    expect(errorsFor({ limit: 101 })).toHaveLength(1);
    expect(errorsFor({ page: 0 })).toHaveLength(1);
  });

  it('coerces numeric strings for page/limit', () => {
    const dto = plainToInstance(ListNotificationsQueryDto, { page: '2', limit: '25' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(25);
  });
});
