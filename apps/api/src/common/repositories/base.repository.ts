import { NotFoundException } from '@nestjs/common';
import {
  Repository,
  DataSource,
  DeepPartial,
  FindOneOptions,
  FindManyOptions,
  FindOptionsWhere,
  EntityManager,
  EntityTarget,
} from 'typeorm';
import { IBaseRepository, HasId } from './base-repository.interface';

export abstract class BaseRepository<T extends HasId> implements IBaseRepository<T> {
  protected readonly repository: Repository<T>;

  constructor(
    private readonly entityTarget: EntityTarget<T>,
    private readonly dataSource: DataSource,
  ) {
    this.repository = this.dataSource.getRepository(this.entityTarget);
  }

  create(data: DeepPartial<T>): T {
    return this.repository.create(data);
  }

  async save(entity: DeepPartial<T>): Promise<T> {
    return this.repository.save(entity);
  }

  async saveMany(entities: DeepPartial<T>[]): Promise<T[]> {
    return this.repository.save(entities);
  }

  async findOneById(id: string): Promise<T | null> {
    return this.repository.findOne({
      where: { id } as FindOptionsWhere<T>,
    });
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne(options);
  }

  async findAll(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repository.find(options);
  }

  async findWithPagination(
    options: FindManyOptions<T>,
    page: number,
    limit: number,
  ): Promise<[T[], number]> {
    return this.repository.findAndCount({
      ...options,
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async update(id: string, data: DeepPartial<T>): Promise<T> {
    const entity = await this.findOneById(id);
    if (!entity) {
      throw new NotFoundException(`Entity with id ${id} not found`);
    }
    Object.assign(entity, data);
    return this.repository.save(entity);
  }

  async softRemove(entity: T): Promise<T> {
    return this.repository.softRemove(entity);
  }

  async count(options?: FindManyOptions<T>): Promise<number> {
    return this.repository.count(options);
  }

  async exists(where: FindOptionsWhere<T>): Promise<boolean> {
    return this.repository.existsBy(where);
  }

  async runInTransaction<R>(work: (manager: EntityManager) => Promise<R>): Promise<R> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
