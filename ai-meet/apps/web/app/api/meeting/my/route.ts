import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const meetings = await prisma.meetingRoom.findMany({
            where: { creatorId: user.id },
            orderBy: { createdAt: 'desc' },
            include: {
                _count: {
                    select: {
                        participants: {
                            where: {
                                leftAt: null
                            }
                        }
                    }
                }
            }
        });

        return NextResponse.json({ meetings });
    } catch (error) {
        console.error('Error fetching my meetings:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
