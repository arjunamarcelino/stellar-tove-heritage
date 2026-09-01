import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecondaryTrade } from './entities/secondary-trade.entity';
import { SECONDARY_TRADE_REPOSITORY } from './repositories/secondary-trade-repository.interface';
import { SecondaryTradeRepository } from './repositories/secondary-trade.repository';

/**
 * Neutral secondary-settlement domain (TOV-177): the `secondary_trades` entity + `SECONDARY_TRADE_REPOSITORY`
 * port. Config-free and provider-only (no route surface), so the integration harness can import it standalone
 * and the later public accept surface + settle worker layer on top of it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SecondaryTrade])],
  providers: [{ provide: SECONDARY_TRADE_REPOSITORY, useClass: SecondaryTradeRepository }],
  exports: [SECONDARY_TRADE_REPOSITORY, TypeOrmModule],
})
export class SettlementModule {}
