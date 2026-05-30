const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateInviteCode(): string {
    let code = '';
    for (let i = 0; i < 8; i += 1) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
}

export function formatCode(code: string): string {
    return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normaliseCode(input: string): string {
    return input.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}
