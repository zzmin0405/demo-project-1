import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EventsGateway } from './events/events.gateway';
import { PrismaService } from './prisma/prisma.service';
import { MeetingsController } from './meetings/meetings.controller';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, MeetingsController],
  providers: [AppService, EventsGateway, PrismaService],
})
export class AppModule { }
