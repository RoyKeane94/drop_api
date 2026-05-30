import { Router } from 'express';
import { verifyAppleToken } from '../lib/appleAuth';
import { prisma } from '../lib/prisma';
import { signSessionToken } from '../lib/session';
import { seedHouseholdStarterTags } from '../lib/tags';
import { formatCode, generateInviteCode } from '../lib/inviteCode';
import { respondWithLoggedError } from '../lib/errorLog';

const authRouter = Router();

authRouter.post('/apple', async (req, res) => {
    try {
        const { identityToken, name } = req.body ?? {};

        if (!identityToken || typeof identityToken !== 'string') {
            return respondWithLoggedError(res, {
                area: 'auth.apple',
                message: 'identityToken is required',
                status: 400,
                userMessage: 'Something went wrong — please try again.',
            });
        }

        let sub: string;
        let email: string | null;
        try {
            ({ sub, email } = await verifyAppleToken(identityToken));
        } catch (error) {
            console.error('Apple token verification failed:', error);
            return respondWithLoggedError(res, {
                area: 'auth.apple',
                message: error instanceof Error ? error.message : 'Apple token verification failed',
                status: 401,
                userMessage: 'Something went wrong — please try again.',
                metadata: {
                    reason: 'apple_token_verification_failed',
                },
            });
        }

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
            include: { household: { select: { inviteCode: true, subscriptionActive: true } } },
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
                householdSubscriptionActive: userWithHousehold?.household?.subscriptionActive ?? false,
                onboardingDone: user.onboardingDone,
            },
        });
    } catch (error) {
        console.error('Apple auth failed:', error);
        return respondWithLoggedError(res, {
            area: 'auth.apple',
            message: error instanceof Error ? error.message : 'Apple auth failed',
            status: 500,
            userMessage: 'Something went wrong — please try again.',
            metadata: {
                reason: 'unexpected_auth_failure',
            },
        });
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
