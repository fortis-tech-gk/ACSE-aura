import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';
import { peekUser } from './middleware/auth';
import { authRouter } from './routes/auth.routes';
import { squadRouter } from './routes/squad.routes';
import { adminRouter } from './routes/admin.routes';
import { financeRouter } from './routes/finance.routes';
import { accreditationRouter } from './routes/accreditation.routes';
import { accommodationRouter } from './routes/accommodation.routes';
import { scheduleRouter } from './routes/schedule.routes';
import { callRoomRouter } from './routes/callroom.routes';
import { fieldRouter } from './routes/field.routes';
import { trackRouter } from './routes/track.routes';
import { leaderboardRouter } from './routes/leaderboard.routes';
import { publicRouter } from './routes/public.routes';
import { athleteRouter } from './routes/athlete.routes';
import { cateringRouter } from './routes/catering.routes';
import { officialsRouter } from './routes/officials.routes';

dotenv.config();

const app = express();

// Behind nginx, req.ip must come from X-Forwarded-For — otherwise every user shares the proxy's
// IP and one rate-limit bucket. TRUST_PROXY = number of proxy hops (docker-compose sets 1).
// Leave unset when the API is exposed directly, so clients cannot spoof their IP.
const trustProxyHops = parseInt(process.env.TRUST_PROXY || '0', 10);
if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
const PORT = process.env.PORT || 5000;

// 1. HTTP Security Headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// 2. CORS configuration (allowing web and mobile app clients)
const allowedOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*';
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// 3. Body parsers with size limit
app.use(compression()); // gzip JSON — the officials roster is ~1 MB raw
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Rate Limiting — designed for shared networks.
// At the venue hundreds of phones share ONE public IP (stadium Wi-Fi, Jio/Airtel carrier NAT),
// so limiting per IP alone would lock everyone out. Logged-in traffic (the AURA apps) is limited
// per user; anonymous traffic (public leaderboard, logins) gets a high per-IP ceiling — those
// endpoints are cached. Brute-force protection for logins is per account (login_attempts table).
const WINDOW_MS = 15 * 60 * 1000;
const generalLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: (req: Request) => (peekUser(req) ? 600 : 20000), // 600 per user · 20k per shared IP
  keyGenerator: (req: Request) => {
    const user = peekUser(req);
    return user ? `user:${user.role}:${user.entityId}` : `ip:${ipKeyGenerator(req.ip || '')}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a minute and try again.' },
});

// Staff/squad logins: per-IP cap high enough for a venue full of officials on one network
const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 1000,
  keyGenerator: (req: Request) => `ip:${ipKeyGenerator(req.ip || '')}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please wait 15 minutes.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

// 5. Deep Health Check (DEPLOY-02)
app.get('/health', async (_req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { error } = await supabase.from('meet_settings').select('id').limit(1);
    const latencyMs = Date.now() - startTime;

    if (error) {
      return res.status(503).json({
        status: 'degraded',
        database: 'unreachable',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      status: 'healthy',
      database: 'connected',
      latencyMs,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(503).json({
      status: 'unhealthy',
      database: 'error',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// 6. Mount modular API routes
// Legacy registration/finance/admin endpoints duplicate the website (frontend/web), which is the
// only place enforcing the full registration rules (uniqueness, quotas, DOB, photos, roster lock,
// bank-confirmed payment amounts). They are OFF in production so they can't be used to bypass it.
// Local development keeps them for the old scripts/test-*.mjs flows.
const LEGACY_REGISTRATION_ROUTES =
  process.env.NODE_ENV !== 'production' || process.env.ENABLE_LEGACY_REGISTRATION_ROUTES === 'true';
if (!LEGACY_REGISTRATION_ROUTES) {
  const gone = (_req: Request, res: Response) =>
    res.status(410).json({ error: 'This endpoint is not available. Use the VTU SportsOS website.' });
  app.use('/api/auth/squad', gone);
  app.use('/api/squad', gone);
  app.use('/api/finance', gone);
  app.use('/api/admin', gone);
}

app.use('/api/auth', authRouter);
app.use('/api/squad', squadRouter);
app.use('/api/admin', adminRouter);
app.use('/api/finance', financeRouter);
app.use('/api/accreditation', accreditationRouter);
app.use('/api/accommodation', accommodationRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/callroom', callRoomRouter);
app.use('/api/field', fieldRouter);
app.use('/api/track', trackRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/athlete', athleteRouter);
app.use('/api/catering', cateringRouter);
app.use('/api/officials', officialsRouter);
app.use('/api', publicRouter);

// 7. Global 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// 8. Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Error]:', err);
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
  });
});

// 9. Start Server with Graceful Shutdown
const server = app.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`🚀 VTU SportsOS Backend API running`);
  console.log(`   Port: http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`=============================================`);
});

const gracefulShutdown = (signal: string) => {
  console.log(`Received ${signal}. Gracefully shutting down...`);
  server.close(() => {
    console.log('HTTP server closed cleanly.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
