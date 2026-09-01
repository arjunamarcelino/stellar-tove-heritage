import { registerDecorator, ValidationOptions } from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

/**
 * Validates that a string is a Stellar G- (ed25519) or C- (contract) StrKey address. A USDC SAC
 * transfer `to` may be either. Declarative so a bad address is a uniform 400, not an ad-hoc service
 * error deep in XDR parsing.
 */
export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value === 'string' &&
            (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
          );
        },
        defaultMessage(): string {
          return '$property must be a valid Stellar address (G... or C...)';
        },
      },
    });
  };
}
