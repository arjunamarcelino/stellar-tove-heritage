import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { PaginatedResponseDto } from '@common/dto/paginated-response.dto';

/**
 * Documents a `{ data: Model[], meta: PaginationMeta }` paginated response in OpenAPI. Needed because
 * `PaginatedResponseDto<T>`'s generic `data` is erased — `@ApiOkResponse({ type, isArray: true })` would
 * otherwise misreport the response as a bare top-level array. Mirrors `ApiCollectionResponse`.
 */
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(PaginatedResponseDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PaginatedResponseDto) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
