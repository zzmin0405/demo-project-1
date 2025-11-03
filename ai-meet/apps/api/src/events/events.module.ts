import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventsGateway } from './events.gateway';

@Module({
  imports: [ConfigModule],
  providers: [EventsGateway],
})
export class EventsModule {}
