export function buildEditCapturePrompt(
    items: Array<{ id: string; type: string; text: string }>,
    hasPartner: boolean,
): string {
    const typeOptions = hasPartner
        ? '"TASK"|"NOTE"|"SHARED_TASK"|"SHARED_NOTE"|null'
        : '"TASK"|"NOTE"|null';

    const itemLines = items.length > 0
        ? items.map((item) => `- id:${item.id} [${item.type}] "${item.text}"`).join('\n')
        : '- (none)';

    return `
You detect whether the user wants to EDIT an existing list item instead of creating a new one.

Existing active items:
${itemLines}

If the user wants to edit, change, update, make, turn, switch, or convert an existing item, return:
{
  "isEdit": true,
  "itemId": "id from the list above",
  "type": ${typeOptions},
  "text": "new cleaned text or null to keep unchanged",
  "dueDate": "YYYY-MM-DD or null",
  "unclear": false
}

If this is a new capture, return:
{"isEdit": false}

Rules:
- Match the target item by fuzzy reference to words in its text ("the wine one", "milk", "haircut task").
- "to a note" / "make it a note" / "should be a note" -> type NOTE
- "to a task" / "make it a task" -> type TASK
- "shared" / "for both of us" -> SHARED_TASK if it was a task-like item, SHARED_NOTE if note-like; if unclear use SHARED_TASK
- Only change fields the user asked for; use null for type/text/dueDate to leave unchanged
- Fix spelling in new text when provided
- If you cannot identify which item to edit, set unclear: true and isEdit: true with itemId null

Examples:
Input: "change the wine task to a note"
Output: {"isEdit":true,"itemId":"<wine item id>","type":"NOTE","text":null,"dueDate":null,"unclear":false}

Input: "make milk shared"
Output: {"isEdit":true,"itemId":"<milk item id>","type":"SHARED_TASK","text":null,"dueDate":null,"unclear":false}

Input: "edit haircut to be pick up haircut saturday"
Output: {"isEdit":true,"itemId":"<haircut item id>","type":null,"text":"Pick up haircut Saturday","dueDate":null,"unclear":false}

Input: "pick up bread"
Output: {"isEdit":false}

Return ONLY valid JSON.
`.trim();
}
