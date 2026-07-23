import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth';
import { authMiddleware } from './middleware/auth';
import { requireSubscription } from './middleware/subscription';
import userRouter from './routes/users';
import captureRouter from './routes/captures';
import householdRouter from './routes/household';
import householdPublicRouter from './routes/householdPublic';
import listRouter from './routes/list';
import demoRouter from './routes/demo';
import revenuecatWebhookRouter from './routes/revenuecatWebhook';
import { logPushConfiguration } from './lib/pushNotifications';

const app = express();

// Railway (and similar) terminate TLS at the edge; trust one proxy hop so
// req.ip and rate limiting use X-Forwarded-For instead of the proxy IP.
app.set('trust proxy', 1);

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

const demoLimiter = rateLimit({ windowMs: 60_000, max: 5 });
app.use('/demo', demoLimiter, demoRouter);
app.use('/webhooks', revenuecatWebhookRouter);
app.use('/household', householdPublicRouter);

app.use('/auth', authRouter);
app.use(authMiddleware);
app.use('/users', userRouter);
app.use('/captures', requireSubscription, captureRouter);
app.use('/household', householdRouter);
app.use('/list', requireSubscription, listRouter);

const PORT = process.env.PORT || 3001;
logPushConfiguration();
app.listen(PORT, () => console.log(`Drop API running on port ${PORT}`));
