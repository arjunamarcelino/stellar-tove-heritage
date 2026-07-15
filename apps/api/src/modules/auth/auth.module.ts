import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '@modules/users/users.module';
import { UserStagesModule } from '@modules/stages/stages.module';
import { WalletsModule } from '@modules/wallets/wallets.module';
import { RelayerModule } from '@modules/relayer/relayer.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Sep10Service } from './sep10.service';
import { Sep10Controller } from './sep10.controller';
import { PasskeyService } from './passkey.service';
import { PasskeyController } from './passkey.controller';
import { AuthChallenge } from './entities/auth-challenge.entity';
import { PasskeyChallenge } from './entities/passkey-challenge.entity';
import { AuthChallengeRepository } from './repositories/auth-challenge.repository';
import { AUTH_CHALLENGE_REPOSITORY } from './repositories/auth-challenge-repository.interface';
import { PasskeyChallengeRepository } from './repositories/passkey-challenge.repository';
import { PASSKEY_CHALLENGE_REPOSITORY } from './repositories/passkey-challenge-repository.interface';

@Module({
  imports: [
    JwtModule.register({}),
    UsersModule,
    UserStagesModule,
    WalletsModule,
    RelayerModule,
    TypeOrmModule.forFeature([AuthChallenge, PasskeyChallenge]),
  ],
  controllers: [AuthController, Sep10Controller, PasskeyController],
  providers: [
    AuthService,
    Sep10Service,
    PasskeyService,
    { provide: AUTH_CHALLENGE_REPOSITORY, useClass: AuthChallengeRepository },
    { provide: PASSKEY_CHALLENGE_REPOSITORY, useClass: PasskeyChallengeRepository },
  ],
  // Sep10Service is exported so the TOV-24 me/wallets bind surface can issue user-bound challenges and
  // verify signed bind challenges (reusing the audited SEP-10 crypto) without duplicating it.
  exports: [JwtModule, Sep10Service],
})
export class AuthModule {}
