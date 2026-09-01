import { describe, it, expect, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { RfqFanoutProcessor } from '../../../../src/modules/marketplace/notifications/fanout/rfq-fanout.processor';
import { TerminalFanoutError } from '../../../../src/modules/marketplace/notifications/constants/rfq-notification.constants';

const job = (rfqId: string) => ({ data: { rfqId } }) as never;

describe('RfqFanoutProcessor', () => {
  it('delegates to the fan-out service', async () => {
    const svc = { fanout: vi.fn(() => Promise.resolve()) };
    const proc = new RfqFanoutProcessor(svc as never);
    await proc.process(job('r1'));
    expect(svc.fanout).toHaveBeenCalledWith('r1');
  });

  it('maps a TerminalFanoutError to UnrecoverableError (stops retries)', async () => {
    const svc = { fanout: vi.fn(() => Promise.reject(new TerminalFanoutError('gone'))) };
    const proc = new RfqFanoutProcessor(svc as never);
    await expect(proc.process(job('r1'))).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('rethrows a transient error unchanged (BullMQ retries)', async () => {
    const boom = new Error('db reset');
    const svc = { fanout: vi.fn(() => Promise.reject(boom)) };
    const proc = new RfqFanoutProcessor(svc as never);
    await expect(proc.process(job('r1'))).rejects.toBe(boom);
  });
});
