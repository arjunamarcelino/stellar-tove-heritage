import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';

@Module({
  providers: [
    { provide: 'IStorageService', useClass: SupabaseStorageService },
  ],
  exports: ['IStorageService'],
})
export class StorageModule {}
