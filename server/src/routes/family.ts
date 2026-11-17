import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { UserRole } from '@prisma/client';
import { normalizePhone } from '../utils/phone.js';
import { MemoryService } from '../services/memory-service.js';

export async function familyRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // List members
  fastify.get('/members', async (request) => {
    const { familyId } = (request as any).user;
    return prisma.user.findMany({
      where: { familyId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        countryCode: true,
        whatsappNumber: true,
        whatsappJid: true,
        telegramChatId: true,
        avatarUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  });

  // Direct Add Family Member
  fastify.post('/members', async (request, reply) => {
    const { familyId, role: currentRole } = (request as any).user;
    if (currentRole !== UserRole.MANAGER) {
      return reply.status(403).send({ error: 'Hanya Manager keluarga yang dapat menambahkan anggota.' });
    }

    const {
      name,
      countryCode = '+62',
      whatsappNumber,
      telegramChatId,
      email,
      password,
      role = UserRole.MEMBER,
    } = request.body as any;

    if (!name) {
      return reply.status(400).send({ error: 'Nama anggota wajib diisi.' });
    }

    const phoneNorm = normalizePhone(whatsappNumber, countryCode);
    const cleanPhone = phoneNorm.cleanDigits || null;
    const fullJid = phoneNorm.whatsappJid || null;

    if (fullJid) {
      const existing = await prisma.user.findFirst({ where: { whatsappJid: fullJid } });
      if (existing) {
        return reply.status(400).send({ error: 'Nomor WhatsApp ini sudah terdaftar pada pengguna/keluarga lain.' });
      }
    }

    let cleanEmail: string | null = null;
    let passwordHash: string | null = null;
    if (email) {
      cleanEmail = String(email).trim().toLowerCase();
      const existingEmail = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existingEmail) {
        return reply.status(400).send({ error: 'Email ini sudah terdaftar pada akun lain.' });
      }
      if (password) {
        passwordHash = await bcrypt.hash(password, 10);
      }
    }

    const newMember = await prisma.user.create({
      data: {
        familyId,
        name: name.trim(),
        email: cleanEmail,
        passwordHash,
        role: role === 'MANAGER' ? UserRole.MANAGER : UserRole.MEMBER,
        countryCode: phoneNorm.countryCode,
        whatsappNumber: cleanPhone,
        whatsappJid: fullJid,
        telegramChatId: telegramChatId ? String(telegramChatId).trim() : null,
      },
    });

    // Otomatis masukkan ke daftar BotWhitelist jika nomor atau telegram ada
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
          name: newMember.name,
        },
        update: { name: newMember.name },
      });
    }

    if (telegramChatId) {
      const cleanTg = String(telegramChatId).trim();
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
          name: newMember.name,
        },
        update: { name: newMember.name },
      });
    }

    return newMember;
  });

  // Hapus Anggota
  fastify.delete('/members/:id', async (request, reply) => {
    const { familyId, role, userId } = (request as any).user;
    const { id } = request.params as any;

    if (role !== UserRole.MANAGER) {
      return reply.status(403).send({ error: 'Hanya Manager yang dapat menghapus anggota.' });
    }

    if (id === userId) {
      return reply.status(400).send({ error: 'Manager tidak dapat menghapus akunnya sendiri.' });
    }

    const targetMember = await prisma.user.findFirst({
      where: { id, familyId },
    });

    if (!targetMember) {
      return reply.status(404).send({ error: 'Anggota tidak ditemukan.' });
    }

    // Bersihkan dari BotWhitelist
    if (targetMember.whatsappJid) {
      await prisma.botWhitelist.deleteMany({
        where: { familyId, platform: 'WHATSAPP', identifier: targetMember.whatsappJid },
      });
    }
    if (targetMember.telegramChatId) {
      await prisma.botWhitelist.deleteMany({
        where: { familyId, platform: 'TELEGRAM', identifier: targetMember.telegramChatId },
      });
    }

    await prisma.user.delete({
      where: { id: targetMember.id },
    });

    return { success: true, message: `Anggota ${targetMember.name} berhasil dihapus dari keluarga.` };
  });

  // Get Family Profile (Termasuk Timezone)
  fastify.get('/profile', async (request) => {
    const { familyId } = (request as any).user;
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: {
        id: true,
        name: true,
        inviteCode: true,
        timezone: true,
        telegramBotUsername: true,
        createdAt: true,
      },
    });

    return family;
  });

  // Update Timezone Keluarga (Bisa diset manual atau otomatis dari browser/device)
  const updateTimezoneHandler = async (request: any, reply: any) => {
    const { familyId, role } = (request as any).user;
    const { timezone } = request.body as any;

    if (!timezone || typeof timezone !== 'string') {
      return reply.status(400).send({ error: 'Parameter timezone wajib diisi.' });
    }

    // Validasi apakah timezone IANA valid
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return reply.status(400).send({ error: `Format timezone "${timezone}" tidak valid.` });
    }

    const updated = await prisma.family.update({
      where: { id: familyId },
      data: { timezone },
      select: { id: true, name: true, timezone: true },
    });

    return {
      success: true,
      timezone: updated.timezone,
      message: `Zona waktu keluarga berhasil diperbarui ke ${updated.timezone}`,
    };
  };

  fastify.patch('/timezone', updateTimezoneHandler);
  fastify.put('/timezone', updateTimezoneHandler);

  // Get Invite Link & Code
  fastify.get('/invite', async (request) => {
    const { familyId } = (request as any).user;
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: { id: true, name: true, inviteCode: true },
    });

    return {
      inviteCode: family?.inviteCode,
      inviteUrl: `https://iniuangku.raydrop.web.id/join?code=${family?.inviteCode}`,
      familyName: family?.name,
    };
  });

  // 7. Family Persistent Memories (Instruksi & Memori Bot)
  fastify.get('/memories', async (request) => {
    const { familyId } = (request as any).user;
    return MemoryService.getMemories(familyId);
  });

  fastify.post('/memories', async (request, reply) => {
    const { familyId, id: userId } = (request as any).user;
    const { content, category } = request.body as any;
    if (!content || !content.trim()) {
      return reply.status(400).send({ error: 'Isi instruksi/memori tidak boleh kosong.' });
    }
    const mem = await MemoryService.saveMemory(familyId, content, userId, category || 'GENERAL');
    return mem;
  });

  fastify.delete('/memories/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;
    const count = await MemoryService.forgetMemory(familyId, undefined, id);
    return { success: true, count };
  });
}
