interface RevenueCatEntitlement {
    expires_date?: string | null;
    product_identifier?: string | null;
}

interface RevenueCatSubscriberResponse {
    subscriber?: {
        entitlements?: Record<string, RevenueCatEntitlement>;
    };
}

export interface RevenueCatDemoStatus {
    configured: boolean;
    appUserId: string;
    entitlementId: string;
    active: boolean;
    expiresAt: string | null;
    productIdentifier: string | null;
}

const REVENUECAT_BASE_URL = process.env.REVENUECAT_BASE_URL ?? 'https://api.revenuecat.com/v1';
const DEFAULT_ENTITLEMENT_ID = process.env.REVENUECAT_ENTITLEMENT_ID ?? 'pro';

export async function fetchRevenueCatDemoStatus(appUserId: string): Promise<RevenueCatDemoStatus> {
    const secretKey = process.env.REVENUECAT_SECRET_API_KEY;
    if (!secretKey) {
        return {
            configured: false,
            appUserId,
            entitlementId: DEFAULT_ENTITLEMENT_ID,
            active: false,
            expiresAt: null,
            productIdentifier: null,
        };
    }

    const url = `${REVENUECAT_BASE_URL}/subscribers/${encodeURIComponent(appUserId)}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`RevenueCat lookup failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as RevenueCatSubscriberResponse;
    const entitlement = payload.subscriber?.entitlements?.[DEFAULT_ENTITLEMENT_ID];
    const expiresAt = entitlement?.expires_date ?? null;
    const active = isEntitlementActive(entitlement, expiresAt);

    return {
        configured: true,
        appUserId,
        entitlementId: DEFAULT_ENTITLEMENT_ID,
        active,
        expiresAt,
        productIdentifier: entitlement?.product_identifier ?? null,
    };
}

function isEntitlementActive(
    entitlement: RevenueCatEntitlement | undefined,
    expiresAt: string | null,
): boolean {
    if (!entitlement) return false;
    if (expiresAt == null) return true;
    const expiresMs = Date.parse(expiresAt);
    if (Number.isNaN(expiresMs)) return false;
    return expiresMs > Date.now();
}
