import { prisma } from './prisma';

const starterTags: Array<{ name: string; emoji: string }> = [
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
