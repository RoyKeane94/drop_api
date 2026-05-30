import { prisma } from './prisma';
import { classify, type ClassifyResult } from './classify';
import { normalizeCaptureDates, parseAllDayDate } from './normalizeCaptureDates';
import { seedHouseholdStarterTags } from './tags';
import { resolveItemPresentation } from './resolveItemPresentation';
import { tryEditCapture } from './tryEditCapture';

export async function storeItem(rawText: string, userId: string) {
    const edited = await tryEditCapture(rawText, userId);
    if (edited) return edited;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            household: {
                include: {
                    users: true,
                    tags: true,
                },
            },
        },
    });

    if (!user?.householdId) throw new Error('User has no household');

    let householdTags = user.household?.tags ?? [];
    if (householdTags.length === 0) {
        await seedHouseholdStarterTags(user.householdId);
        householdTags = await prisma.householdTag.findMany({
            where: { householdId: user.householdId },
            orderBy: { name: 'asc' },
        });
    }
    const tagNames = householdTags.map((tag) => tag.name);
    const allUsers = user.household?.users ?? [];
    const otherUsers = allUsers.filter((member) => member.id !== userId);
    const assigneeNames = otherUsers
        .map((member) => member.name?.trim())
        .filter((name): name is string => !!name);
    const hasPartner = otherUsers.length > 0;
    const partnerName = assigneeNames[0];
    const today = new Date().toISOString().split('T')[0];
    const results = await classify(rawText, today, assigneeNames, partnerName, tagNames, hasPartner);
    const clearResults = results
        .filter((result) => !result.unclear && result.text.trim().length > 0)
        .map((result) => {
            const normalized = normalizeCaptureDates(
                rawText,
                hasPartner ? result : normalizeSoloResult(result),
            );
            return normalized;
        });
    if (clearResults.length == 0) {
        throw new Error("Couldn't quite catch that — try again.");
    }

    const partner = otherUsers[0];
    const createdItems = await Promise.all(clearResults.map(async ({ result, needsDeadlineConfirmation, dueDateAllDay }) => {
        const resolvedTag = resolveTagName(result.tag, tagNames);
        const presentation = resolveItemPresentation({
            type: result.type,
            userId,
            partner,
            routeTo: result.routeTo,
            householdMembers: allUsers,
        });

        const item = await prisma.listItem.create({
            data: {
                householdId: user.householdId!,
                ownerId: presentation.ownerId,
                fromUserId: presentation.fromUserId,
                type: presentation.type,
                displayType: presentation.displayType,
                text: result.text,
                rawTranscript: rawText,
                tags: [resolvedTag],
                dueDate: result.dueDate
                    ? (dueDateAllDay ? parseAllDayDate(result.dueDate) : new Date(result.dueDate))
                    : null,
                dueDateAllDay,
                reminderAt: result.reminderAt ? new Date(result.reminderAt) : null,
            },
            include: { fromUser: { select: { name: true } } },
        });

        return {
            ...item,
            suggestedNewTag: normalizeSuggestedTag(result.suggestedNewTag, tagNames),
            needsDeadlineConfirmation: needsDeadlineConfirmation,
            dueDateAllDay,
        };
    }));

    return {
        ...createdItems[0],
        createdCount: createdItems.length,
        additionalItems: createdItems.slice(1),
    };
}

function normalizeSoloResult(result: ClassifyResult): ClassifyResult {
    switch (result.type) {
        case 'SHARED_TASK':
        case 'FOR_PARTNER':
            return { ...result, type: 'TASK', routeTo: null };
        case 'SHARED_NOTE':
            return { ...result, type: 'NOTE', routeTo: null };
        default:
            return result;
    }
}

function resolveTagName(tag: string | null, existingTagNames: string[]): string {
    const trimmed = tag?.trim();
    if (trimmed) {
        const match = existingTagNames.find(
            (name) => name.toLowerCase() == trimmed.toLowerCase(),
        );
        if (match) return match;
    }
    const admin = existingTagNames.find((name) => name.toLowerCase() == 'admin');
    if (admin) return admin;
    if (existingTagNames[0]) return existingTagNames[0];
    return 'Admin';
}

function normalizeSuggestedTag(suggested: string | null, existingTagNames: string[]): string | null {
    const trimmed = suggested?.trim();
    if (!trimmed) return null;
    const exists = existingTagNames.some((name) => name.toLowerCase() == trimmed.toLowerCase());
    return exists ? null : trimmed;
}
