import appleSignIn from 'apple-signin-auth';

export async function verifyAppleToken(identityToken: string) {
    const payload = await appleSignIn.verifyIdToken(identityToken, {
        audience: process.env.APPLE_BUNDLE_ID!,
        ignoreExpiration: false,
    });
    return { sub: payload.sub, email: payload.email ?? null };
}
