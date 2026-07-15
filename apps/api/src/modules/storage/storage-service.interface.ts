export interface IStorageService {
  upload(path: string, buffer: Buffer, contentType: string): Promise<void>;
  createTemporaryUrl(path: string, expiresIn: number): Promise<string>;
  delete(path: string): Promise<void>;
}
