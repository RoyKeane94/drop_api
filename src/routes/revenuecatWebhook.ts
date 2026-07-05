import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

type RevenueCatEvent = {
    type?: string;
    app_user_id?: string;
    id?: string;
};

const activatesAccessEvents = new Set([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'UNCANCELLATION',
    'PRODUCT_CHANGE',
]);

const deactivatesAccessEvents = new Set([
    'EXPIRATION',
]);
const pendingRevenueCatCodePrefix = 'revenuecat-pending-subscription:';

router.post('/revenuecat', async (req, res) => {
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH;
    if (!expectedAuth) {
        console.error('RevenueCat webhook misconfigured: REVENUECAT_WEBHOOK_AUTH is missing');
        return res.status(500).json({ error: 'Webhook not configured' });
    }

    const authHeader = req.header('Authorization');
    if (authHeader !== expectedAuth) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const event = ((req.body ?? {}) as { event?: RevenueCatEvent }).event ?? {};
        const type = event.type ?? 'UNKNOWN';
        const appUserId = event.app_user_id;

        if (!appUserId) {
            console.warn(`RevenueCat webhook ${type}: missing app_user_id`);
            return res.status(200).json({ ok: true });
        }

        const user = await prisma.user.findUnique({
            where: { id: appUserId },
            select: { id: true, householdId: true },
        });

        if (!user) {
            console.warn(`RevenueCat webhook ${type}: user not found for app_user_id=${appUserId}`);
            return res.status(200).json({ ok: true });
        }

        if (activatesAccessEvents.has(type) || deactivatesAccessEvents.has(type)) {
            const shouldActivate = activatesAccessEvents.has(type);
            if (user.householdId) {
                await prisma.household.update({
                    where: { id: user.householdId },
                    data: { subscriptionActive: shouldActivate },
                });
                await clearPendingRevenueCatState(user.id);
            } else {
                await prisma.clientErrorLog.upsert({
                    where: { code: pendingRevenueCatCodePrefix + user.id },
                    create: {
                        code: pendingRevenueCatCodePrefix + user.id,
                        area: 'revenuecat.webhook',
                        message: 'Pending subscription state for user without household',
                        userId: user.id,
                        metadata: { subscriptionActive: shouldActivate },
                    },
                    update: {
                        message: 'Pending subscription state for user without household',
                        metadata: { subscriptionActive: shouldActivate },
                    },
                });
                console.warn(
                    `RevenueCat webhook ${type}: user ${user.id} has no household; stored pending subscription state=${shouldActivate}`,
                );
            }
            return res.status(200).json({ ok: true });
        }

        if (type === 'CANCELLATION') {
            console.log(`RevenueCat webhook CANCELLATION for user=${user.id} (no access change until expiration)`);
            return res.status(200).json({ ok: true });
        }

        if (type === 'BILLING_ISSUE') {
            console.warn(`RevenueCat webhook BILLING_ISSUE for user=${user.id} (no immediate access change)`);
            return res.status(200).json({ ok: true });
        }

        if (type === 'TRANSFER') {
            console.warn(`RevenueCat webhook TRANSFER for user=${user.id} (ignored)`);
            return res.status(200).json({ ok: true });
        }

        console.log(`RevenueCat webhook ${type} for user=${user.id} (ignored)`);
        return res.status(200).json({ ok: true });
    } catch (error) {
        console.error('RevenueCat webhook processing failed:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

async function clearPendingRevenueCatState(userId: string) {
    await prisma.clientErrorLog.delete({
        where: { code: pendingRevenueCatCodePrefix + userId },
    }).catch(() => {});
}

