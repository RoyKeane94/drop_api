import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { deleteAccountAndHousehold } from '../lib/householdCleanup';
import { isValidTimeZone } from '../lib/parseReminderInstant';
import { buildUserPayload, householdUserInclude } from '../lib/userPayload';

const router = Router();

router.get('/me', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: householdUserInclude },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(buildUserPayload(user, req.userId));
});

router.put('/me/push-token', async (req: any, res) => {
    const { token } = req.body as { token?: string };
    const trimmed = token?.trim();
    if (!trimmed) return res.status(400).json({ error: 'Push token required' });

    const user = await prisma.user.update({
        where: { id: req.userId },
        data: { pushToken: trimmed },
        include: { household: householdUserInclude },
    });
    res.json(buildUserPayload(user, req.userId));
});

router.delete('/me/push-token', async (req: any, res) => {
    const user = await prisma.user.update({
        where: { id: req.userId },
        data: { pushToken: null },
        include: { household: householdUserInclude },
    });
    res.json(buildUserPayload(user, req.userId));
});

router.patch('/me', async (req: any, res) => {
    const { onboardingDone, name, timezone } = req.body as {
        onboardingDone?: boolean;
        name?: string;
        timezone?: string;
    };
    const data: { onboardingDone?: boolean; name?: string; timezone?: string } = {};

    if (typeof onboardingDone === 'boolean') {
        data.onboardingDone = onboardingDone;
    }

    if (name !== undefined) {
        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed) return res.status(400).json({ error: 'Name required' });
        if (trimmed.length > 40) return res.status(400).json({ error: 'Name is too long' });
        data.name = trimmed;
    }

    if (timezone !== undefined) {
        const trimmed = typeof timezone === 'string' ? timezone.trim() : '';
        if (!trimmed) return res.status(400).json({ error: 'Timezone required' });
        if (trimmed.length > 64) return res.status(400).json({ error: 'Timezone is too long' });
        if (!isValidTimeZone(trimmed)) return res.status(400).json({ error: 'Invalid timezone' });
        data.timezone = trimmed;
    }

    if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No updates provided' });
    }

    const user = await prisma.user.update({
        where: { id: req.userId },
        data,
        include: { household: householdUserInclude },
    });
    res.json(buildUserPayload(user, req.userId));
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
