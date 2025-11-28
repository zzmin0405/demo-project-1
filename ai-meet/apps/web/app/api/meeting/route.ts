import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { title, isChatSaved } = body;

        // Find user by email to get ID
        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const meeting = await prisma.meetingRoom.create({
            data: {
                title: title || 'Untitled Meeting',
                creatorId: user.id,
                isChatSaved: isChatSaved ?? true,
            },
        });

        return NextResponse.json({ roomId: meeting.id });
    } catch (error) {
        console.error('Error creating meeting:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
