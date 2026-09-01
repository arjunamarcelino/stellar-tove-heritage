import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { profileImageConfig } from '@config/profile-image.config';
import {
  PROFILE_MAINTENANCE_QUEUE,
  PROFILE_RECONCILE_JOB,
  PROFILE_REAP_JOB,
  PROFILE_MAINTENANCE_CRON,
} from '../constants/profile-image.constants';

/**
 * Registers the two repeatable maintenance jobs on boot (TOV-30), gated by `maintenanceEnabled` (off in
 * tests so no schedule fires). Idempotent: BullMQ dedups a repeatable by its (name, repeat) key, so
 * re-adding every boot is safe.
 */
@Injectable()
export class ProfileImageMaintenanceScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(PROFILE_MAINTENANCE_QUEUE) private readonly queue: Queue,
    @Inject(profileImageConfig.KEY) private readonly cfg: ConfigType<typeof profileImageConfig>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.cfg.maintenanceEnabled) return;
    const opts = { repeat: { pattern: PROFILE_MAINTENANCE_CRON }, removeOnComplete: true, removeOnFail: 100 };
    await this.queue.add(PROFILE_RECONCILE_JOB, {}, opts);
    await this.queue.add(PROFILE_REAP_JOB, {}, opts);
  }
}
