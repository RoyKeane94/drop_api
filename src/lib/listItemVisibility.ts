/** Items visible to a household member: own tasks/notes, shared items, and FOR_PARTNER sent or received. */
export function listItemsVisibleToUser(userId: string, householdId: string) {
    return {
        householdId,
        OR: [
            { ownerId: userId, type: { in: ['TASK', 'NOTE'] } },
            { type: { in: ['SHARED_TASK', 'SHARED_NOTE'] } },
            { type: 'FOR_PARTNER', fromUserId: userId },
            { type: 'FOR_PARTNER', ownerId: userId },
        ],
    };
}
