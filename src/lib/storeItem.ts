import { prisma } from './prisma';
import { classify, fallbackClassifyResult, type ClassifyResult } from './classify';
import { normalizeCaptureDates, parseAllDayDate } from './normalizeCaptureDates';
import { seedHouseholdStarterTags } from './tags';
import { resolveItemPresentation } from './resolveItemPresentation';
import { applyHouseholdRouting, assigneeNamesFromMembers } from './resolvePartnerRoute';
import { notifyPartnersAboutItems } from './pushNotifications';
import { parseReminderInstant, localDateStringInTimeZone } from './parseReminderInstant';
import { tryEditCapture } from './tryEditCapture';
import { splitMultiActionCapture } from './splitMultiActionCapture';

export async function storeItem(
    rawText: string,
    userId: string,
    options?: { isTypedCapture?: boolean },
) {
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
    const assigneeNames = assigneeNamesFromMembers(otherUsers);
    const hasPartner = otherUsers.length > 0;
    const partnerName = assigneeNames[0];
    const userTimeZone = user.timezone ?? undefined;
    const today = localDateStringInTimeZone(userTimeZone);
    let classified: ClassifyResult[];
    try {
        classified = await classify(
            rawText,
            today,
            assigneeNames,
            partnerName,
            tagNames,
            hasPartner,
            Boolean(options?.isTypedCapture),
        );
    } catch (error) {
        if (!options?.isTypedCapture) throw error;
        classified = [fallbackClassifyResult(rawText)];
    }

    if (options?.isTypedCapture && classified.length === 1) {
        const splitTexts = splitMultiActionCapture(rawText);
        if (splitTexts && splitTexts.length > 1) {
            const template = classified[0];
            classified = splitTexts.map((text) => ({
                ...template,
                text,
                unclear: false,
            }));
        }
    }

    const results = applyHouseholdRouting(classified, rawText, otherUsers, hasPartner);
    let clearResults = results
        .filter((result) => {
            if (!result.text.trim()) return false;
            if (options?.isTypedCapture) return true;
            return !result.unclear;
        })
        .map((result) => {
            const normalized = normalizeCaptureDates(
                rawText,
                hasPartner ? result : normalizeSoloResult(result),
            );
            return normalized;
        });
    if (clearResults.length == 0) {
        if (!options?.isTypedCapture) {
            throw new Error("Couldn't quite catch that — try again.");
        }
        const fallback = fallbackClassifyResult(rawText);
        clearResults = [
            normalizeCaptureDates(
                rawText,
                hasPartner ? fallback : normalizeSoloResult(fallback),
            ),
        ];
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
                    ? (dueDateAllDay
                        ? parseAllDayDate(result.dueDate, userTimeZone)
                        : result.reminderAt
                            ? parseReminderInstant(result.reminderAt, userTimeZone)
                            : parseReminderInstant(`${result.dueDate}T09:00:00`, userTimeZone))
                    : null,
                dueDateAllDay,
                reminderAt: result.reminderAt
                    ? parseReminderInstant(result.reminderAt, userTimeZone)
                    : null,
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

    void notifyPartnersAboutItems({
        creatorUserId: userId,
        creatorName: user.name,
        householdUserIds: allUsers.map((member) => member.id),
        items: createdItems.map((item) => ({
            type: item.type,
            text: item.text,
            displayType: item.displayType,
            ownerId: item.ownerId,
            fromUserId: item.fromUserId,
        })),
    }).catch((error) => {
        console.warn('Partner notification failed:', error);
    });

    return {
        ...createdItems[0],
        createdCount: createdItems.length,
        additionalItems: createdItems.slice(1),
    };
}

export async function storeImportedItem(
    text: string,
    type: 'TASK' | 'NOTE',
    userId: string,
) {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Text required');

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
    const partner = otherUsers[0];

    const presentation = resolveItemPresentation({
        type,
        userId,
        partner,
        householdMembers: allUsers,
    });

    const item = await prisma.listItem.create({
        data: {
            householdId: user.householdId,
            ownerId: presentation.ownerId,
            fromUserId: presentation.fromUserId,
            type: presentation.type,
            displayType: presentation.displayType,
            text: trimmed,
            rawTranscript: trimmed,
            tags: [resolveTagName(null, tagNames)],
        },
        include: { fromUser: { select: { name: true } } },
    });

    void notifyPartnersAboutItems({
        creatorUserId: userId,
        creatorName: user.name,
        householdUserIds: allUsers.map((member) => member.id),
        items: [{
            type: item.type,
            text: item.text,
            displayType: item.displayType,
            ownerId: item.ownerId,
            fromUserId: item.fromUserId,
        }],
    }).catch((error) => {
        console.warn('Partner notification failed:', error);
    });

    return {
        ...item,
        suggestedNewTag: null,
        needsDeadlineConfirmation: false,
        dueDateAllDay: false,
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
