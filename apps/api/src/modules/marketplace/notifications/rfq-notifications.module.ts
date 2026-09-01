import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RfqNotification } from './entities/rfq-notification.entity';
import { RFQ_NOTIFICATION_REPOSITORY } from './repositories/rfq-notification-repository.interface';
import { RfqNotificationRepository } from './repositories/rfq-notification.repository';

/**
 * Neutral marketplace-notifications domain (TOV-174, FR-06.02): the `rfq_notifications` entity/repo + port.
 * Provider-only, config/queue-free — orchestration lives in the surface (`PublicMeNotificationsModule`) and
 * worker (`RfqFanoutWorkerModule`) modules, so this stays importable by the fixed-config integration harness
 * and never drags `OfferingsModule` onto the read path. Binds and exports `RFQ_NOTIFICATION_REPOSITORY` +
 * `TypeOrmModule`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RfqNotification])],
  providers: [{ provide: RFQ_NOTIFICATION_REPOSITORY, useClass: RfqNotificationRepository }],
  exports: [RFQ_NOTIFICATION_REPOSITORY, TypeOrmModule],
})
export class RfqNotificationsModule {}
