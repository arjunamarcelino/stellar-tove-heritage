/**
 * Un-paginated list envelope: `{ data: [...] }`.
 *
 * Used by anonymous public browse endpoints (artworks, artists). Kept distinct
 * from `PaginatedResponseDto` (which requires a `meta`); when pagination lands
 * (TOV-199) those endpoints switch to the paginated envelope.
 *
 * `data` intentionally carries no `@ApiProperty` — the generic `T` is erased at
 * runtime, so document it at the call site with `ApiCollectionResponse(Model)`.
 */
export class CollectionResponseDto<T> {
  readonly data: T[];

  private constructor(data: readonly T[]) {
    // Defensive copy so a response never aliases a source (e.g. fixture) array.
    this.data = [...data];
  }

  static create<T>(data: readonly T[]): CollectionResponseDto<T> {
    return new CollectionResponseDto<T>(data);
  }
}
