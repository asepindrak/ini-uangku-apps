import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { AssetType } from '@prisma/client';

export async function assetDebtRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // Net Worth Summary
  fastify.get('/net-worth', async (request) => {
    const { familyId } = (request as any).user;

    const [wallets, assets, debts] = await Promise.all([
      prisma.wallet.aggregate({
        where: { familyId },
        _sum: { balance: true },
      }),
      prisma.familyAsset.aggregate({
        where: { familyId },
        _sum: { currentValue: true },
      }),
      prisma.familyDebt.aggregate({
        where: { familyId, isActive: true },
        _sum: { remainingAmount: true },
      }),
    ]);

    const totalCash = Number(wallets._sum.balance || 0);
    const totalAsset = Number(assets._sum.currentValue || 0);
    const totalDebt = Number(debts._sum.remainingAmount || 0);
    const netWorth = (totalCash + totalAsset) - totalDebt;

    return {
      totalCash,
      totalAsset,
      totalDebt,
      netWorth,
    };
  });

  // Assets list & create
  fastify.get('/assets', async (request) => {
    const { familyId } = (request as any).user;
    return prisma.familyAsset.findMany({ where: { familyId }, orderBy: { createdAt: 'desc' } });
  });

  fastify.post('/assets', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { name, type = 'OTHER', acquisitionCost = 0, currentValue, notes } = request.body as any;

    if (!name || currentValue === undefined) {
      return reply.status(400).send({ error: 'Nama aset dan nilai taksiran pasar wajib diisi.' });
    }

    return prisma.familyAsset.create({
      data: {
        familyId,
        name,
        type: type as AssetType,
        acquisitionCost: Number(acquisitionCost),
        currentValue: Number(currentValue),
        notes,
      },
    });
  });

  // Debts list & create
  fastify.get('/debts', async (request) => {
    const { familyId } = (request as any).user;
    return prisma.familyDebt.findMany({ where: { familyId }, orderBy: { createdAt: 'desc' } });
  });

  fastify.post('/debts', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { name, principalAmount, remainingAmount, monthlyPayment, dueDayOfMonth = 10, totalTenorMonth = 12, remainingTenor = 12 } = request.body as any;

    if (!name || remainingAmount === undefined || monthlyPayment === undefined) {
      return reply.status(400).send({ error: 'Nama cicilan, sisa utang, dan angsuran per bulan wajib diisi.' });
    }

    return prisma.familyDebt.create({
      data: {
        familyId,
        name,
        principalAmount: Number(principalAmount || remainingAmount),
        remainingAmount: Number(remainingAmount),
        monthlyPayment: Number(monthlyPayment),
        dueDayOfMonth: Number(dueDayOfMonth),
        totalTenorMonth: Number(totalTenorMonth),
        remainingTenor: Number(remainingTenor),
      },
    });
  });
}
