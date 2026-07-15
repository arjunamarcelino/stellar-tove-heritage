import { registerDecorator, ValidationOptions } from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validates a Stellar **ed25519 G-address** (StrKey, including the CRC checksum) — for BYOW public keys
 * (TOV-24). Stricter than {@link IsStellarAddress} (which also accepts C-contract addresses) and than a
 * shape-only regex (which passes malformed-but-well-shaped keys), so a bad key is a uniform 400 at the
 * boundary rather than an error deep inside challenge building.
 */
export function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
        },
        defaultMessage(): string {
          return '$property must be a valid Stellar public key (G...)';
        },
      },
    });
  };
}
