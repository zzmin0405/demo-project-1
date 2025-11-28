import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function PUT(req: Request) {
    // Force Vercel Rebuild: 2025-11-28
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: session.user.id },
            select: { lastProfileUpdate: true },
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        // Rate Limiting: Check if 24 hours have passed
        if (user.lastProfileUpdate) {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (user.lastProfileUpdate > oneDayAgo) {
                return NextResponse.json(
                    { error: "프로필은 하루에 한 번만 변경할 수 있습니다." },
                    { status: 429 }
                );
            }
        }

        const body = await req.json();
        const { name, image } = body;

        // Validation: Name length
        if (name && name.length > 50) {
            return NextResponse.json({ error: "이름은 50자를 초과할 수 없습니다." }, { status: 400 });
        }

        const updatedUser = await prisma.user.update({
            where: { id: session.user.id },
            data: {
                name: name || undefined,
                image: image || undefined,
                lastProfileUpdate: new Date(),
            },
        });

        return NextResponse.json(updatedUser);
    } catch (error) {
        console.error("Error updating profile:", error);
        return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }
}
