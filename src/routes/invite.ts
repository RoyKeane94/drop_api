import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { seedHouseholdStarterTags } from '../lib/tags';

const router = Router();

// POST /invite/create
router.post('/create', async (req: any, res) => {
    let user = await prisma.user.findUnique({ where: { id: req.userId } });

    // Create household if user doesn't have one.
    if (!user?.householdId) {
        const household = await prisma.household.create({ data: {} });
        await seedHouseholdStarterTags(household.id);
        user = await prisma.user.update({
            where: { id: req.userId },
            data: { householdId: household.id },
        });
    }

    const invite = await prisma.householdInvite.create({
        data: { householdId: user!.householdId!, createdById: req.userId },
    });

    res.json({
        token: invite.token,
        url: `${process.env.FRONTEND_URL}/invite/${invite.token}`,
    });
});

// GET /invite/:token/validate
router.get('/:token/validate', async (req, res) => {
    const invite = await prisma.householdInvite.findUnique({
        where: { token: req.params.token },
    });

    if (!invite || invite.usedAt) {
        return res.json({ valid: false });
    }
    res.json({ valid: true, householdId: invite.householdId });
});

// POST /invite/:token/join
router.post('/:token/join', async (req: any, res) => {
    const invite = await prisma.householdInvite.findUnique({
        where: { token: req.params.token },
    });

    if (!invite || invite.usedAt) {
        return res.status(400).json({ error: 'Invalid or expired invite' });
    }

    await prisma.$transaction([
        prisma.user.update({
            where: { id: req.userId },
            data: { householdId: invite.householdId },
        }),
        prisma.householdInvite.update({
            where: { token: req.params.token },
            data: { usedAt: new Date() },
        }),
    ]);

    res.json({ success: true, householdId: invite.householdId });
});

export default router;
