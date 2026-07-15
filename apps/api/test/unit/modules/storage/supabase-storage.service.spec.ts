import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { SupabaseStorageService } from '@modules/storage/supabase-storage.service';
import { supabaseConfig } from '@config/supabase.config';

const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();
const mockRemove = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        createSignedUrl: mockCreateSignedUrl,
        remove: mockRemove,
      })),
    },
  })),
}));

describe('SupabaseStorageService', () => {
  let service: SupabaseStorageService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseStorageService,
        {
          provide: supabaseConfig.KEY,
          useValue: {
            url: 'https://test.supabase.co',
            serviceRoleKey: 'test-key',
            bucket: 'test-bucket',
          },
        },
      ],
    }).compile();

    service = module.get<SupabaseStorageService>(SupabaseStorageService);
  });

  describe('upload', () => {
    it('should upload buffer to supabase storage', async () => {
      mockUpload.mockResolvedValue({ error: null });

      const buffer = Buffer.from('test content');
      await service.upload('test.pdf', buffer, 'application/pdf');

      expect(mockUpload).toHaveBeenCalledWith('test.pdf', buffer, {
        contentType: 'application/pdf',
        upsert: false,
      });
    });

    it('should throw InternalServerErrorException on upload failure', async () => {
      mockUpload.mockResolvedValue({
        error: { message: 'Bucket not found' },
      });

      await expect(
        service.upload('test.pdf', Buffer.from('data'), 'application/pdf'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('createTemporaryUrl', () => {
    it('should return signed URL on success', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: 'https://test.supabase.co/storage/v1/object/sign/test-bucket/test.pdf?token=abc' },
        error: null,
      });

      const result = await service.createTemporaryUrl('test.pdf', 3600);

      expect(result).toBe('https://test.supabase.co/storage/v1/object/sign/test-bucket/test.pdf?token=abc');
      expect(mockCreateSignedUrl).toHaveBeenCalledWith('test.pdf', 3600);
    });

    it('should throw InternalServerErrorException on SDK error', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: null,
        error: { message: 'Object not found' },
      });

      await expect(service.createTemporaryUrl('missing.pdf', 3600)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should throw InternalServerErrorException when signedUrl is null', async () => {
      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl: null },
        error: null,
      });

      await expect(service.createTemporaryUrl('test.pdf', 3600)).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  describe('delete', () => {
    it('should call remove on supabase storage', async () => {
      mockRemove.mockResolvedValue({ error: null });

      await service.delete('test.pdf');

      expect(mockRemove).toHaveBeenCalledWith(['test.pdf']);
    });

    it('should not throw on delete failure (idempotent)', async () => {
      mockRemove.mockResolvedValue({
        error: { message: 'Object not found' },
      });

      await expect(service.delete('missing.pdf')).resolves.not.toThrow();
    });
  });
});
