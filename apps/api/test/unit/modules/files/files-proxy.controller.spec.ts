import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

import { FilesProxyController } from '@modules/files/files-proxy.controller';
import { FilesService } from '@modules/files/files.service';
import { FileUrlResponseDto } from '@modules/files/dto/file-url-response.dto';

const mockFileUrl = FileUrlResponseDto.create({
  url: 'https://storage.example.com/files/abc.pdf?token=xyz',
  expiresIn: 3600,
  filename: 'report.pdf',
  fileSize: 1024,
});

const mockFilesService = {
  getFileUrl: vi.fn(),
};

describe('FilesProxyController', () => {
  let controller: FilesProxyController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new FilesProxyController(mockFilesService as unknown as FilesService);
  });

  describe('serve', () => {
    it('should return FileUrlResponseDto for valid url path', async () => {
      mockFilesService.getFileUrl.mockResolvedValue(mockFileUrl);

      const result = await controller.serve('annual-report-2026');

      expect(result).toBe(mockFileUrl);
      expect(mockFilesService.getFileUrl).toHaveBeenCalledWith('annual-report-2026');
    });

    it('should accept single-segment slugs', async () => {
      mockFilesService.getFileUrl.mockResolvedValue(mockFileUrl);

      const result = await controller.serve('whitepaper');

      expect(result).toBe(mockFileUrl);
      expect(mockFilesService.getFileUrl).toHaveBeenCalledWith('whitepaper');
    });

    it('should throw NotFoundException for path traversal attempts', async () => {
      await expect(controller.serve('../etc/passwd')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for uppercase characters', async () => {
      await expect(controller.serve('UPPERCASE')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for empty string', async () => {
      await expect(controller.serve('')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for slugs with special characters', async () => {
      await expect(controller.serve('file@name')).rejects.toThrow(NotFoundException);
      await expect(controller.serve('file name')).rejects.toThrow(NotFoundException);
      await expect(controller.serve('file/path')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for leading or trailing hyphens', async () => {
      await expect(controller.serve('-leading')).rejects.toThrow(NotFoundException);
      await expect(controller.serve('trailing-')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for consecutive hyphens', async () => {
      await expect(controller.serve('double--hyphen')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for slugs exceeding 255 characters', async () => {
      const longSlug = 'a'.repeat(256);
      await expect(controller.serve(longSlug)).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).not.toHaveBeenCalled();
    });

    it('should propagate NotFoundException from service', async () => {
      mockFilesService.getFileUrl.mockRejectedValue(new NotFoundException());

      await expect(controller.serve('nonexistent-doc')).rejects.toThrow(NotFoundException);
      expect(mockFilesService.getFileUrl).toHaveBeenCalledWith('nonexistent-doc');
    });
  });
});
