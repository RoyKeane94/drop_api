import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

router.get('/me', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { id: true, householdId: true, name: true, onboardingDone: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
});

router.patch('/me', async (req: any, res) => {
    const { onboardingDone } = req.body as { onboardingDone?: boolean };
    const user = await prisma.user.update({
        where: { id: req.userId },
        data: { onboardingDone },
        select: { id: true, householdId: true, onboardingDone: true },
    });
    res.json(user);
});

export default router;
