const TASK_VERBS = new Set([
    'buy', 'call', 'pick', 'get', 'send', 'pay', 'book', 'order', 'collect', 'take',
    'do', 'make', 'fix', 'clean', 'wash', 'remind', 'check', 'email', 'text', 'message',
    'tell', 'ask', 'find', 'organise', 'organize', 'schedule', 'cancel', 'move', 'return',
    'visit', 'renew', 'apply', 'submit', 'finish', 'start', 'stop', 'drop', 'bring', 'leave',
    'write', 'run', 'walk', 'drive', 'meet', 'grab', 'sort', 'pack', 'unpack', 'feed', 'water',
    'repair', 'replace', 'install', 'hire', 'confirm', 'follow', 'update', 'upload', 'download',
    'print', 'sign', 'post', 'deliver', 'charge', 'transfer', 'deposit', 'register', 'enrol',
    'enroll', 'go', 'plan', 'prepare', 'cook', 'bake', 'shop',
]);

function startsWithTaskVerb(phrase: string): boolean {
    const first = phrase.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    return TASK_VERBS.has(first);
}

function capitalizePhrase(phrase: string): string {
    const trimmed = phrase.trim();
    if (!trimmed) return trimmed;
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function splitOnAndBeforeVerbs(text: string): string[] {
    const parts: string[] = [];
    let remaining = text.trim();

    while (remaining) {
        let splitAt = -1;
        const pattern = /\s+and\s+/gi;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(remaining)) !== null) {
            const after = remaining.slice(match.index + match[0].length);
            if (startsWithTaskVerb(after)) {
                splitAt = match.index;
                break;
            }
        }

        if (splitAt === -1) {
            parts.push(remaining.trim());
            break;
        }

        parts.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).replace(/^\s+and\s+/i, '');
    }

    return parts.filter(Boolean);
}

/**
 * Heuristic split for typed captures when the LLM returns one blob.
 * Splits on commas and on "and" only when the next clause starts with a task verb
 * (so "Mike and Sue" stays intact).
 */
export function splitMultiActionCapture(text: string, maxItems = 4): string[] | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const commaParts = trimmed.split(/\s*,\s*/).flatMap((part) => splitOnAndBeforeVerbs(part));
    const clauses = commaParts
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

    if (clauses.length < 2) return null;
    if (!clauses.every(startsWithTaskVerb)) return null;

    return clauses.slice(0, maxItems).map(capitalizePhrase);
}
