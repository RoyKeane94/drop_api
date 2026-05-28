import jwt from 'jsonwebtoken';

const SECRET = process.env.SESSION_SECRET!;

export function signSessionToken(userId: string): string {
    return jwt.sign({ userId }, SECRET, { expiresIn: '30d' });
}

export function verifySessionToken(token: string): { userId: string } {
    return jwt.verify(token, SECRET) as { userId: string };
}
