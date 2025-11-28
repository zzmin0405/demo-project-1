import { Controller, Delete, Param, InternalServerErrorException, Post, Body } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';

@Controller('meetings')
export class MeetingsController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly eventsGateway: EventsGateway,
    ) { }

    @Delete(':id')
    async deleteMeeting(@Param('id') id: string) {
        try {
            // 1. Force kick everyone
            await this.eventsGateway.forceDeleteRoom(id);

            // 2. Delete related records manually (since Cascade is not set in schema)
            await this.prisma.participant.deleteMany({ where: { meetingRoomId: id } });
            await this.prisma.chatLog.deleteMany({ where: { meetingRoomId: id } });
            await this.prisma.meetingSummary.deleteMany({ where: { meetingRoomId: id } });

            // 3. Delete the room
            await this.prisma.meetingRoom.delete({
                where: { id },
            });

            return { success: true, message: 'Meeting deleted and participants kicked.' };
        } catch (error) {
            console.error('Error deleting meeting:', error);
            throw new InternalServerErrorException('Failed to delete meeting');
        }
    }

    @Post(':id/leave')
    async leaveMeeting(@Param('id') roomId: string, @Body() body: { userId: string }) {
        if (!body.userId) {
            throw new InternalServerErrorException('UserId is required');
        }
        await this.eventsGateway.leaveRoomByUserId(roomId, body.userId);
        return { success: true };
    }
}
