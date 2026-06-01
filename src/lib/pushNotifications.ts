import apn from '@parse/node-apn';
import { prisma } from './prisma';
import {
    buildPartnerNotifications,
    type CreatedItemForNotify,
} from './partnerNotifications';

let productionProvider: apn.Provider | null | undefined;
let sandboxProvider: apn.Provider | null | undefined;

function resolveApnsKey(): string | null {
    const inline = process.env.APNS_KEY?.trim();
    if (inline) return normalizeApnsKey(inline);

    const keyPath = process.env.APNS_KEY_PATH?.trim();
    if (keyPath) return keyPath;

    return null;
}

function normalizeApnsKey(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.includes('\\n')) {
        return trimmed.replace(/\\n/g, '\n');
    }
    return trimmed;
}

function providerForEnvironment(production: boolean): apn.Provider | null {
    const keyId = process.env.APNS_KEY_ID?.trim();
    const teamId = process.env.APNS_TEAM_ID?.trim();
    const bundleId = process.env.APNS_BUNDLE_ID?.trim();
    const key = resolveApnsKey();

    if (!keyId || !teamId || !bundleId || !key) {
        return null;
    }

    try {
        return new apn.Provider({
            token: { key, keyId, teamId },
            production,
        });
    } catch (error) {
        console.warn(`APNs ${production ? 'production' : 'sandbox'} provider init failed:`, error);
        return null;
    }
}

function getProductionProvider(): apn.Provider | null {
    if (productionProvider !== undefined) return productionProvider;
    productionProvider = providerForEnvironment(true);
    return productionProvider;
}

function getSandboxProvider(): apn.Provider | null {
    if (sandboxProvider !== undefined) return sandboxProvider;
    sandboxProvider = providerForEnvironment(false);
    return sandboxProvider;
}

function getPrimaryProvider(): apn.Provider | null {
    return process.env.APNS_PRODUCTION === 'true'
        ? getProductionProvider()
        : getSandboxProvider();
}

export function isPushConfigured(): boolean {
    return getPrimaryProvider() !== null;
}

export function logPushConfiguration(): void {
    const keyId = !!process.env.APNS_KEY_ID?.trim();
    const teamId = !!process.env.APNS_TEAM_ID?.trim();
    const bundleId = process.env.APNS_BUNDLE_ID?.trim();
    const hasKey = !!resolveApnsKey();
    const production = process.env.APNS_PRODUCTION === 'true';

    if (!keyId || !teamId || !bundleId || !hasKey) {
        console.warn(
            'Partner push notifications disabled — set APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, and APNS_KEY (or APNS_KEY_PATH).',
        );
        return;
    }

    console.log(
        `Partner push notifications enabled (${production ? 'production' : 'sandbox'}, topic=${bundleId}).`,
    );
}

async function sendWithProvider(
    provider: apn.Provider,
    token: string,
    title: string,
    body: string,
): Promise<{ ok: boolean; reason?: string }> {
    const bundleId = process.env.APNS_BUNDLE_ID?.trim();
    if (!bundleId) return { ok: false, reason: 'Missing APNS_BUNDLE_ID' };

    const notification = new apn.Notification();
    notification.topic = bundleId;
    notification.alert = { title, body };
    notification.sound = 'default';
    notification.pushType = 'alert';

    const result = await provider.send(notification, token);
    if (result.failed.length === 0) {
        return { ok: true };
    }

    const reason = result.failed[0]?.response?.reason
        ?? String(result.failed[0]?.status ?? 'unknown');
    return { ok: false, reason };
}

async function sendPush(token: string, title: string, body: string): Promise<boolean> {
    const primary = getPrimaryProvider();
    if (!primary) {
        console.warn('Partner push skipped — APNs provider not configured.');
        return false;
    }

    let outcome = await sendWithProvider(primary, token, title, body);

    if (
        !outcome.ok
        && outcome.reason === 'BadDeviceToken'
        && process.env.APNS_PRODUCTION === 'true'
    ) {
        const sandbox = getSandboxProvider();
        if (sandbox) {
            console.warn('APNs production rejected token — retrying sandbox (Xcode/debug build).');
            outcome = await sendWithProvider(sandbox, token, title, body);
        }
    }

    if (outcome.ok) {
        console.log('Partner push delivered.');
        return true;
    }

    console.warn('APNs delivery failed:', outcome.reason);
    if (outcome.reason === 'Unregistered') {
        await prisma.user.updateMany({
            where: { pushToken: token },
            data: { pushToken: null },
        });
    } else if (outcome.reason === 'BadDeviceToken') {
        console.warn(
            'Device token rejected — check APNS_PRODUCTION matches your build (TestFlight/App Store=true, Xcode debug=false).',
        );
    }

    return false;
}

export async function notifyPartnersAboutItem(params: {
    creatorUserId: string;
    creatorName: string | null;
    householdUserIds: string[];
    item: CreatedItemForNotify;
}): Promise<void> {
    const notifications = buildPartnerNotifications(params);
    if (notifications.length === 0) return;

    if (!isPushConfigured()) {
        console.warn(
            `Partner push skipped for ${params.item.type} — APNs not configured on server.`,
        );
        return;
    }

    const recipientIds = notifications.map((entry) => entry.userId);
    const recipients = await prisma.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, name: true, pushToken: true },
    });

    const missingToken = recipients.filter((recipient) => !recipient.pushToken);
    if (missingToken.length > 0) {
        console.warn(
            'Partner push skipped — no device token for:',
            missingToken.map((user) => user.name ?? user.id).join(', '),
        );
    }

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
