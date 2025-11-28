import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
        return NextResponse.json({ error: 'Room ID is required' }, { status: 400 });
    }

    try {
        const meetingRoom = await prisma.meetingRoom.findUnique({
            where: { id: roomId },
            select: { id: true, title: true }
        });

        if (!meetingRoom) {
            return NextResponse.json({ valid: false }, { status: 404 });
        }

        return NextResponse.json({ valid: true, title: meetingRoom.title });
    } catch (error) {
        console.error('Error validating room:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
