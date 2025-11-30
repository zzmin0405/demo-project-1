import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ roomId: string }> }
) {
    const { roomId } = await params;
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify ownership

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const room = await prisma.meetingRoom.findUnique({
            where: { id: roomId },
        });

        if (!room) {
            return NextResponse.json({ error: 'Room not found' }, { status: 404 });
        }

        if (room.creatorId !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Call NestJS API to force delete and kick users
        // Use localhost for server-to-server communication to avoid DNS issues with Cloudflare Tunnel
        let backendUrl = 'http://127.0.0.1:3001';

        // In production (Vercel), we might need to use the Cloudflare URL if the backend is not on the same host (which it isn't)
        // But since Vercel cannot reach localhost:3001 of the user's machine, we MUST use the Cloudflare URL.
        if (process.env.NODE_ENV === 'production') {
            backendUrl = process.env.BACKEND_URL || 'https://YOUR-CLOUDFLARE-URL.trycloudflare.com';
        }

        const response = await fetch(`${backendUrl}/meetings/${roomId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to delete meeting via backend:', errorText);
            return NextResponse.json({ error: `Backend Error: ${response.status} - ${errorText}` }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting meeting:', error);
        return NextResponse.json({
            error: `Internal Error: ${error instanceof Error ? error.message : String(error)}`,
            backendUrl: 'https://athletics-blackberry-hygiene-excluded.trycloudflare.com'
        }, { status: 500 });
    }
}
