import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
import { CollectionResponseDto } from '@common/dto/collection-response.dto';

/**
 * Documents a `{ data: Model[] }` collection response in OpenAPI. Needed because
 * `CollectionResponseDto<T>`'s generic `data` is erased and would otherwise
 * render as an untyped array.
 */
export const ApiCollectionResponse = <TModel extends Type<unknown>>(model: TModel) =>
  applyDecorators(
    ApiExtraModels(CollectionResponseDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(CollectionResponseDto) },
          {
            properties: {
              data: { type: 'array', items: { $ref: getSchemaPath(model) } },
            },
          },
        ],
      },
    }),
  );
