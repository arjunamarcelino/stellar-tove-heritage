import { Injectable, Inject, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { supabaseConfig } from '@config/supabase.config';
import { IStorageService } from './storage-service.interface';

@Injectable()
export class SupabaseStorageService implements IStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;

  constructor(
    @Inject(supabaseConfig.KEY)
    private readonly config: ConfigType<typeof supabaseConfig>,
  ) {
    // SECURITY: This client uses the service role key which bypasses RLS.
    // It must ONLY be used for storage operations.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.supabase = createClient(config.url!, config.serviceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      realtime: {
        transport: WebSocket as unknown as typeof globalThis.WebSocket,
      },
    });
    this.bucket = config.bucket!;
  }

  async upload(path: string, buffer: Buffer, contentType: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType, upsert: false });

    if (error) {
      this.logger.error(`Failed to upload file to ${path}: ${error.message}`);
      throw new InternalServerErrorException('Failed to upload file');
    }
  }

  async createTemporaryUrl(path: string, expiresIn: number): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresIn);

    if (error || !data?.signedUrl) {
      this.logger.error(`Failed to create signed URL for ${path}: ${error?.message}`);
      throw new InternalServerErrorException('Failed to generate file URL');
    }

    return data.signedUrl;
  }

  async delete(path: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .remove([path]);

    if (error) {
      this.logger.error(`Failed to delete file ${path}: ${error.message}`);
    }
  }
}
