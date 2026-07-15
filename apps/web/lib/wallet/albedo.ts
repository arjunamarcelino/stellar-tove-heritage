'use client';

import type { WalletProvider, WalletResult } from '@/lib/types/api';

async function getAlbedo() {
  const mod = await import('@albedo-link/intent');
  return mod.default;
}

export const albedoProvider: WalletProvider = {
  async getPublicKey(): Promise<WalletResult<string>> {
    try {
      const albedo = await getAlbedo();
      const result = await albedo.publicKey({});
      return { status: 'success', data: result.pubkey };
    } catch (err) {
      if (err instanceof Error && err.message?.includes('cancelled')) {
        return {
          status: 'error',
          code: 'USER_CANCELLED',
          message: 'Request was cancelled.',
        };
      }
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: 'Failed to connect to Albedo. Please try again.',
      };
    }
  },

  async signTransaction(
    xdr: string,
    networkPassphrase: string,
  ): Promise<WalletResult<string>> {
    try {
      const albedo = await getAlbedo();
      const result = await albedo.tx({
        xdr,
        network: networkPassphrase,
      });
      return { status: 'success', data: result.signed_envelope_xdr };
    } catch (err) {
      if (err instanceof Error && err.message?.includes('cancelled')) {
        return {
          status: 'error',
          code: 'USER_CANCELLED',
          message: 'Signing was cancelled.',
        };
      }
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: 'Failed to connect to Albedo. Please try again.',
      };
    }
  },
};
