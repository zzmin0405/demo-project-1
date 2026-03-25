const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log('Start seeding for Graduation requirements (JS)...');

    // 1. Generate 110 Users
    console.log('Seeding 110 users...');
    const usersData = [];
    for (let i = 1; i <= 110; i++) {
        usersData.push({
            name: `User_${i}`,
            email: `user${i}@example.com`,
        });
    }
    await prisma.user.createMany({
        data: usersData,
        skipDuplicates: true,
    });

    const allUsers = await prisma.user.findMany({ take: 110 });
    const creator = allUsers[0];

    // 2. Generate 110 MeetingRooms
    console.log('Seeding 110 meeting rooms...');
    const roomsData = [];
    for (let i = 1; i <= 110; i++) {
        roomsData.push({
            title: `Graduation Project Meeting #${i}`,
            description: `Auto-generated meeting for requirement validation #${i}`,
            creatorId: creator.id,
        });
    }
    await prisma.meetingRoom.createMany({ data: roomsData });

    const allRooms = await prisma.meetingRoom.findMany({ take: 110 });

    // 3. Generate 200+ Participants
    console.log('Seeding 200 participants...');
    const participantsData = [];
    for (let i = 0; i < 200; i++) {
        const userIdx = i % allUsers.length;
        const roomIdx = Math.floor(i / 2) % allRooms.length;
        participantsData.push({
            userId: allUsers[userIdx].id,
            meetingRoomId: allRooms[roomIdx].id,
            role: i % 5 === 0 ? 'HOST' : 'PARTICIPANT',
        });
    }
    await prisma.participant.createMany({ 
        data: participantsData,
        skipDuplicates: true
    });

    // 4. Generate 500+ ChatLogs
    console.log('Seeding 500 chat logs...');
    const chatData = [];
    const messages = [
        "Hello everyone!", "Is the screen share working?", "Lets start the meeting.",
        "Today's topic is about AI nodes.", "WebSockets are very fast.",
        "Check the document I shared.", "Great job on the UI!",
        "Testing real-time latency...", "PostgreSQL is stable.",
        "Prisma makes DB tasks easy.", "Finalizing graduation requirements."
    ];

    for (let i = 1; i <= 500; i++) {
        const userIdx = i % allUsers.length;
        const roomIdx = i % allRooms.length;
        chatData.push({
            content: messages[i % messages.length] + ` (Log #${i})`,
            userId: allUsers[userIdx].id,
            meetingRoomId: allRooms[roomIdx].id,
        });
    }
    await prisma.chatLog.createMany({ data: chatData });

    console.log('Seeding finished successfully.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
