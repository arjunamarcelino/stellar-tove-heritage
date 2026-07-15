import {
  ObjectLiteral,
  DeepPartial,
  FindOneOptions,
  FindManyOptions,
  FindOptionsWhere,
  EntityManager,
} from 'typeorm';

export interface HasId extends ObjectLiteral {
  id: string;
}

export interface IBaseRepository<T extends HasId> {
  create(data: DeepPartial<T>): T;
  save(entity: DeepPartial<T>): Promise<T>;
  saveMany(entities: DeepPartial<T>[]): Promise<T[]>;
  findOneById(id: string): Promise<T | null>;
  findOne(options: FindOneOptions<T>): Promise<T | null>;
  findAll(options?: FindManyOptions<T>): Promise<T[]>;
  findWithPagination(
    options: FindManyOptions<T>,
    page: number,
    limit: number,
  ): Promise<[T[], number]>;
  update(id: string, data: DeepPartial<T>): Promise<T>;
  softRemove(entity: T): Promise<T>;
  count(options?: FindManyOptions<T>): Promise<number>;
  exists(where: FindOptionsWhere<T>): Promise<boolean>;
  runInTransaction<R>(work: (manager: EntityManager) => Promise<R>): Promise<R>;
}
