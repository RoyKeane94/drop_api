import { prisma } from './prisma';
import { parseAllDayDate } from './normalizeCaptureDates';
import { parseIncomingDateTime } from './parseReminderInstant';
import {
    isEditableItemType,
    normalizeTypeForHousehold,
    resolveItemPresentation,
    type ItemType,
} from './resolveItemPresentation';

export async function updateListItem(params: {
    itemId: string;
    userId: string;
    householdId: string;
    partner?: { id: string; name: string | null } | null;
    hasPartner: boolean;
    timeZone?: string | null;
    tagNames: string[];
    updates: {
        text?: string;
        type?: ItemType;
        dueDate?: string | null;
        dueDateAllDay?: boolean;
        reminderAt?: string | null;
        tag?: string | null;
    };
}) {
    const existing = await prisma.listItem.findUnique({ where: { id: params.itemId } });
    if (!existing || existing.householdId !== params.householdId) {
        throw new Error('Item not found');
    }

    if (!isEditableItemType(existing.type)) {
        throw new Error('This item cannot be edited');
    }

    const canEdit = existing.type === 'SHARED_TASK' || existing.type === 'SHARED_NOTE'
        ? true
        : existing.ownerId === params.userId;

    if (!canEdit) {
        throw new Error('Forbidden');
    }

    const nextType = params.updates.type
        ? normalizeTypeForHousehold(params.updates.type, params.hasPartner)
        : (existing.type as ItemType);

    if (!isEditableItemType(nextType)) {
        throw new Error('Invalid item type');
    }

    if ((nextType === 'SHARED_TASK' || nextType === 'SHARED_NOTE') && !params.hasPartner) {
        throw new Error('Shared items require a partner in your household');
    }

    const nextText = params.updates.text?.trim() || existing.text;
    const presentation = resolveItemPresentation({
        type: nextType,
        userId: params.userId,
        partner: params.partner,
    });

    const data: {
        type: string;
        displayType: string;
        text: string;
        ownerId: string;
        fromUserId: string | null;
        dueDate?: Date | null;
        dueDateAllDay?: boolean;
        reminderAt?: Date | null;
        tags?: string[];
    } = {
        type: nextType,
        displayType: presentation.displayType,
        text: nextText,
        ownerId: nextType === 'SHARED_TASK' || nextType === 'SHARED_NOTE'
            ? params.userId
            : presentation.ownerId,
        fromUserId: nextType === 'SHARED_TASK' || nextType === 'SHARED_NOTE'
            ? null
            : (presentation.fromUserId ?? null),
    };

    if (params.updates.dueDate !== undefined) {
        if (params.updates.dueDate) {
            const allDay = params.updates.dueDateAllDay ?? false;
            data.dueDate = allDay
                ? parseAllDayDate(params.updates.dueDate.slice(0, 10), params.timeZone ?? undefined)
                : parseIncomingDateTime(params.updates.dueDate, params.timeZone ?? undefined);
        } else {
            data.dueDate = null;
            data.dueDateAllDay = false;
        }
    }

    if (params.updates.dueDateAllDay !== undefined) {
        data.dueDateAllDay = params.updates.dueDateAllDay;
    }

    if (params.updates.reminderAt !== undefined) {
        data.reminderAt = params.updates.reminderAt
            ? parseIncomingDateTime(params.updates.reminderAt, params.timeZone ?? undefined)
            : null;
    }

    if (params.updates.tag !== undefined) {
        const trimmed = params.updates.tag?.trim();
        data.tags = trimmed ? [trimmed] : existing.tags;
    }

    const item = await prisma.listItem.update({
        where: { id: params.itemId },
        data,
        include: { fromUser: { select: { name: true } } },
    });

    return { ...item, wasEdit: true };
}
