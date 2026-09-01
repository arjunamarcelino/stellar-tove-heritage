import { IKycStorageService } from '@modules/kyc/kyc.util';

/**
 * In-memory {@link IKycStorageService} for tests — keeps encrypted blobs in a Map so the KYC suites never
 * touch a real Supabase bucket (mirrors the FakeRelayerService pattern). Override the `KYC_STORAGE`
 * provider with an instance of this.
 */
export class InMemoryStorage implements IKycStorageService {
  readonly objects = new Map<string, Buffer>();
  /** Set to true to make the next upload throw (simulate a mid-batch storage failure). */
  failNextUpload = false;

  upload(path: string, buffer: Buffer): Promise<void> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      return Promise.reject(new Error('simulated storage failure'));
    }
    this.objects.set(path, buffer);
    return Promise.resolve();
  }

  createTemporaryUrl(path: string): Promise<string> {
    return Promise.resolve(`memory://${path}`);
  }

  delete(path: string): Promise<void> {
    this.objects.delete(path);
    return Promise.resolve();
  }

  listObjectsOlderThan(): Promise<string[]> {
    return Promise.resolve([...this.objects.keys()]);
  }
}
