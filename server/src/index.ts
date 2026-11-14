import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { connectDB } from './db.js';
import { authRoutes } from './routes/auth.js';
import { familyRoutes } from './routes/family.js';
import { walletRoutes } from './routes/wallets.js';
import { transactionRoutes } from './routes/transactions.js';
import { sinkingFundRoutes } from './routes/sinking-funds.js';
import { assetDebtRoutes } from './routes/assets-debts.js';
import { botRoutes } from './routes/bot.js';
import { llmRoutes } from './routes/llm.js';
import { BotGateway } from './services/bot-gateway.js';
import { TelegramManager } from './services/telegram-manager.js';
import { SchedulerService } from './services/scheduler.js';

const fastify = Fastify({
  logger: process.env.NODE_ENV === 'development' ? {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  } : true,
});

// Plugins
await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'iniuangku_super_secret_family_jwt_key_2026',
});

await fastify.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB max media
  },
});

// Authentication Decorator
fastify.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Sesi kedaluwarsa atau token tidak valid. Silakan login kembali.' });
  }
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', app: 'Ini Uangku API Server', timestamp: new Date() };
});

// Register Routes
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(familyRoutes, { prefix: '/api/family' });
await fastify.register(walletRoutes, { prefix: '/api/wallets' });
await fastify.register(transactionRoutes, { prefix: '/api/transactions' });
await fastify.register(sinkingFundRoutes, { prefix: '/api/sinking-funds' });
await fastify.register(assetDebtRoutes, { prefix: '/api/assets-debts' });
await fastify.register(botRoutes, { prefix: '/api/bot' });
await fastify.register(llmRoutes, { prefix: '/api/llm' });

// Bootstrap Server
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function start() {
  try {
    await connectDB();
    
    // Inisialisasi Bot Gateway (WhatsApp Baileys & Telegram Mandiri) & Scheduler
    BotGateway.init().catch((err) => console.error('Bot init error:', err));
    TelegramManager.initAll().catch((err) => console.error('TelegramManager init error:', err));
    SchedulerService.init();

    await fastify.listen({ port: PORT, host: HOST });
    console.log(`🚀 Ini Uangku Server aktif di http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
