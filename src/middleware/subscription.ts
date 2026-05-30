import { prisma } from '../lib/prisma';

export async function requireSubscription(req: any, res: any, next: any) {
    const user = await prisma.user.findUnique({
        where: { id: req.userId },
        include: { household: { select: { subscriptionActive: true } } },
    });

    if (!user?.household?.subscriptionActive) {
        return res.status(402).json({ error: 'Subscription required' });
    }

    next();
}
