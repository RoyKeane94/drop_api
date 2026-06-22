import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { seedHouseholdStarterTags } from '../lib/tags';
import { isEditableItemType } from '../lib/resolveItemPresentation';
import { updateListItem } from '../lib/updateListItem';
import { deleteListItem } from '../lib/deleteListItem';
import { listItemsVisibleToUser } from '../lib/listItemVisibility';

const router = Router();

// GET /list
router.get('/', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: { include: { users: true, tags: true } } },
    });
    if (!user?.householdId) return res.json({ items: [], partnerName: null, householdTags: [] });

    const partner = user.household?.users.find((member) => member.id !== req.userId);
    if ((user.household?.tags.length ?? 0) == 0) {
        await seedHouseholdStarterTags(user.householdId);
    }
    const householdTags = await prisma.householdTag.findMany({
        where: { householdId: user.householdId },
        orderBy: { name: 'asc' },
    });

    const items = await prisma.listItem.findMany({
        where: listItemsVisibleToUser(req.userId, user.householdId),
        orderBy: { createdAt: 'desc' },
        include: { fromUser: { select: { name: true } } },
    });

    res.json({
        items,
        userId: req.userId,
        partnerName: partner ? (partner.name ?? 'your partner') : null,
        householdTags,
    });
});

// PATCH /list/:id/done
router.patch('/:id/done', async (req: any, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.householdId) return res.status(403).json({ error: 'No household' });

    const existing = await prisma.listItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.householdId !== user.householdId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { done: requestedDone } = req.body as { done?: boolean };
    const newDone = typeof requestedDone === 'boolean' ? requestedDone : !existing.done;
    const item = await prisma.listItem.update({
        where: { id: req.params.id },
        data: { done: newDone, doneAt: newDone ? new Date() : null },
        include: { fromUser: { select: { name: true } } },
    });

    res.json(item);
});

// PATCH /list/:id/urgent
router.patch('/:id/urgent', async (req: any, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.householdId) return res.status(403).json({ error: 'No household' });

    const existing = await prisma.listItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.householdId !== user.householdId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { urgent } = req.body as { urgent?: boolean };
    if (typeof urgent !== 'boolean') {
        return res.status(400).json({ error: 'urgent boolean required' });
    }

    const item = await prisma.listItem.update({
        where: { id: req.params.id },
        data: { urgent },
        include: { fromUser: { select: { name: true } } },
    });

    res.json(item);
});

// PATCH /list/:id
router.patch('/:id', async (req: any, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: {
            household: {
                include: {
                    users: { where: { id: { not: req.userId } } },
                    tags: true,
                },
            },
        },
    });
    if (!user?.householdId) return res.status(403).json({ error: 'No household' });

    const existing = await prisma.listItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.householdId !== user.householdId) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { text, type, reminderAt, dueDate, dueDateAllDay, tag } = req.body as {
        text?: string;
        type?: string;
        reminderAt?: string | null;
        dueDate?: string | null;
        dueDateAllDay?: boolean;
        tag?: string | null;
    };
    const nextText = text?.trim();
    const hasPartner = (user.household?.users.length ?? 0) > 0;

    if (
        !nextText
        && !type
        && tag === undefined
        && reminderAt === undefined
        && dueDate === undefined
        && dueDateAllDay === undefined
    ) {
        return res.status(400).json({ error: 'Text, type, tag, dueDate, or reminderAt required' });
    }

    if (type && !isEditableItemType(type) && type !== 'FOR_PARTNER') {
        return res.status(400).json({ error: 'Invalid item type' });
    }

    try {
        const item = await updateListItem({
            itemId: req.params.id,
            userId: req.userId,
            householdId: user.householdId,
            partner: user.household?.users[0] ?? null,
            hasPartner,
            tagNames: user.household?.tags.map((tag) => tag.name) ?? [],
            timeZone: user.timezone,
            updates: {
                text: nextText || undefined,
                type: type as any,
                tag: tag === undefined ? undefined : tag,
                reminderAt: reminderAt === undefined ? undefined : reminderAt,
                dueDate: dueDate === undefined ? undefined : dueDate,
                dueDateAllDay: dueDateAllDay === undefined ? undefined : dueDateAllDay,
            },
        });
        res.json(item);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Update failed';
        if (message === 'Item not found') return res.status(404).json({ error: message });
        if (message === 'Forbidden') return res.status(403).json({ error: message });
        return res.status(400).json({ error: message });
    }
});

// DELETE /list/:id
router.delete('/:id', async (req: any, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.householdId) return res.status(403).json({ error: 'No household' });

    try {
        await deleteListItem({
            itemId: req.params.id,
            userId: req.userId,
            householdId: user.householdId,
        });
        res.json({ deleted: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Delete failed';
        if (message === 'Item not found') return res.status(404).json({ error: message });
        if (message === 'Forbidden') return res.status(403).json({ error: message });
        return res.status(400).json({ error: message });
    }
});

// POST /list/clear-completed
router.post('/clear-completed', async (req: any, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.householdId) return res.status(403).json({ error: 'No household' });

    const deleted = await prisma.listItem.deleteMany({
        where: {
            householdId: user.householdId,
            done: true,
        },
    });

    res.json({ deleted: deleted.count });
});

export default router;
