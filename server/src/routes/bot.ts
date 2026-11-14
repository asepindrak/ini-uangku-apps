import { FastifyInstance } from 'fastify';
import { BotGateway } from '../services/bot-gateway.js';
import { TelegramManager } from '../services/telegram-manager.js';
import { prisma } from '../db.js';

export async function botRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Status Bot
  fastify.get('/status', async (request) => {
    const { familyId } = (request as any).user;
    
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: { telegramBotToken: true, telegramBotUsername: true },
    });

    const userCount = await prisma.user.count({
      where: {
        familyId,
        OR: [
          { whatsappNumber: { not: null } },
          { telegramChatId: { not: null } },
        ],
      },
    });

    const extraWhitelistCount = await prisma.botWhitelist.count({
      where: { familyId },
    });

    return {
      whatsappConnected: BotGateway.isWaConnected,
      whatsappQr: BotGateway.latestWaQrCode,
      telegramConnected: TelegramManager.isBotRunning(familyId) || BotGateway.isTelegramConnected,
      familyTelegramConfigured: Boolean(family?.telegramBotToken),
      familyTelegramUsername: family?.telegramBotUsername || null,
      isFamilyBotRunning: TelegramManager.isBotRunning(familyId),
      whitelistCount: userCount + extraWhitelistCount,
    };
  });

  // Re-init WhatsApp QR
  fastify.post('/restart-whatsapp', async () => {
    await BotGateway.initWhatsApp();
    return { success: true };
  });

  // GET Konfigurasi Telegram Bot Keluarga & Daftar User ID
  fastify.get('/telegram-config', async (request) => {
    const { familyId } = (request as any).user;
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: { telegramBotToken: true, telegramBotUsername: true, name: true },
    });

    const whitelists = await prisma.botWhitelist.findMany({
      where: { familyId, platform: 'TELEGRAM' },
      orderBy: { createdAt: 'desc' },
    });

    const memberUsers = await prisma.user.findMany({
      where: { familyId, telegramChatId: { not: null } },
      select: { id: true, name: true, telegramChatId: true, role: true },
    });

    return {
      configured: Boolean(family?.telegramBotToken),
      token: family?.telegramBotToken || '',
      username: family?.telegramBotUsername || null,
      isRunning: TelegramManager.isBotRunning(familyId),
      familyName: family?.name,
      whitelists,
      memberUsers,
    };
  });

  // PUT Simpan dan Aktifkan Bot Telegram Keluarga
  fastify.put('/telegram-config', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { botToken } = request.body as { botToken?: string };

    if (!botToken || !botToken.trim()) {
      return reply.status(400).send({ error: 'Token bot Telegram tidak boleh kosong.' });
    }

    try {
      const result = await TelegramManager.startFamilyBot(familyId, botToken.trim());
      return {
        success: true,
        message: `Bot Telegram @${result.username} berhasil diaktifkan!`,
        username: result.username,
      };
    } catch (err: any) {
      console.error('Gagal mengaktifkan bot Telegram keluarga:', err);
      return reply.status(400).send({
        error: `Gagal mengaktifkan bot: ${err.message || 'Token tidak valid'}. Pastikan token benar dari @BotFather.`,
      });
    }
  });

  // DELETE Hentikan dan Hapus Bot Telegram Keluarga
  fastify.delete('/telegram-config', async (request) => {
    const { familyId } = (request as any).user;
    await TelegramManager.stopFamilyBot(familyId);

    await prisma.family.update({
      where: { id: familyId },
      data: {
        telegramBotToken: null,
        telegramBotUsername: null,
      },
    });

    return { success: true, message: 'Bot Telegram keluarga berhasil dinonaktifkan.' };
  });

  // POST Tambah ID Telegram ke Whitelist Keluarga
  fastify.post('/telegram-whitelist', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { identifier, name, canRecord = true, canViewReports = true } = request.body as any;

    if (!identifier || !name) {
      return reply.status(400).send({ error: 'User ID Telegram dan nama wajib diisi.' });
    }

    const cleanedId = String(identifier).trim();
    const entry = await prisma.botWhitelist.upsert({
      where: {
        familyId_platform_identifier: {
          familyId,
          platform: 'TELEGRAM',
          identifier: cleanedId,
        },
      },
      update: {
        name: name.trim(),
        canRecord: Boolean(canRecord),
        canViewReports: Boolean(canViewReports),
      },
      create: {
        familyId,
        platform: 'TELEGRAM',
        identifier: cleanedId,
        name: name.trim(),
        canRecord: Boolean(canRecord),
        canViewReports: Boolean(canViewReports),
      },
    });

    return { success: true, entry };
  });

  // DELETE Hapus ID Telegram dari Whitelist
  fastify.delete('/telegram-whitelist/:id', async (request) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;

    await prisma.botWhitelist.deleteMany({
      where: { id, familyId },
    });

    return { success: true, message: 'ID Telegram berhasil dihapus dari whitelist.' };
  });
}
