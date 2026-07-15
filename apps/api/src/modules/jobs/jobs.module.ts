import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExampleProcessor } from './processors/example.processor';

@Module({
  imports: [BullModule.registerQueue({ name: 'example' })],
  providers: [ExampleProcessor],
})
export class JobsModule {}
