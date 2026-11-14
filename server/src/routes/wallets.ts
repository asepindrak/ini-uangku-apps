import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { WalletType } from '@prisma/client';

export async function walletRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Get all wallets for current family
  fastify.get('/', async (request) => {
    const { familyId } = (request as any).user;
    const wallets = await prisma.wallet.findMany({
      where: { familyId },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return wallets.map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      accountNumber: w.accountNumber,
      balance: Number(w.balance),
      colorCode: w.colorCode,
      isShared: w.isShared,
      userId: w.userId,
      userName: w.user?.name,
    }));
  });

  // Create wallet
  fastify.post('/', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { name, type = 'BANK', balance = 0, colorCode, isShared = false, userId } = request.body as any;

    if (!name) {
      return reply.status(400).send({ error: 'Nama dompet wajib diisi.' });
    }

    const wallet = await prisma.wallet.create({
      data: {
        familyId,
        name,
        type: type as WalletType,
        balance: Number(balance) || 0,
        colorCode: colorCode || '#C1ECFD',
        isShared: Boolean(isShared),
        userId: userId || null,
      },
    });

    return wallet;
  });

  // Update wallet
  fastify.put('/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;
    const { name, balance, colorCode, isShared } = request.body as any;

    const updated = await prisma.wallet.updateMany({
      where: { id, familyId },
      data: {
        ...(name && { name }),
        ...(balance !== undefined && { balance: Number(balance) }),
        ...(colorCode && { colorCode }),
        ...(isShared !== undefined && { isShared: Boolean(isShared) }),
      },
    });

    return { success: true };
  });

  // Delete wallet
  fastify.delete('/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;

    await prisma.wallet.deleteMany({
      where: { id, familyId },
    });

    return { success: true };
  });
}
