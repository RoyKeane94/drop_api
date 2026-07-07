import { prisma } from './prisma';
import { deleteRevenueCatSubscriber } from './revenueCat';

async function deleteRevenueCatSubscribersForUsers(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    for (const userId of uniqueUserIds) {
        try {
            await deleteRevenueCatSubscriber(userId);
        } catch (error) {
            console.warn(`RevenueCat subscriber delete failed for ${userId}:`, error);
        }
    }
}

export async function purgeHouseholdData(householdId: string) {
    await prisma.listItem.deleteMany({ where: { householdId } });
    await prisma.householdTag.deleteMany({ where: { householdId } });
    await prisma.household.update({
        where: { id: householdId },
        data: { subscriptionActive: false },
    });
}

export async function deleteAccountAndHousehold(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;

    if (user.householdId) {
        const householdId = user.householdId;
        const members = await prisma.user.findMany({
            where: { householdId },
            select: { id: true },
        });
        await deleteRevenueCatSubscribersForUsers(members.map((member) => member.id));
        await prisma.listItem.deleteMany({ where: { householdId } });
        await prisma.householdTag.deleteMany({ where: { householdId } });
        await prisma.user.deleteMany({ where: { householdId } });
        await prisma.household.delete({ where: { id: householdId } });
        return;
    }

    await deleteRevenueCatSubscribersForUsers([userId]);
    await prisma.user.delete({ where: { id: userId } });
}
