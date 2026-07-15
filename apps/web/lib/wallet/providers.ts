import type { ProviderId } from '@/lib/types/api';

export interface WalletProviderMeta {
  readonly id: ProviderId;
  readonly name: string;
  readonly icon: string;
  readonly installUrl?: string;
}

export const WALLET_PROVIDERS: WalletProviderMeta[] = [
  {
    id: 'freighter',
    name: 'Freighter',
    icon: '/wallets/freighter.svg',
    installUrl: 'https://www.freighter.app/',
  },
  {
    id: 'albedo',
    name: 'Albedo',
    icon: '/wallets/albedo.svg',
  },
];
