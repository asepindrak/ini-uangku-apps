import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { UserRole } from '@prisma/client';

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

    const { name, countryCode = '+62', whatsappNumber, telegramChatId, role = UserRole.MEMBER } = request.body as any;

    if (!name) {
      return reply.status(400).send({ error: 'Nama anggota wajib diisi.' });
    }

    const cleanPhone = (whatsappNumber || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
    const cleanCountry = (countryCode || '+62').replace('+', '');
    const fullJid = cleanPhone ? `${cleanCountry}${cleanPhone}@s.whatsapp.net` : null;

    const newMember = await prisma.user.create({
      data: {
        familyId,
        name,
        role: role === 'MANAGER' ? UserRole.MANAGER : UserRole.MEMBER,
        countryCode: countryCode || '+62',
        whatsappNumber: cleanPhone || null,
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
          name,
        },
        update: { name },
      });
    }

    if (telegramChatId) {
      await prisma.botWhitelist.upsert({
        where: {
          familyId_platform_identifier: {
            familyId,
            platform: 'TELEGRAM',
            identifier: String(telegramChatId).trim(),
          },
        },
        create: {
          familyId,
          platform: 'TELEGRAM',
          identifier: String(telegramChatId).trim(),
          name,
        },
        update: { name },
      });
    }

    return newMember;
  });

  // Hapus Anggota
  fastify.delete('/members/:id', async (request, reply) => {
    const { familyId, role } = (request as any).user;
    const { id } = request.params as any;

    if (role !== UserRole.MANAGER) {
      return reply.status(403).send({ error: 'Hanya Manager yang dapat menghapus anggota.' });
    }

    await prisma.user.deleteMany({
      where: { id, familyId },
    });

    return { success: true };
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
}
