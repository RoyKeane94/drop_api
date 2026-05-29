import { Router } from 'express';
import { verifyAppleToken } from '../lib/appleAuth';
import { prisma } from '../lib/prisma';
import { signSessionToken } from '../lib/session';
import { seedHouseholdStarterTags } from '../lib/tags';

const authRouter = Router();

authRouter.post('/apple', async (req, res) => {
    try {
        const { identityToken, name } = req.body ?? {};

        if (!identityToken || typeof identityToken !== 'string') {
            return res.status(400).json({ error: 'identityToken is required' });
        }

        const { sub, email } = await verifyAppleToken(identityToken);

        let user = await prisma.user.upsert({
            where: { id: sub },
            update: {
                ...(email ? { email } : {}),
                ...(typeof name === 'string' && name.trim().length > 0 ? { name: name.trim() } : {}),
            },
            create: {
                id: sub,
                email,
                ...(typeof name === 'string' && name.trim().length > 0 ? { name: name.trim() } : {}),
            },
        });

        // Every account owns a household from first sign-in.
        // Invites then allow exactly one partner to join that household.
        if (!user.householdId) {
            const household = await prisma.household.create({ data: {} });
            await seedHouseholdStarterTags(household.id);
            user = await prisma.user.update({
                where: { id: user.id },
                data: { householdId: household.id },
            });
        }

        const token = signSessionToken(user.id);
        return res.status(200).json({ token, user });
    } catch (error) {
        console.error('Apple auth failed:', error);
        return res.status(401).json({ error: 'Invalid Apple identity token' });
    }
});

export default authRouter;
