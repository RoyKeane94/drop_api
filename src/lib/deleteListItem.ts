import { prisma } from './prisma';

function canDeleteListItem(
    existing: { type: string; ownerId: string; fromUserId: string | null },
    userId: string,
): boolean {
    if (existing.type === 'FOR_PARTNER') {
        return existing.ownerId === userId || existing.fromUserId === userId;
    }
    if (existing.type === 'SHARED_TASK' || existing.type === 'SHARED_NOTE') {
        return true;
    }
    if (existing.type === 'TASK' || existing.type === 'NOTE') {
        return existing.ownerId === userId;
    }
    return false;
}

export async function deleteListItem(params: {
    itemId: string;
    userId: string;
    householdId: string;
}): Promise<void> {
    const existing = await prisma.listItem.findUnique({ where: { id: params.itemId } });
    if (!existing || existing.householdId !== params.householdId) {
        throw new Error('Item not found');
    }

    if (!canDeleteListItem(existing, params.userId)) {
        throw new Error('Forbidden');
    }

    await prisma.listItem.delete({ where: { id: params.itemId } });
}
