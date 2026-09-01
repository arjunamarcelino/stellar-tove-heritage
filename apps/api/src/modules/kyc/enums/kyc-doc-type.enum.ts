/** The four identity documents a KYC submission carries (TOV-28, FR-01.07). */
export enum KycDocType {
  GOV_ID_FRONT = 'gov_id_front',
  GOV_ID_BACK = 'gov_id_back',
  PROOF_OF_ADDRESS = 'proof_of_address',
  SELFIE = 'selfie',
}

/**
 * The required documents, in a fixed order. A `readonly` tuple (not just the enum) so callers get an
 * ordered iterable and "exactly these four" is a compile-time fact; `satisfies` verifies every member is
 * a real {@link KycDocType}.
 */
export const KYC_REQUIRED_DOC_TYPES = [
  KycDocType.GOV_ID_FRONT,
  KycDocType.GOV_ID_BACK,
  KycDocType.PROOF_OF_ADDRESS,
  KycDocType.SELFIE,
] as const satisfies readonly KycDocType[];
