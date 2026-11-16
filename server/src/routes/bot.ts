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
      wsReadyState: (BotGateway as any).waSock?.ws?.readyState ?? null,
      waUser: (BotGateway as any).waSock?.user ?? null,
      lastError: BotGateway.lastSendError,
      telegramConnected: TelegramManager.isBotRunning(familyId),
      globalTelegramBotRunning: TelegramManager.isGlobalBotRunning,
      globalTelegramBotUsername: TelegramManager.globalBotUsername,
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
      globalBotRunning: TelegramManager.isGlobalBotRunning,
      globalBotUsername: TelegramManager.globalBotUsername,
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

  // POST Test Send WhatsApp
  fastify.post('/test-send', async (request, reply) => {
    const { jid, text } = request.body as any;
    try {
      const result = await BotGateway.sendWhatsAppMessage(jid, text || 'Test ping dari Monee 🎀');
      if (!result) {
        return reply.status(500).send({
          success: false,
          error: BotGateway.lastSendError || 'Gagal mengirim pesan (socket time out / tidak terkirim)',
        });
      }
      return { success: true, result: result?.key || null };
    } catch (e: any) {
      return reply.status(500).send({
        success: false,
        error: e.message,
      });
    }
  });

  // POST Reset Sesi Kontak WhatsApp (Jika kontak mengalami 'Menunggu pesan ini' / E2EE Desync)
  fastify.post('/reset-contact-session', async (request) => {
    const { jid } = request.body as any;
    const rawId = (jid || '').split('@')[0]?.split(':')[0];
    if (rawId) {
      await BotGateway.resetContactSession(rawId);
      return { success: true, message: `Sesi kontak ${rawId} berhasil di-reset untuk handshake baru!` };
    }
    return { success: false, message: 'JID tidak valid' };
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

  // POST Tambah ID (WhatsApp atau Telegram) ke Whitelist Keluarga
  fastify.post('/whitelist', async (request, reply) => {
    const { familyId } = (request as any).user;
    const {
      platform = 'WHATSAPP',
      identifier,
      name,
      canRecord = true,
      canViewReports = true,
    } = request.body as any;

    if (!identifier) {
      return reply.status(400).send({ error: 'Identifier (Nomor/ID) wajib diisi.' });
    }

    const cleanedId = String(identifier).trim();
    const targetPlatform = String(platform).toUpperCase() === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP';
    const entryName = (name || (targetPlatform === 'TELEGRAM' ? 'Akun Telegram' : 'Akun WhatsApp')).trim();

    const entry = await prisma.botWhitelist.upsert({
      where: {
        familyId_platform_identifier: {
          familyId,
          platform: targetPlatform as any,
          identifier: cleanedId,
        },
      },
      update: {
        name: entryName,
        canRecord: Boolean(canRecord),
        canViewReports: Boolean(canViewReports),
      },
      create: {
        familyId,
        platform: targetPlatform as any,
        identifier: cleanedId,
        name: entryName,
        canRecord: Boolean(canRecord),
        canViewReports: Boolean(canViewReports),
      },
    });

    return { success: true, entry };
  });

  // DELETE Hapus ID dari Whitelist
  fastify.delete('/whitelist/:id', async (request) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;

    await prisma.botWhitelist.deleteMany({
      where: { id, familyId },
    });

    return { success: true, message: 'ID berhasil dihapus dari whitelist.' };
  });

  // POST Tambah ID Telegram ke Whitelist Keluarga (Legacy alias)
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

  // GET Riwayat Chat Bot AI (WhatsApp & Telegram)
  fastify.get('/chats', async (request) => {
    const { familyId, role } = (request as any).user;
    const { platform, status, limit = 50 } = request.query as any;

    const where: any = {
      OR: [
        { familyId },
        // Jika Manager, tampilkan juga pesan yang ditolak (unwhitelisted) agar mudah di-debug
        ...(role === 'MANAGER' ? [{ familyId: null }] : []),
      ],
    };

    if (platform && platform !== 'ALL') {
      where.platform = platform;
    }
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const chats = await prisma.botChatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 100),
      include: {
        user: {
          select: { id: true, name: true, role: true, countryCode: true, whatsappNumber: true },
        },
      },
    });

    return chats;
  });

  // DELETE Hapus Riwayat Chat Bot
  fastify.delete('/chats', async (request) => {
    const { familyId } = (request as any).user;
    await prisma.botChatMessage.deleteMany({
      where: {
        OR: [
          { familyId },
          { familyId: null },
        ],
      },
    });
    return { success: true, message: 'Riwayat chat bot AI berhasil dibersihkan.' };
  });
}
