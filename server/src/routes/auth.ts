import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { UserRole, WalletType, TransactionType } from '@prisma/client';
import { normalizePhone } from '../utils/phone.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Register Manager
  fastify.post('/register', async (request, reply) => {
    const { name, email, password, whatsappNumber, countryCode = '+62', familyName = 'Keluarga Bahagia' } = request.body as any;

    if (!name || !email || !password) {
      return reply.status(400).send({ error: 'Nama, email, dan kata sandi wajib diisi.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return reply.status(400).send({ error: 'Email ini sudah terdaftar.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const inviteCode = 'FAM-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Buat Family & Manager dalam transaksi
    const result = await prisma.$transaction(async (tx) => {
      const family = await tx.family.create({
        data: {
          name: familyName,
          inviteCode,
          managerId: 'temp',
        },
      });

      const phoneNorm = normalizePhone(whatsappNumber, countryCode);
      const cleanPhone = phoneNorm.cleanDigits || null;
      const fullJid = phoneNorm.whatsappJid || null;

      const user = await tx.user.create({
        data: {
          familyId: family.id,
          name,
          email,
          passwordHash,
          role: UserRole.MANAGER,
          countryCode: phoneNorm.countryCode,
          whatsappNumber: cleanPhone,
          whatsappJid: fullJid,
        },
      });

      await tx.family.update({
        where: { id: family.id },
        data: { managerId: user.id },
      });

      // Default Wallets
      await tx.wallet.createMany({
        data: [
          { familyId: family.id, userId: user.id, name: 'BCA Utama', type: WalletType.BANK, balance: 1500000, colorCode: '#C1ECFD' },
          { familyId: family.id, userId: user.id, name: 'Kas Tunai', type: WalletType.CASH, balance: 350000, colorCode: '#FDEEAD' },
          { familyId: family.id, name: 'Rekening Bersama', type: WalletType.BANK, balance: 3000000, colorCode: '#FFC1B6', isShared: true },
        ],
      });

      // Default Kategori
      await tx.category.createMany({
        data: [
          { familyId: family.id, name: 'Kebutuhan Dapur & Belanja', icon: 'shopping-cart', color: '#FFC1B6', type: TransactionType.EXPENSE, monthlyBudget: 2500000 },
          { familyId: family.id, name: 'Makan Luar & Jajan', icon: 'coffee', color: '#FDEEAD', type: TransactionType.EXPENSE, monthlyBudget: 1200000 },
          { familyId: family.id, name: 'Transportasi & Bensin', icon: 'car', color: '#C1ECFD', type: TransactionType.EXPENSE, monthlyBudget: 800000 },
          { familyId: family.id, name: 'Tagihan Rumah & WiFi', icon: 'home', color: '#C3F0DE', type: TransactionType.EXPENSE, monthlyBudget: 1000000 },
          { familyId: family.id, name: 'Gaji & Pendapatan', icon: 'wallet', color: '#8DE2BE', type: TransactionType.INCOME },
        ],
      });

      // Default LLM Config
      await tx.llmConfig.create({
        data: {
          familyId: family.id,
          activeProvider: 'gemini',
          modelName: 'gemini-2.0-flash',
        },
      });

      return { user, family };
    });

    const token = fastify.jwt.sign({
      userId: result.user.id,
      familyId: result.family.id,
      role: result.user.role,
    });

    return {
      token,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        countryCode: result.user.countryCode,
        whatsappNumber: result.user.whatsappNumber,
      },
      family: result.family,
    };
  });

  // Login
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body as any;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Email dan kata sandi wajib diisi.' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { family: true },
    });

    if (!user || !user.passwordHash) {
      return reply.status(401).send({ error: 'Email atau kata sandi tidak sesuai.' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return reply.status(401).send({ error: 'Email atau kata sandi tidak sesuai.' });
    }

    const token = fastify.jwt.sign({
      userId: user.id,
      familyId: user.familyId,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        countryCode: user.countryCode,
        whatsappNumber: user.whatsappNumber,
        telegramChatId: user.telegramChatId,
      },
      family: user.family,
    };
  });

  // Profile me
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { family: true },
    });
    return user;
  });

  // Edit Profile User Sendiri (Ganti No HP / WhatsApp, Telegram ID, dan Nama)
  const updateProfileHandler = async (request: any, reply: any) => {
    const { userId, familyId } = (request as any).user;
    const { name, countryCode = '+62', whatsappNumber, telegramChatId } = request.body as any;

    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!currentUser) {
      return reply.status(404).send({ error: 'User tidak ditemukan.' });
    }

    const phoneNorm = normalizePhone(whatsappNumber, countryCode);
    const cleanPhone = phoneNorm.cleanDigits || null;
    const fullJid = phoneNorm.whatsappJid || null;

    // Cek apakah nomor WA sudah digunakan oleh akun lain
    if (fullJid) {
      const existing = await prisma.user.findFirst({
        where: {
          whatsappJid: fullJid,
          id: { not: userId },
        },
      });
      if (existing) {
        return reply.status(400).send({ error: 'Nomor WhatsApp ini sudah terdaftar pada pengguna lain.' });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name ? { name: name.trim() } : {}),
        countryCode: phoneNorm.countryCode,
        whatsappNumber: cleanPhone,
        whatsappJid: fullJid,
        telegramChatId: telegramChatId ? String(telegramChatId).trim() : null,
      },
      include: { family: true },
    });

    // Sinkronisasi otomatis ke tabel BotWhitelist
    // 1. WhatsApp Whitelist
    if (currentUser.whatsappJid && currentUser.whatsappJid !== fullJid) {
      await prisma.botWhitelist.deleteMany({
        where: { familyId, platform: 'WHATSAPP', identifier: currentUser.whatsappJid },
      });
    }
    if (fullJid) {
      await prisma.botWhitelist.upsert({
        where: {
          familyId_platform_identifier: {
            familyId,
            platform: 'WHATSAPP',
            identifier: fullJid,
          },
        },
        create: {
          familyId,
          platform: 'WHATSAPP',
          identifier: fullJid,
          name: updatedUser.name,
        },
        update: { name: updatedUser.name },
      });
    }

    // 2. Telegram Whitelist
    const cleanTg = telegramChatId ? String(telegramChatId).trim() : null;
    if (currentUser.telegramChatId && currentUser.telegramChatId !== cleanTg) {
      await prisma.botWhitelist.deleteMany({
        where: { familyId, platform: 'TELEGRAM', identifier: currentUser.telegramChatId },
      });
    }
    if (cleanTg) {
      await prisma.botWhitelist.upsert({
        where: {
          familyId_platform_identifier: {
            familyId,
            platform: 'TELEGRAM',
            identifier: cleanTg,
          },
        },
        create: {
          familyId,
          platform: 'TELEGRAM',
          identifier: cleanTg,
          name: updatedUser.name,
        },
        update: { name: updatedUser.name },
      });
    }

    return {
      success: true,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        countryCode: updatedUser.countryCode,
        whatsappNumber: updatedUser.whatsappNumber,
        whatsappJid: updatedUser.whatsappJid,
        telegramChatId: updatedUser.telegramChatId,
      },
      message: 'Profil dan nomor HP Anda berhasil diperbarui! Bot akan merespons nomor baru Anda.',
    };
  };

  fastify.patch('/me', { preHandler: [fastify.authenticate] }, updateProfileHandler);
  fastify.put('/me', { preHandler: [fastify.authenticate] }, updateProfileHandler);
}
