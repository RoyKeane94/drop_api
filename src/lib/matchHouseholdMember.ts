export interface HouseholdMemberRef {
    id: string;
    name: string | null;
}

function normalizeName(value: string): string {
    return value.trim().toLowerCase();
}

function firstName(value: string): string {
    return normalizeName(value).split(/\s+/)[0] ?? '';
}

function levenshtein(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

    for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
    for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

    for (let i = 1; i < rows; i += 1) {
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            );
        }
    }

    return matrix[a.length][b.length];
}

function namesMatch(routeTo: string, memberName: string): boolean {
    const route = normalizeName(routeTo);
    const member = normalizeName(memberName);
    if (!route || !member) return false;
    if (route === member) return true;

    const routeFirst = firstName(routeTo);
    const memberFirst = firstName(memberName);
    if (routeFirst && memberFirst && routeFirst === memberFirst) return true;

    if (routeFirst.length >= 3 && memberFirst.length >= 3) {
        if (memberFirst.startsWith(routeFirst) || routeFirst.startsWith(memberFirst)) return true;
    }

    if (routeFirst.length >= 4 && memberFirst.length >= 4) {
        const distance = levenshtein(routeFirst, memberFirst);
        const limit = Math.max(2, Math.floor(Math.min(routeFirst.length, memberFirst.length) / 4));
        if (distance <= limit) return true;
    }

    return false;
}

/** Match routeTo to a household member; supports Amelia→Emilia-style variants. */
export function findHouseholdMemberByName(
    routeTo: string | null | undefined,
    members: HouseholdMemberRef[],
): HouseholdMemberRef | null {
    const trimmed = routeTo?.trim();
    if (!trimmed) return null;

    return members.find((member) => member.name && namesMatch(trimmed, member.name)) ?? null;
}
