import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { formatCode, normaliseCode } from '../lib/inviteCode';
import { purgeHouseholdData } from '../lib/householdCleanup';

const router = Router();

function userPayload(
    user: {
        id: string;
        householdId: string | null;
        name: string | null;
        email: string | null;
        onboardingDone: boolean;
        household: {
            inviteCode: string;
            subscriptionActive: boolean;
            users?: Array<{ id: string; name: string | null }>;
        } | null;
    },
    userId: string,
) {
    const partner = user.household?.users?.find((member) => member.id !== userId) ?? null;

    return {
        id: user.id,
        householdId: user.householdId,
        name: user.name,
        email: user.email,
        onboardingDone: user.onboardingDone,
        inviteCode: user.household ? formatCode(user.household.inviteCode) : null,
        householdSubscriptionActive: user.household?.subscriptionActive ?? false,
        partnerName: partner?.name ?? null,
    };
}

const householdUserInclude = {
    select: {
        inviteCode: true,
        subscriptionActive: true,
        users: { select: { id: true, name: true } },
    },
} as const;

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
        include: { household: householdUserInclude },
    });

    if (!updatedUser) {
        return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: userPayload(updatedUser, req.userId) });
});

router.post('/subscription/activate', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { householdId: true },
    });
    if (!user?.householdId) {
        return res.status(400).json({ error: 'No household' });
    }

    await prisma.household.update({
        where: { id: user.householdId },
        data: { subscriptionActive: true },
    });

    res.json({ ok: true });
});

router.post('/subscription/deactivate', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { householdId: true },
    });
    if (!user?.householdId) {
        return res.status(400).json({ error: 'No household' });
    }

    await purgeHouseholdData(user.householdId);
    res.json({ ok: true });
});

export default router;
