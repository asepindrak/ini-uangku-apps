import { FastifyInstance } from 'fastify';
import { BotGateway } from '../services/bot-gateway.js';
import { prisma } from '../db.js';

export async function botRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Status Bot
  fastify.get('/status', async (request) => {
    const { familyId } = (request as any).user;
    const whitelistCount = await prisma.user.count({
      where: {
        familyId,
        OR: [
          { whatsappNumber: { not: null } },
          { telegramChatId: { not: null } },
        ],
      },
    });

    return {
      whatsappConnected: BotGateway.isWaConnected,
      whatsappQr: BotGateway.latestWaQrCode,
      telegramConnected: BotGateway.isTelegramConnected,
      whitelistCount,
    };
  });

  // Re-init WhatsApp QR
  fastify.post('/restart-whatsapp', async () => {
    await BotGateway.initWhatsApp();
    return { success: true };
  });
}
