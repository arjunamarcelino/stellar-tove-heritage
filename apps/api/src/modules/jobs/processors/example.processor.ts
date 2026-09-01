import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('example')
export class ExampleProcessor extends WorkerHost {
  private readonly logger = new Logger(ExampleProcessor.name);

  async process(job: Job<{ message: string }>): Promise<void> {
    this.logger.log(`Processing job ${job.id}: ${job.data.message}`);
    // Replace with your actual job logic.
    await Promise.resolve();
  }
}
