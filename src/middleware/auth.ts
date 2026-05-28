import { verifySessionToken } from '../lib/session';

export function authMiddleware(req: any, res: any, next: any) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const { userId } = verifySessionToken(token);
        req.userId = userId;
        next();
    } catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}
