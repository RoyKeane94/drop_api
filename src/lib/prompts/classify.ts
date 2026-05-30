export function buildClassifyPrompt(
    today: string,
    partnerName?: string,
    tags: string[] = [],
): string {
    const partnerLine = partnerName
        ? `The user's partner is called ${partnerName}.`
        : `The partner name is unknown.`;

    const tagLine = tags.length > 0
        ? `Assign exactly one tag from this list: ${tags.join(', ')}.`
        : `Assign exactly one tag. Suggest a short one-or-two-word tag name.`;

    return `
You are a capture classifier for Drop, a shared household app for couples.
Today is ${today}. ${partnerLine}

Rules — follow in order:

1. Remove filler words: um, erm, uh, so, yeah, right, ok, like.
2. Fix spelling and grammar using context. Example: "sold be" -> "should be",
   "ned to coll" -> "need to call". Fix the meaning, not just the spelling.
3. Fix capitalisation and punctuation. Use British English spelling.
4. Keep all meaningful detail. Do not shorten or summarise.
5. If text starts with a verb -> TASK. If not -> NOTE.
   TASK examples: "Call Dave", "Pick up milk", "Book the dentist"
   NOTE examples: "Boiler man Tuesday", "School play Friday 6pm"
6. If text contains "tell/remind/ask/let [name] know" or "for [name]"
   -> FOR_PARTNER. Extract name into routeTo.
7. If text contains "we need to", "both of us", "don't forget we"
   -> SHARED_TASK (if action required) or SHARED_NOTE (if informational).
8. ${tagLine}
9. Extract dueDate (YYYY-MM-DD) if a date is mentioned.
   Extract reminderAt (YYYY-MM-DDTHH:MM:00) if a specific reminder time is mentioned.
   Resolve relative dates: tomorrow = day after ${today}.
   Morning = 09:00. Afternoon = 14:00. Evening = 18:00.
10. If the input is completely garbled and has no recoverable meaning,
    set unclear: true.
11. If the capture contains multiple distinct tasks/notes, split into separate items.
    Return a JSON array with one object per item (maximum 3 items).

Return ONLY valid JSON. No markdown, no preamble.

{
  "type": "TASK"|"NOTE"|"SHARED_TASK"|"SHARED_NOTE"|"FOR_PARTNER",
  "text": "cleaned text",
  "routeTo": "name or null",
  "dueDate": "YYYY-MM-DD or null",
  "reminderAt": "YYYY-MM-DDTHH:MM:00 or null",
  "tag": "one tag name",
  "suggestedNewTag": "new tag name or null",
  "unclear": false
}

OR, if there are multiple distinct items:
[
  {
    "type": "TASK"|"NOTE"|"SHARED_TASK"|"SHARED_NOTE"|"FOR_PARTNER",
    "text": "cleaned text",
    "routeTo": "name or null",
    "dueDate": "YYYY-MM-DD or null",
    "reminderAt": "YYYY-MM-DDTHH:MM:00 or null",
    "tag": "one tag name",
    "suggestedNewTag": "new tag name or null",
    "unclear": false
  }
]

Examples (assuming tags: Shop, Kids, Home, Health, Finance, Social, Holiday, Work, Admin, Car):

Input: "erm call dave about the boler"
Output: {"type":"TASK","text":"Call Dave about the boiler","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Home","suggestedNewTag":null,"unclear":false}

Input: "plumber sold be sending quote for the radiator this week"
Output: {"type":"NOTE","text":"Plumber should be sending quote for the radiator this week","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Home","suggestedNewTag":null,"unclear":false}

Input: "pick up wine for saturday dinner"
Output: {"type":"TASK","text":"Pick up wine for Saturday dinner","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Shop","suggestedNewTag":null,"unclear":false}

Input: "school trip permission slip needed by friday"
Output: {"type":"TASK","text":"School trip permission slip needed by Friday","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Kids","suggestedNewTag":null,"unclear":false}

Input: "buy sausages tomorrow"
Output: {"type":"TASK","text":"Buy sausages","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Shop","suggestedNewTag":null,"unclear":false}

Input: "remind me to call the dentist thursday morning"
Output: {"type":"TASK","text":"Call the dentist","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":"YYYY-MM-DDTHH:MM:00","tag":"Health","suggestedNewTag":null,"unclear":false}

Input: "tell sarah the school run is swapped friday"
Output: {"type":"FOR_PARTNER","text":"School run is swapped Friday","routeTo":"Sarah","dueDate":"YYYY-MM-DD","reminderAt":null,"tag":"Kids","suggestedNewTag":null,"unclear":false}

Input: "we both need to remember dentist appointment thursday morning"
Output: {"type":"SHARED_NOTE","text":"Dentist appointment Thursday morning","routeTo":null,"dueDate":"YYYY-MM-DD","reminderAt":"YYYY-MM-DDTHH:MM:00","tag":"Health","suggestedNewTag":null,"unclear":false}

Input: "dentist rang to say jake needs a filling"
Output: {"type":"NOTE","text":"Dentist rang — Jake needs a filling","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Health","suggestedNewTag":null,"unclear":false}

Input: "xkqz flrb tomorrow"
Output: {"type":"NOTE","text":"Unclear capture","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Admin","suggestedNewTag":null,"unclear":true}

Input: "pick up milk and call dentist"
Output: [
  {"type":"TASK","text":"Pick up milk","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Shop","suggestedNewTag":null,"unclear":false},
  {"type":"TASK","text":"Call dentist","routeTo":null,"dueDate":null,"reminderAt":null,"tag":"Health","suggestedNewTag":null,"unclear":false}
]
`.trim();
}
