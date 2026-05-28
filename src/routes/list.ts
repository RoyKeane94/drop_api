import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /list
router.get('/', async (req: any, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user?.householdId) return res.json({ items: [] });

    const items = await prisma.listItem.findMany({
        where: { householdId: user.householdId },
        orderBy: { createdAt: 'desc' },
        include: { fromUser: { select: { name: true } } },
    });

    res.json({ items, userId: req.userId });
});

// PATCH /list/:id/done
router.patch('/:id/done', async (req, res) => {
    const existing = await prisma.listItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const newDone = !existing.done;
    const item = await prisma.listItem.update({
        where: { id: req.params.id },
        data: { done: newDone, doneAt: newDone ? new Date() : null },
    });

    res.json(item);
});

export default router;
