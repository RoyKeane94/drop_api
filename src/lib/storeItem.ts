import { prisma } from './prisma';
import { classify, type ClassifyResult } from './classify';
import { seedHouseholdStarterTags } from './tags';

export async function storeItem(rawText: string, userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            household: {
                include: {
                    users: { where: { id: { not: userId } } },
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
    const hasPartner = (user.household?.users.length ?? 0) > 0;
    const partnerName = hasPartner ? (user.household?.users[0]?.name ?? undefined) : undefined;
    const today = new Date().toISOString().split('T')[0];
    const results = await classify(rawText, today, partnerName, tagNames, hasPartner);
    const clearResults = results
        .filter((result) => !result.unclear && result.text.trim().length > 0)
        .map((result) => (hasPartner ? result : normalizeSoloResult(result)));
    if (clearResults.length == 0) {
        throw new Error("Couldn't quite catch that — try again.");
    }

    const partner = user.household?.users[0];
    const createdItems = await Promise.all(clearResults.map(async (result) => {
        const resolvedTag = resolveTagName(result.tag, tagNames);
        let ownerId = userId;
        let displayType: string = result.type;

        if (
            (result.type === 'FOR_PARTNER' || result.type === 'SHARED_TASK' || result.type === 'SHARED_NOTE')
            && result.routeTo
        ) {
            const match = user.household?.users.find(
                (member) => member.name?.toLowerCase() === result.routeTo!.toLowerCase(),
            );
            if (result.type === 'FOR_PARTNER' && match) {
                ownerId = match.id;
                displayType = `FOR ${result.routeTo.toUpperCase()}`;
            } else if (result.type !== 'FOR_PARTNER') {
                displayType = result.type.replace('_', ' ');
            } else if (!match && partner) {
                ownerId = partner.id;
                displayType = `FOR ${(partner.name ?? 'PARTNER').toUpperCase()}`;
            }
        } else if (result.type === 'SHARED_TASK' || result.type === 'SHARED_NOTE') {
            displayType = result.type.replace('_', ' ');
        }

        const item = await prisma.listItem.create({
            data: {
                householdId: user.householdId!,
                ownerId,
                fromUserId: ownerId !== userId ? userId : undefined,
                type: result.type,
                displayType,
                text: result.text,
                rawTranscript: rawText,
                tags: [resolvedTag],
                dueDate: result.dueDate ? new Date(result.dueDate) : null,
                reminderAt: result.reminderAt ? new Date(result.reminderAt) : null,
            },
            include: { fromUser: { select: { name: true } } },
        });

        return {
            ...item,
            suggestedNewTag: normalizeSuggestedTag(result.suggestedNewTag, tagNames),
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
