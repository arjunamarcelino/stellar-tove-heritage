'use client';

import type { WalletProvider, WalletResult } from '@/lib/types/api';

async function getFreighterApi() {
  return import('@stellar/freighter-api');
}

export const freighterProvider: WalletProvider = {
  async getPublicKey(): Promise<WalletResult<string>> {
    try {
      const { isConnected, requestAccess } = await getFreighterApi();
      const connected = await isConnected();
      if (!connected.isConnected) {
        return {
          status: 'error',
          code: 'EXTENSION_NOT_FOUND',
          message: 'Freighter extension not found. Please install it to continue.',
        };
      }

      const access = await requestAccess();
      if (access.error) {
        return {
          status: 'error',
          code: 'USER_CANCELLED',
          message: 'Access request was cancelled.',
        };
      }

      return { status: 'success', data: access.address };
    } catch {
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: 'Failed to connect to Freighter.',
      };
    }
  },

  async signTransaction(
    xdr: string,
    networkPassphrase: string,
  ): Promise<WalletResult<string>> {
    try {
      const { getNetwork, signTransaction } = await getFreighterApi();

      const network = await getNetwork();
      if (network.networkPassphrase !== networkPassphrase) {
        return {
          status: 'error',
          code: 'NETWORK_MISMATCH',
          message: `Please switch Freighter to the correct network.`,
        };
      }

      const result = await signTransaction(xdr, { networkPassphrase });
      if (result.error) {
        return {
          status: 'error',
          code: 'USER_CANCELLED',
          message: 'Transaction signing was cancelled.',
        };
      }

      return { status: 'success', data: result.signedTxXdr };
    } catch {
      return {
        status: 'error',
        code: 'NETWORK_ERROR',
        message: 'Failed to sign transaction with Freighter.',
      };
    }
  },
};
