import Anthropic from '@anthropic-ai/sdk';
import { prisma } from './prisma';
import { buildEditCapturePrompt } from './prompts/editCapture';
import { isEditableItemType, normalizeTypeForHousehold, type ItemType } from './resolveItemPresentation';
import { updateListItem } from './updateListItem';
import { listItemsVisibleToUser } from './listItemVisibility';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EDIT_HINT = /\b(change|edit|update|make|turn|switch|convert|move|should be)\b/i;

interface EditCaptureResult {
    isEdit: boolean;
    itemId?: string | null;
    type?: string | null;
    text?: string | null;
    dueDate?: string | null;
    unclear?: boolean;
}

export async function tryEditCapture(rawText: string, userId: string) {
    if (!EDIT_HINT.test(rawText)) return null;

    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            household: {
                include: {
                    users: { where: { id: { not: userId } } },
                    tags: true,
                },
            },
        },
    });

    if (!user?.householdId) return null;

    const hasPartner = (user.household?.users.length ?? 0) > 0;
    const items = await prisma.listItem.findMany({
        where: {
            ...listItemsVisibleToUser(userId, user.householdId),
            done: false,
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, type: true, text: true, ownerId: true },
    });

    const editableItems = items.filter((item) => {
        if (!isEditableItemType(item.type)) return false;
        if (item.type === 'TASK' || item.type === 'NOTE') {
            return item.ownerId === userId;
        }
        return true;
    });

    if (editableItems.length === 0) return null;

    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: buildEditCapturePrompt(editableItems, hasPartner),
        messages: [{ role: 'user', content: rawText }],
    });

    const rawBlock = msg.content.find((block) => block.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') return null;

    let parsed: EditCaptureResult;
    try {
        parsed = JSON.parse(rawBlock.text.replace(/```json|```/g, '').trim()) as EditCaptureResult;
    } catch {
        return null;
    }

    if (!parsed.isEdit) return null;
    if (parsed.unclear || !parsed.itemId) {
        throw new Error("Couldn't tell which item to edit — try being more specific.");
    }

    const target = editableItems.find((item) => item.id === parsed.itemId);
    if (!target) {
        throw new Error("Couldn't find that item to edit.");
    }

    const nextType = parsed.type
        ? normalizeTypeForHousehold(parsed.type as ItemType, hasPartner)
        : undefined;

    return updateListItem({
        itemId: target.id,
        userId,
        householdId: user.householdId,
        partner: user.household?.users[0] ?? null,
        hasPartner,
        tagNames: user.household?.tags.map((tag) => tag.name) ?? [],
        timeZone: user.timezone,
        updates: {
            text: parsed.text?.trim() || undefined,
            type: nextType,
            dueDate: parsed.dueDate === undefined ? undefined : parsed.dueDate,
        },
    });
}
