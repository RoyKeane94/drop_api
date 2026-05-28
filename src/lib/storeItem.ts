import { prisma } from './prisma';
import { classify } from './classify';

export async function storeItem(rawText: string, userId: string) {
    const result = await classify(rawText);

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            household: {
                include: { users: { where: { id: { not: userId } } } },
            },
        },
    });

    if (!user?.householdId) throw new Error('User has no household');

    let ownerId = userId;
    let displayType: string;

    switch (result.type) {
    case 'TASK':
        displayType = 'TASK';
        break;
    case 'NOTE':
        displayType = 'NOTE';
        break;
    case 'SHARED_TASK':
    case 'SHARED_NOTE': {
        displayType = result.type === 'SHARED_TASK' ? 'SHARED TASK' : 'SHARED NOTE';
        if (result.routeTo) {
            const match = user.household?.users.find(
                (member) => member.name?.toLowerCase() === result.routeTo!.toLowerCase(),
            );
            if (match) ownerId = match.id;
        }
        break;
    }
    }

    const item = await prisma.listItem.create({
        data: {
            householdId: user.householdId,
            ownerId,
            fromUserId: ownerId !== userId ? userId : null,
            type: result.type,
            displayType,
            text: result.text,
            rawTranscript: rawText,
            dueDate: result.dueDate ? new Date(result.dueDate) : null,
            reminderAt: result.reminderAt ? new Date(result.reminderAt) : null,
        },
        include: {
            fromUser: { select: { name: true } },
        },
    });

    return item;
}
