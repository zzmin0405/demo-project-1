import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_SOURCE_CHARS = 30000;

type TimelineItem = {
    at: Date;
    text: string;
};

type ChatLogWithUser = Prisma.ChatLogGetPayload<{
    include: { user: { select: { name: true; email: true } } };
}>;

type SttTranscriptLogWithUser = Prisma.SttTranscriptLogGetPayload<{
    include: { user: { select: { name: true; email: true } } };
}>;

function extractResponseText(response: unknown): string {
    if (typeof response !== 'object' || response === null) return '';

    const maybeOutputText = (response as { output_text?: unknown }).output_text;
    if (typeof maybeOutputText === 'string') return maybeOutputText.trim();

    const output = (response as { output?: unknown }).output;
    if (!Array.isArray(output)) return '';

    return output
        .flatMap((item) => {
            if (typeof item !== 'object' || item === null) return [];
            const content = (item as { content?: unknown }).content;
            return Array.isArray(content) ? content : [];
        })
        .map((contentItem) => {
            if (typeof contentItem !== 'object' || contentItem === null) return '';
            const text = (contentItem as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
}

function buildSourceText(items: TimelineItem[]): string {
    const fullText = items
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map((item) => `[${item.at.toISOString()}] ${item.text}`)
        .join('\n');

    if (fullText.length <= MAX_SOURCE_CHARS) return fullText;
    return fullText.slice(fullText.length - MAX_SOURCE_CHARS);
}

export async function GET(
    req: Request,
    { params }: { params: Promise<{ roomId: string }> }
) {
    const { roomId } = await params;

    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true },
        });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const room = await prisma.meetingRoom.findUnique({
            where: { id: roomId },
            select: { creatorId: true },
        });
        if (!room) {
            return NextResponse.json({ error: 'Room not found' }, { status: 404 });
        }

        const participant = await prisma.participant.findUnique({
            where: {
                userId_meetingRoomId: {
                    userId: user.id,
                    meetingRoomId: roomId,
                },
            },
            select: { id: true },
        });
        if (room.creatorId !== user.id && !participant) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const summaries = await prisma.meetingSummary.findMany({
            where: { meetingRoomId: roomId },
            orderBy: { createdAt: 'desc' },
        });

        return NextResponse.json({ summaries });
    } catch (error) {
        console.error('Error fetching meeting summaries:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

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

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 500 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true },
        });
        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const room = await prisma.meetingRoom.findUnique({
            where: { id: roomId },
            select: { id: true, title: true, creatorId: true },
        });
        if (!room) {
            return NextResponse.json({ error: 'Room not found' }, { status: 404 });
        }
        if (room.creatorId !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const [chatLogs, sttLogs] = await Promise.all([
            prisma.chatLog.findMany({
                where: { meetingRoomId: roomId },
                orderBy: { createdAt: 'asc' },
                include: { user: { select: { name: true, email: true } } },
            }),
            prisma.sttTranscriptLog.findMany({
                where: { meetingRoomId: roomId },
                orderBy: { capturedAt: 'asc' },
                include: { user: { select: { name: true, email: true } } },
            }),
        ]);

        const timeline: TimelineItem[] = [
            ...chatLogs.map((log: ChatLogWithUser) => ({
                at: log.createdAt,
                text: `채팅 / ${log.user.name || log.user.email || 'Unknown'}: ${log.content}`,
            })),
            ...sttLogs.map((log: SttTranscriptLogWithUser) => ({
                at: log.capturedAt,
                text: `STT / ${log.user.name || log.user.email || 'Unknown'}: ${log.originalText}`,
            })),
        ];

        if (timeline.length === 0) {
            return NextResponse.json({ error: 'No saved meeting content to summarize' }, { status: 400 });
        }

        const sourceText = buildSourceText(timeline);
        const model = process.env.OPENAI_SUMMARY_MODEL || 'gpt-5-mini';

        const openAiResponse = await fetch(OPENAI_RESPONSES_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                input: [
                    {
                        role: 'system',
                        content: 'You summarize meeting transcripts in Korean. Be concise, faithful to the source, and do not invent details.',
                    },
                    {
                        role: 'user',
                        content: [
                            `회의 제목: ${room.title}`,
                            '',
                            '아래 저장된 채팅과 STT 기록을 바탕으로 한국어 회의 요약을 작성해줘.',
                            '',
                            '형식:',
                            '1. 핵심 요약',
                            '2. 주요 논의 내용',
                            '3. 결정 사항',
                            '4. 할 일',
                            '5. 미해결 질문',
                            '',
                            '내용이 없으면 "없음"이라고 적어.',
                            '',
                            sourceText,
                        ].join('\n'),
                    },
                ],
            }),
        });

        if (!openAiResponse.ok) {
            const errorText = await openAiResponse.text();
            console.error('OpenAI summary request failed:', errorText);
            return NextResponse.json({ error: 'Failed to summarize meeting' }, { status: 502 });
        }

        const responseJson = await openAiResponse.json();
        const summaryText = extractResponseText(responseJson);
        if (!summaryText) {
            return NextResponse.json({ error: 'Empty summary response' }, { status: 502 });
        }

        const summary = await prisma.meetingSummary.create({
            data: {
                content: summaryText,
                meetingRoomId: roomId,
            },
        });

        return NextResponse.json({
            summary,
            sourceCounts: {
                chatLogs: chatLogs.length,
                sttTranscriptLogs: sttLogs.length,
            },
        });
    } catch (error) {
        console.error('Error generating meeting summary:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
