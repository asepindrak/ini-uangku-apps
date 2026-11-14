import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function sinkingFundRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // List sinking funds
  fastify.get('/', async (request) => {
    const { familyId } = (request as any).user;
    const funds = await prisma.sinkingFund.findMany({
      where: { familyId },
      orderBy: { createdAt: 'asc' },
    });

    return funds.map((f) => ({
      id: f.id,
      name: f.name,
      targetAmount: Number(f.targetAmount),
      currentAmount: Number(f.currentAmount),
      monthlyAlloc: Number(f.monthlyAlloc),
      sourceWalletId: f.sourceWalletId,
      isActive: f.isActive,
      lastAllocatedAt: f.lastAllocatedAt,
    }));
  });

  // Create sinking fund
  fastify.post('/', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { name, targetAmount, monthlyAlloc, sourceWalletId } = request.body as any;

    if (!name || !targetAmount || !monthlyAlloc || !sourceWalletId) {
      return reply.status(400).send({ error: 'Nama pos, target, alokasi bulanan, dan dompet sumber wajib diisi.' });
    }

    const fund = await prisma.sinkingFund.create({
      data: {
        familyId,
        name,
        targetAmount: Number(targetAmount),
        monthlyAlloc: Number(monthlyAlloc),
        sourceWalletId,
      },
    });

    return fund;
  });

  // Delete sinking fund
  fastify.delete('/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;

    await prisma.sinkingFund.deleteMany({
      where: { id, familyId },
    });

    return { success: true };
  });
}
