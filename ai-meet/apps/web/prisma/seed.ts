
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Start seeding...');

    // 1. Get a valid user to be the creator
    const user = await prisma.user.findFirst();

    if (!user) {
        console.error('No users found. Please login or create a user via the app first.');
        return;
    }

    const creatorId = user.id;
    console.log(`Using creatorId: ${creatorId}`);

    // 2. Prepare Data
    const BATCH_SIZE = 1000;
    const TOTAL_RECORDS = 10000;

    const adjectives = ['Daily', 'Weekly', 'Monthly', 'Emergency', 'Quarterly', 'Annual', 'Quick', 'Deep', 'Brainstorming'];
    const nouns = ['Sync', 'Standup', 'Review', 'Planning', 'Retrospective', 'De-brief', 'Workshop', 'Demo'];
    const projects = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Phoenix', 'Apollo', 'Zeus', 'Hades'];

    const data = [];

    for (let i = 0; i < TOTAL_RECORDS; i++) {
        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const proj = projects[Math.floor(Math.random() * projects.length)];
        const randomId = Math.floor(Math.random() * 10000);

        data.push({
            title: `${adj} ${noun} - Project ${proj} #${randomId}`,
            description: `Generated for performance testing #${i}`,
            creatorId: creatorId,
            updatedAt: new Date(),
        });
    }

    // 3. Insert in batches
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
        const batch = data.slice(i, i + BATCH_SIZE);
        await prisma.meetingRoom.createMany({
            data: batch,
        });
        console.log(`Inserted batch ${i / BATCH_SIZE + 1} (${Math.min(i + BATCH_SIZE, TOTAL_RECORDS)} / ${TOTAL_RECORDS})`);
    }

    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
