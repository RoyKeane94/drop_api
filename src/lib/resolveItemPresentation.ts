import type { ClassifyResult } from './classify';

export type ItemType = ClassifyResult['type'];

export function resolveItemPresentation(params: {
    type: ItemType;
    userId: string;
    partner?: { id: string; name: string | null } | null;
    routeTo?: string | null;
    householdMembers?: Array<{ id: string; name: string | null }>;
}) {
    let ownerId = params.userId;
    let fromUserId: string | undefined;
    let displayType = params.type.replace('_', ' ');

    if (params.type === 'FOR_PARTNER') {
        const match = params.routeTo && params.householdMembers
            ? params.householdMembers.find(
                (member) => member.name?.toLowerCase() === params.routeTo!.toLowerCase(),
            )
            : null;

        if (match) {
            ownerId = match.id;
            displayType = `FOR ${params.routeTo!.toUpperCase()}`;
            fromUserId = params.userId;
        } else if (params.partner) {
            ownerId = params.partner.id;
            displayType = `FOR ${(params.routeTo ?? params.partner.name ?? 'PARTNER').toUpperCase()}`;
            fromUserId = params.userId;
        }
    } else if (params.type === 'SHARED_TASK' || params.type === 'SHARED_NOTE') {
        displayType = params.type.replace('_', ' ');
    }

    return { displayType, ownerId, fromUserId };
}

export function normalizeTypeForHousehold(
    type: ItemType,
    hasPartner: boolean,
): ItemType {
    if (hasPartner) return type;
    switch (type) {
        case 'SHARED_TASK':
        case 'FOR_PARTNER':
            return 'TASK';
        case 'SHARED_NOTE':
            return 'NOTE';
        default:
            return type;
    }
}

export function isEditableItemType(type: string): boolean {
    return type === 'TASK'
        || type === 'NOTE'
        || type === 'SHARED_TASK'
        || type === 'SHARED_NOTE';
}
