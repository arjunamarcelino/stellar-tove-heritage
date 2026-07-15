import { registerDecorator, ValidationOptions } from 'class-validator';

// base64url alphabet, no padding (WebAuthn assertion fields are base64url-encoded by the client).
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Validates that a string is non-empty base64url (no padding). Using the wrong decoder on an
 * assertion field silently yields garbage bytes that fail crypto as a confusing SIGNATURE_INVALID;
 * validating the charset up front makes it a clean 400 instead.
 */
export function IsBase64Url(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isBase64Url',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return typeof value === 'string' && value.length > 0 && BASE64URL_RE.test(value);
        },
        defaultMessage(): string {
          return '$property must be a base64url string';
        },
      },
    });
  };
}
