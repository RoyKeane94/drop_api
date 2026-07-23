import { formatCode } from './inviteCode';

export function buildUserPayload(
    user: {
        id: string;
        householdId: string | null;
        name: string | null;
        email: string | null;
        onboardingDone: boolean;
        timezone?: string | null;
        household: {
            inviteCode: string;
            subscriptionActive: boolean;
            users?: Array<{ id: string; name: string | null }>;
        } | null;
    },
    userId: string,
) {
    const partner = user.household?.users?.find((member) => member.id !== userId) ?? null;
    const hasHouseholdAccess = user.household?.subscriptionActive ?? false;

    return {
        id: user.id,
        householdId: user.householdId,
        name: user.name,
        email: user.email,
        onboardingDone: user.onboardingDone,
        timezone: user.timezone,
        inviteCode: user.household ? formatCode(user.household.inviteCode) : null,
        hasHouseholdAccess,
        householdSubscriptionActive: hasHouseholdAccess,
        partnerName: partner?.name ?? null,
    };
}

export const householdUserInclude = {
    select: {
        inviteCode: true,
        subscriptionActive: true,
        users: { select: { id: true, name: true } },
    },
} as const;
