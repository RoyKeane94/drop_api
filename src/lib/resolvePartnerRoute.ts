import type { ClassifyResult } from './classify';
import { findHouseholdMemberByName, type HouseholdMemberRef } from './matchHouseholdMember';

const ROUTING_PATTERNS = [
    /\btell\s+([a-zA-Z'-]+(?:\s+[a-zA-Z'-]+)?)\s+(?:to\s+)?/i,
    /\bask\s+([a-zA-Z'-]+(?:\s+[a-zA-Z'-]+)?)\s+(?:to\s+)?/i,
    /\bremind\s+([a-zA-Z'-]+(?:\s+[a-zA-Z'-]+)?)\s+(?:to\s+)?/i,
    /\bmessage\s+([a-zA-Z'-]+(?:\s+[a-zA-Z'-]+)?)\s+(?:to\s+)?/i,
    /\bfor\s+([a-zA-Z'-]+)\s+(?:to\s+)?(?:pick|get|buy|call|do|send|grab|collect|take|bring)/i,
];

export function firstNameFromName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;
    return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function assigneeNamesFromMembers(members: HouseholdMemberRef[]): string[] {
    return members
        .map((member) => member.name?.trim())
        .filter((name): name is string => !!name)
        .map(firstNameFromName);
}

function extractMentionedName(rawText: string): string | null {
    for (const pattern of ROUTING_PATTERNS) {
        const match = rawText.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return null;
}

function canonicalRouteToName(member: HouseholdMemberRef): string {
    return firstNameFromName(member.name ?? '');
}

/** Align classifier output with household members named in the capture. */
export function applyHouseholdRouting(
    results: ClassifyResult[],
    rawText: string,
    otherUsers: HouseholdMemberRef[],
    hasPartner: boolean,
): ClassifyResult[] {
    if (!hasPartner || otherUsers.length === 0) return results;

    const mentionedName = extractMentionedName(rawText);

    return results.map((result) => {
        const llmMatch = findHouseholdMemberByName(result.routeTo, otherUsers);
        const mentionMatch = mentionedName
            ? findHouseholdMemberByName(mentionedName, otherUsers)
            : null;
        const match = llmMatch ?? mentionMatch;

        if (match?.name) {
            return {
                ...result,
                type: 'FOR_PARTNER',
                routeTo: canonicalRouteToName(match),
            };
        }

        if (result.type === 'FOR_PARTNER') {
            const routeTo = result.routeTo?.trim();
            const prefixed = routeTo && !result.text.toLowerCase().startsWith(routeTo.toLowerCase())
                ? `${routeTo}: ${result.text}`
                : result.text;
            return {
                ...result,
                type: 'TASK',
                text: prefixed,
                routeTo: null,
            };
        }

        return result;
    });
}
