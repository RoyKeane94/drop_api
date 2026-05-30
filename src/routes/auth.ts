import { Router } from 'express';
import { verifyAppleToken } from '../lib/appleAuth';
import { prisma } from '../lib/prisma';
import { signSessionToken } from '../lib/session';
import { seedHouseholdStarterTags } from '../lib/tags';
import { formatCode, generateInviteCode } from '../lib/inviteCode';

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
        // Partner can join later using this household code.
        if (!user.householdId) {
            const household = await createHouseholdWithCode();
            await seedHouseholdStarterTags(household.id);
            user = await prisma.user.update({
                where: { id: user.id },
                data: { householdId: household.id },
            });
        }

        const token = signSessionToken(user.id);
        const userWithHousehold = await prisma.user.findUnique({
            where: { id: user.id },
            include: { household: true },
        });
        return res.status(200).json({
            token,
            sessionToken: token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                householdId: user.householdId,
                inviteCode: userWithHousehold?.household
                    ? formatCode(userWithHousehold.household.inviteCode)
                    : null,
                onboardingDone: user.onboardingDone,
            },
        });
    } catch (error) {
        console.error('Apple auth failed:', error);
        return res.status(401).json({ error: 'Invalid Apple identity token' });
    }
});

async function createHouseholdWithCode() {
    while (true) {
        const inviteCode = generateInviteCode();
        try {
            return await prisma.household.create({
                data: { inviteCode },
            });
        } catch (error: unknown) {
            const isUniqueViolation = (
                typeof error == 'object'
                && error !== null
                && 'code' in error
                && (error as { code?: unknown }).code == 'P2002'
            );
            if (!isUniqueViolation) throw error;
        }
    }
}

export default authRouter;
