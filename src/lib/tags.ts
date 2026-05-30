import { prisma } from './prisma';

export const starterTags: Array<{ name: string; emoji: string }> = [
    { name: 'Shop', emoji: '🛒' },
    { name: 'Kids', emoji: '👧' },
    { name: 'Home', emoji: '🏠' },
    { name: 'Health', emoji: '🏥' },
    { name: 'Finance', emoji: '💳' },
    { name: 'Social', emoji: '🗓️' },
    { name: 'Holiday', emoji: '✈️' },
    { name: 'Work', emoji: '💼' },
    { name: 'Admin', emoji: '📋' },
    { name: 'Car', emoji: '🚗' },
];

export async function seedHouseholdStarterTags(householdId: string) {
    await prisma.householdTag.createMany({
        data: starterTags.map((tag) => ({ householdId, ...tag })),
        skipDuplicates: true,
    });
}

export function emojiForTag(name: string | null | undefined): string | null {
    if (!name?.trim()) return null;
    const match = starterTags.find(
        (tag) => tag.name.toLowerCase() === name.trim().toLowerCase(),
    );
    return match?.emoji ?? null;
}
