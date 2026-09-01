import type { EvidenceType, VerificationMethod } from './schemas';

export const evidenceVariant: Record<EvidenceType, 'default' | 'secondary' | 'outline'> = {
  file: 'default',
  url: 'secondary',
  text: 'outline',
};

export const verificationLabel: Record<VerificationMethod, string> = {
  manual: 'Manual',
  auto_x_follow: 'Auto X Follow',
  auto_instagram_follow: 'Auto Instagram Follow',
};
