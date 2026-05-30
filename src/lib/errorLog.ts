import { prisma } from './prisma';
import { generateInviteCode } from './inviteCode';
import type { Prisma } from '@prisma/client';

export function generateErrorReferenceCode(): string {
    return `DR-${generateInviteCode().slice(0, 6)}`;
}

export async function logClientError(params: {
    area: string;
    message: string;
    status?: number;
    userId?: string;
    metadata?: Prisma.InputJsonValue;
}): Promise<string> {
    const code = generateErrorReferenceCode();

    await prisma.clientErrorLog.create({
        data: {
            code,
            area: params.area,
            message: params.message,
            status: params.status ?? null,
            userId: params.userId ?? null,
            metadata: params.metadata ?? undefined,
        },
    });

    return code;
}

export async function respondWithLoggedError(
    res: import('express').Response,
    params: {
        area: string;
        message: string;
        status: number;
        userMessage?: string;
        userId?: string;
        metadata?: Prisma.InputJsonValue;
    },
) {
    const code = await logClientError({
        area: params.area,
        message: params.message,
        status: params.status,
        userId: params.userId,
        metadata: params.metadata,
    });

    return res.status(params.status).json({
        error: params.message,
        userMessage: params.userMessage ?? 'Something went wrong — please try again.',
        code,
    });
}
