import { Module } from '@nestjs/common';
import { RfqNotificationsModule } from './rfq-notifications.module';
import { MeNotificationsController } from './me-notifications.controller';
import { MeNotificationsService } from './me-notifications.service';

/**
 * Public authenticated RFQ notifications inbox surface (TOV-174, FR-06.02), added to `PUBLIC_MODULES`
 * (`api/v1/me/notifications`). Layers the controller + read service on the neutral `RfqNotificationsModule`
 * (for `RFQ_NOTIFICATION_REPOSITORY`). The repo's inbox JOIN reaches `rfqs`/`artworks` by table name, so no
 * OfferingsModule edge lands on the read path (mirrors `PublicMeHoldingsModule`).
 */
@Module({
  imports: [RfqNotificationsModule],
  controllers: [MeNotificationsController],
  providers: [MeNotificationsService],
})
export class PublicMeNotificationsModule {}
