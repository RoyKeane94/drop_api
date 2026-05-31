import { firstNameFromName } from './resolvePartnerRoute';

export interface CreatedItemForNotify {
    type: string;
    text: string;
    displayType: string;
    ownerId: string;
    fromUserId: string | null;
}

function shouldNotifyPartner(type: string): boolean {
    return type === 'FOR_PARTNER' || type === 'SHARED_TASK' || type === 'SHARED_NOTE';
}

function recipientUserIds(
    creatorUserId: string,
    item: CreatedItemForNotify,
    householdUserIds: string[],
): string[] {
    if (!shouldNotifyPartner(item.type)) return [];

    if (item.type === 'FOR_PARTNER') {
        return item.ownerId !== creatorUserId && householdUserIds.includes(item.ownerId)
            ? [item.ownerId]
            : [];
    }

    return householdUserIds.filter((id) => id !== creatorUserId);
}

function notificationCopy(
    creatorName: string | null,
    item: CreatedItemForNotify,
): { title: string; body: string } {
    const sender = creatorName ? firstNameFromName(creatorName) : 'Your partner';

    if (item.type === 'FOR_PARTNER') {
        return {
            title: `${sender} dropped something for you`,
            body: item.text,
        };
    }

    const kind = item.type === 'SHARED_NOTE' ? 'shared note' : 'shared task';
    return {
        title: `${sender} added a ${kind}`,
        body: item.text,
    };
}

export function buildPartnerNotifications(params: {
    creatorUserId: string;
    creatorName: string | null;
    householdUserIds: string[];
    item: CreatedItemForNotify;
}): Array<{ userId: string; title: string; body: string }> {
    const recipientIds = recipientUserIds(
        params.creatorUserId,
        params.item,
        params.householdUserIds,
    );

    if (recipientIds.length === 0) return [];

    const copy = notificationCopy(params.creatorName, params.item);
    return recipientIds.map((userId) => ({
        userId,
        title: copy.title,
        body: copy.body,
    }));
}
