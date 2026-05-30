import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { formatCode, normaliseCode } from '../lib/inviteCode';

const router = Router();

router.get('/code', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: true },
    });
    if (!user?.household) return res.status(404).json({ error: 'No household' });
    res.json({ code: formatCode(user.household.inviteCode) });
});

router.post('/join', async (req: any, res) => {
    const { code } = req.body as { code?: string };
    if (!code) return res.status(400).json({ error: 'code required' });

    const normalised = normaliseCode(code);
    if (normalised.length !== 8) {
        return res.status(400).json({ error: 'Code not found. Check and try again.' });
    }

    const household = await prisma.household.findUnique({
        where: { inviteCode: normalised },
        include: { users: true },
    });

    if (!household) {
        return res.status(404).json({ error: 'Code not found. Check and try again.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }
    if (user.householdId == household.id) {
        return res.status(400).json({ error: 'Already in this household.' });
    }

    const previousHouseholdId = user.householdId;

    await prisma.user.update({
        where: { id: req.userId },
        data: { householdId: household.id },
    });

    if (previousHouseholdId && previousHouseholdId !== household.id) {
        const previousHousehold = await prisma.household.findUnique({
            where: { id: previousHouseholdId },
            select: { id: true, users: { select: { id: true } } },
        });
        if (previousHousehold && previousHousehold.users.length <= 1) {
            await prisma.listItem.deleteMany({ where: { householdId: previousHouseholdId } });
            await prisma.householdTag.deleteMany({ where: { householdId: previousHouseholdId } });
            await prisma.household.delete({ where: { id: previousHousehold.id } }).catch(() => {});
        }
    }

    const updatedUser = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: { select: { inviteCode: true } } },
    });

    if (!updatedUser) {
        return res.status(404).json({ error: 'User not found.' });
    }

    res.json({
        user: {
            id: updatedUser.id,
            householdId: updatedUser.householdId,
            name: updatedUser.name,
            email: updatedUser.email,
            onboardingDone: updatedUser.onboardingDone,
            inviteCode: updatedUser.household
                ? formatCode(updatedUser.household.inviteCode)
                : null,
        },
    });
});

export default router;
