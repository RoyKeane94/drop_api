import { prisma } from './prisma';

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
        await prisma.listItem.deleteMany({ where: { householdId } });
        await prisma.householdTag.deleteMany({ where: { householdId } });
        await prisma.user.deleteMany({ where: { householdId } });
        await prisma.household.delete({ where: { id: householdId } });
        return;
    }

    await prisma.user.delete({ where: { id: userId } });
}
