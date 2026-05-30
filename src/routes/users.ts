import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { formatCode } from '../lib/inviteCode';

const router = Router();

router.get('/me', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: { select: { inviteCode: true } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        id: user.id,
        householdId: user.householdId,
        name: user.name,
        email: user.email,
        onboardingDone: user.onboardingDone,
        inviteCode: user.household ? formatCode(user.household.inviteCode) : null,
    });
});

router.patch('/me', async (req: any, res) => {
    const { onboardingDone } = req.body as { onboardingDone?: boolean };
    const user = await prisma.user.update({
        where: { id: req.userId },
        data: { onboardingDone },
        include: { household: { select: { inviteCode: true } } },
    });
    res.json({
        id: user.id,
        householdId: user.householdId,
        name: user.name,
        email: user.email,
        onboardingDone: user.onboardingDone,
        inviteCode: user.household ? formatCode(user.household.inviteCode) : null,
    });
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
