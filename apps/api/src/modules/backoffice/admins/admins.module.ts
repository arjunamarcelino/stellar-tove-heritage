import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { Admin } from './entities/admin.entity';
import { AdminRepository } from './repositories/admin.repository';
import { AdminsService } from './admins.service';
import { AdminsController } from './admins.controller';
import { BackofficeGuard } from '@common/guards/backoffice.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Admin]), JwtModule.register({})],
  controllers: [AdminsController],
  providers: [
    { provide: 'IAdminRepository', useClass: AdminRepository },
    AdminsService,
    BackofficeGuard,
  ],
  exports: [AdminsService],
})
export class AdminsModule {}
