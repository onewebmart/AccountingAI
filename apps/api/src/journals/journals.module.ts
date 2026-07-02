import { Module } from '@nestjs/common';
import { JournalsController } from './journals.controller';

@Module({
  controllers: [JournalsController],
})
export class JournalsModule {}
