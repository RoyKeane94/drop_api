export function buildClassifyPrompt(
    today: string,
    assigneeNames: string[] = [],
    partnerName?: string,
    tags: string[] = [],
    hasPartner = true,
): string {
    const assigneeList = assigneeNames.length > 0
        ? assigneeNames.join(', ')
        : (partnerName ?? 'your partner');
    const partner = hasPartner
        ? `Household assignees (app users only): ${assigneeList}.`
        : `Solo household — no partner.`;

    const tagRule = tags.length > 0
        ? `One tag from: ${tags.join(', ')}.`
        : `Suggest a short one-or-two-word tag.`;

    const types = hasPartner
        ? `"TASK"|"NOTE"|"SHARED_TASK"|"SHARED_NOTE"|"FOR_PARTNER"`
        : `"TASK"|"NOTE"`;

    const partnerRules = hasPartner ? `
6. FOR_PARTNER only when routeTo matches a household assignee (${assigneeList}). Allow minor spelling variants (e.g. Amelia for Emilia).
7. Anyone else (children, friends — e.g. Jack) → TASK or NOTE; put their name in the task text, routeTo null. Never FOR_PARTNER for non-assignees.
8. "we need to"/"both of us"/"don't forget we" → SHARED_TASK (action) or SHARED_NOTE (info).`
        : `6. Never use FOR_PARTNER, SHARED_TASK, or SHARED_NOTE.`;

    const partnerExample = assigneeNames[0]
        ? `\n"tell ${assigneeNames[0]} school run swapped friday" → {"type":"FOR_PARTNER","text":"School run swapped Friday","routeTo":"${assigneeNames[0]}","dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Kids","suggestedNewTag":null,"unclear":false}`
        : partnerName
            ? `\n"tell ${partnerName} school run swapped friday" → {"type":"FOR_PARTNER","text":"School run swapped Friday","routeTo":"${partnerName}","dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Kids","suggestedNewTag":null,"unclear":false}`
            : '';
    const childExample = `
"for Jack pick up from school" → {"type":"TASK","text":"Jack: pick up from school","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Kids","suggestedNewTag":null,"unclear":false}`;

    return `
Classify household captures for Drop. Today: ${today}. ${partner}

1. Remove fillers (um, erm, uh, so, yeah, right, ok). Fix spelling and grammar using context ("sold be"→"should be"). British English. Keep all detail.
2. Starts with verb → TASK. Otherwise → NOTE.
3. ${tagRule}
4. dueDate (YYYY-MM-DD): any date or deadline mentioned. reminderAt (YYYY-MM-DDTHH:MM:00): ONLY when user says "remind me", "don't forget", or "set an alert". No reminder language → reminderAt null. No time given → 09:00. Morning=09:00 Afternoon=14:00 Evening=18:00. Resolve relative dates from ${today}.
5. Two or more distinct items → JSON array, max 3.
6. Unreadable → unclear: true.
${partnerRules}

Return ONLY valid JSON, no markdown:
{"type":${types},"text":"...","routeTo":"name or null","dueDate":"YYYY-MM-DD or null","reminderAt":"YYYY-MM-DDTHH:MM:00 or null","tag":"...","suggestedNewTag":"... or null","unclear":false}

Examples:
"erm call dave about the boler" → {"type":"TASK","text":"Call Dave about the boiler","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Home","suggestedNewTag":null,"unclear":false}
"plumber sold be sending quote for radiator" → {"type":"NOTE","text":"Plumber should be sending quote for the radiator","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Home","suggestedNewTag":null,"unclear":false}
"buy sausages tomorrow" → {"type":"TASK","text":"Buy sausages","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Shop","suggestedNewTag":null,"unclear":false}
"remind me to call dentist thursday morning" → {"type":"TASK","text":"Call the dentist","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":"YYYY-MM-DDT09:00:00","tag":"Health","suggestedNewTag":null,"unclear":false}
"pick up milk and call dentist" → [{"type":"TASK","text":"Pick up milk","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Shop","suggestedNewTag":null,"unclear":false},{"type":"TASK","text":"Call dentist","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Health","suggestedNewTag":null,"unclear":false}]${partnerExample}${childExample}
`.trim();
}
