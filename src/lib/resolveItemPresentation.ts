import type { ClassifyResult } from './classify';
import { findHouseholdMemberByName, type HouseholdMemberRef } from './matchHouseholdMember';

export type ItemType = ClassifyResult['type'];

export interface ResolvedPresentation {
    displayType: string;
    ownerId: string;
    fromUserId: string | null;
    type: ItemType;
}

export function resolveItemPresentation(params: {
    type: ItemType;
    userId: string;
    partner?: { id: string; name: string | null } | null;
    routeTo?: string | null;
    householdMembers?: HouseholdMemberRef[];
}): ResolvedPresentation {
    let ownerId = params.userId;
    let fromUserId: string | null = null;
    let displayType = params.type.replace('_', ' ');
    let type = params.type;

    if (params.type === 'FOR_PARTNER') {
        const recipients = (params.householdMembers ?? []).filter((member) => member.id !== params.userId);
        const routeTo = params.routeTo?.trim();
        const match = findHouseholdMemberByName(routeTo, recipients);

        if (match) {
            ownerId = match.id;
            fromUserId = params.userId;
            displayType = `FOR ${(match.name ?? routeTo ?? 'PARTNER').toUpperCase()}`;
        } else if (!routeTo && recipients.length === 1 && params.partner) {
            ownerId = params.partner.id;
            fromUserId = params.userId;
            displayType = `FOR ${(params.partner.name ?? 'PARTNER').toUpperCase()}`;
        } else {
            type = 'TASK';
            displayType = 'TASK';
            ownerId = params.userId;
            fromUserId = null;
        }
    } else if (params.type === 'SHARED_TASK' || params.type === 'SHARED_NOTE') {
        displayType = params.type.replace('_', ' ');
    }

    return { displayType, ownerId, fromUserId, type };
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
