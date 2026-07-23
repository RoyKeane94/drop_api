import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { formatCode, normaliseCode } from '../lib/inviteCode';

const router = Router();

router.get('/invite-preview', async (req, res) => {
    const rawCode = typeof req.query.code === 'string' ? req.query.code : '';
    const normalised = normaliseCode(rawCode);
    if (normalised.length !== 8) {
        return res.status(404).json({ error: 'Code not found' });
    }

    const household = await prisma.household.findUnique({
        where: { inviteCode: normalised },
        include: { users: { select: { id: true, name: true } } },
    });

    if (!household) {
        return res.status(404).json({ error: 'Code not found' });
    }

    const inviter = household.users[0] ?? null;
    const inviterFirstName = inviter?.name?.split(/\s+/)[0] ?? null;

    res.json({
        code: formatCode(household.inviteCode),
        inviterFirstName,
        hasHouseholdAccess: household.subscriptionActive,
    });
});

export default router;
