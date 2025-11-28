import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ roomId: string }> }
) {
    const { roomId } = await params;
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }


        const userId = (session.user as { id?: string }).id;

        if (!userId) {
            return NextResponse.json({ error: 'User ID not found' }, { status: 400 });
        }

        // Call NestJS API to force leave
        const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002';
        const response = await fetch(`${backendUrl}/meetings/${roomId}/leave`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ userId }),
        });

        if (!response.ok) {
            console.error('Failed to leave meeting via backend:', await response.text());
            return NextResponse.json({ error: 'Failed to leave meeting on backend' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error leaving meeting:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
