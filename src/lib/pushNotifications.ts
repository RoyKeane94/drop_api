import apn from '@parse/node-apn';
import { prisma } from './prisma';
import {
    buildPartnerNotifications,
    type CreatedItemForNotify,
} from './partnerNotifications';

let provider: apn.Provider | null | undefined;

function getProvider(): apn.Provider | null {
    if (provider !== undefined) return provider;

    const keyId = process.env.APNS_KEY_ID;
    const teamId = process.env.APNS_TEAM_ID;
    const key = process.env.APNS_KEY;
    const keyPath = process.env.APNS_KEY_PATH;
    const bundleId = process.env.APNS_BUNDLE_ID;

    if (!keyId || !teamId || !bundleId || (!key && !keyPath)) {
        provider = null;
        return provider;
    }

    try {
        provider = new apn.Provider({
            token: {
                key: key ?? keyPath!,
                keyId,
                teamId,
            },
            production: process.env.APNS_PRODUCTION === 'true',
        });
    } catch (error) {
        console.warn('APNs provider init failed:', error);
        provider = null;
    }

    return provider;
}

async function sendPush(token: string, title: string, body: string): Promise<void> {
    const apns = getProvider();
    const bundleId = process.env.APNS_BUNDLE_ID;
    if (!apns || !bundleId) return;

    const notification = new apn.Notification();
    notification.topic = bundleId;
    notification.alert = { title, body };
    notification.sound = 'default';
    notification.pushType = 'alert';

    const result = await apns.send(notification, token);
    if (result.failed.length > 0) {
        const reason = result.failed[0]?.response?.reason;
        console.warn('APNs delivery failed:', reason ?? result.failed[0]?.status);
        if (reason === 'BadDeviceToken' || reason === 'Unregistered') {
            await prisma.user.updateMany({
                where: { pushToken: token },
                data: { pushToken: null },
            });
        }
    }
}

export async function notifyPartnersAboutItem(params: {
    creatorUserId: string;
    creatorName: string | null;
    householdUserIds: string[];
    item: CreatedItemForNotify;
}): Promise<void> {
    const notifications = buildPartnerNotifications(params);
    if (notifications.length === 0) return;

    const recipientIds = notifications.map((entry) => entry.userId);
    const recipients = await prisma.user.findMany({
        where: {
            id: { in: recipientIds },
            pushToken: { not: null },
        },
        select: { id: true, pushToken: true },
    });

    const copyByUserId = new Map(notifications.map((entry) => [entry.userId, entry]));

    await Promise.all(
        recipients.map(async (recipient) => {
            const copy = copyByUserId.get(recipient.id);
            if (!copy?.title || !recipient.pushToken) return;
            try {
                await sendPush(recipient.pushToken, copy.title, copy.body);
            } catch (error) {
                console.warn('Failed to send partner push:', error);
            }
        }),
    );
}

export async function notifyPartnersAboutItems(params: {
    creatorUserId: string;
    creatorName: string | null;
    householdUserIds: string[];
    items: CreatedItemForNotify[];
}): Promise<void> {
    await Promise.all(
        params.items.map((item) => notifyPartnersAboutItem({
            creatorUserId: params.creatorUserId,
            creatorName: params.creatorName,
            householdUserIds: params.householdUserIds,
            item,
        })),
    );
}
