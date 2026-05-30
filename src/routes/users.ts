import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { formatCode } from '../lib/inviteCode';
import { deleteAccountAndHousehold } from '../lib/householdCleanup';

const router = Router();

function userPayload(user: {
    id: string;
    householdId: string | null;
    name: string | null;
    email: string | null;
    onboardingDone: boolean;
    household: { inviteCode: string; subscriptionActive: boolean } | null;
}) {
    return {
        id: user.id,
        householdId: user.householdId,
        name: user.name,
        email: user.email,
        onboardingDone: user.onboardingDone,
        inviteCode: user.household ? formatCode(user.household.inviteCode) : null,
        householdSubscriptionActive: user.household?.subscriptionActive ?? false,
    };
}

router.get('/me', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: { select: { inviteCode: true, subscriptionActive: true } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(userPayload(user));
});

router.patch('/me', async (req: any, res) => {
    const { onboardingDone } = req.body as { onboardingDone?: boolean };
    const user = await prisma.user.update({
        where: { id: req.userId },
        data: { onboardingDone },
        include: { household: { select: { inviteCode: true, subscriptionActive: true } } },
    });
    res.json(userPayload(user));
});

router.delete('/me', async (req: any, res) => {
    try {
        await deleteAccountAndHousehold(req.userId);
        res.json({ ok: true });
    } catch (error) {
        console.error('Account deletion failed:', error);
        res.status(500).json({ error: 'Could not delete account' });
    }
});

router.post('/tags', async (req: any, res) => {
    const { name, emoji } = req.body as { name?: string; emoji?: string };
    const trimmedName = name?.trim();
    if (!trimmedName) return res.status(400).json({ error: 'Tag name required' });

    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { householdId: true },
    });
    if (!user?.householdId) return res.status(400).json({ error: 'User has no household' });

    const tag = await prisma.householdTag.upsert({
        where: {
            householdId_name: {
                householdId: user.householdId,
                name: trimmedName,
            },
        },
        update: {
            ...(emoji ? { emoji } : {}),
        },
        create: {
            householdId: user.householdId,
            name: trimmedName,
            emoji: emoji ?? null,
        },
    });
    res.json(tag);
});

export default router;
