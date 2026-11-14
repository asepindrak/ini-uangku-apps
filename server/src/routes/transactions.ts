import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { TransactionType, InputSource, ActionStatus } from '@prisma/client';
import { ApprovalEngine } from '../services/approval-engine.js';

export async function transactionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // List transactions
  fastify.get('/', async (request) => {
    const { familyId } = (request as any).user;
    const { limit = '50', walletId, categoryId } = request.query as any;

    const where: any = { familyId };
    if (walletId) where.walletId = walletId;
    if (categoryId) where.categoryId = categoryId;

    const list = await prisma.transaction.findMany({
      where,
      take: Math.min(Number(limit) || 50, 100),
      orderBy: { transactionDate: 'desc' },
      include: {
        wallet: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true, icon: true } },
        user: { select: { id: true, name: true } },
      },
    });

    return list.map((t) => ({
      id: t.id,
      walletId: t.walletId,
      walletName: t.wallet.name,
      categoryId: t.categoryId,
      categoryName: t.category?.name,
      categoryColor: t.category?.color,
      userId: t.userId,
      userName: t.user?.name,
      type: t.type,
      amount: Number(t.amount),
      description: t.description,
      transactionDate: t.transactionDate,
      inputSource: t.inputSource,
      rawMediaUrl: t.rawMediaUrl,
    }));
  });

  // Summary Metrics
  fastify.get('/summary', async (request) => {
    const { familyId } = (request as any).user;
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayExpense, monthExpense, monthIncome, allWallets] = await Promise.all([
      prisma.transaction.aggregate({
        where: { familyId, type: TransactionType.EXPENSE, transactionDate: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { familyId, type: TransactionType.EXPENSE, transactionDate: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { familyId, type: TransactionType.INCOME, transactionDate: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.wallet.aggregate({
        where: { familyId },
        _sum: { balance: true },
      }),
    ]);

    return {
      todayExpense: Number(todayExpense._sum.amount || 0),
      monthExpense: Number(monthExpense._sum.amount || 0),
      monthIncome: Number(monthIncome._sum.amount || 0),
      totalCashBalance: Number(allWallets._sum.balance || 0),
    };
  });

  // Create manual transaction
  fastify.post('/', async (request, reply) => {
    const { familyId, userId } = (request as any).user;
    const { walletId, categoryId, amount, description, type = 'EXPENSE', transactionDate } = request.body as any;

    if (!walletId || !amount || !description) {
      return reply.status(400).send({ error: 'Dompet, nominal, dan deskripsi wajib diisi.' });
    }

    const numAmount = Number(amount);
    const transType = type as TransactionType;

    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
        data: {
          familyId,
          walletId,
          categoryId: categoryId || null,
          userId,
          type: transType,
          amount: numAmount,
          description,
          transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
          inputSource: InputSource.APP_MANUAL,
        },
      });

      const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
      if (wallet) {
        const bal = Number(wallet.balance);
        await tx.wallet.update({
          where: { id: walletId },
          data: {
            balance: transType === TransactionType.INCOME ? bal + numAmount : bal - numAmount,
          },
        });
      }

      return created;
    });

    return transaction;
  });

  // Get active pending approval actions
  fastify.get('/pending', async (request) => {
    const { familyId } = (request as any).user;
    const pendingList = await prisma.pendingAction.findMany({
      where: {
        familyId,
        status: ActionStatus.PENDING_APPROVAL,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return pendingList.map((p) => ({
      id: p.id,
      actionType: p.actionType,
      status: p.status,
      proposedPayload: p.proposedPayload,
      summaryText: p.summaryText,
      expiresAt: p.expiresAt,
      createdAt: p.createdAt,
      userName: p.user.name,
    }));
  });

  // Respond to pending approval from app
  fastify.post('/pending/:id/respond', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as any;
    const { approved } = request.body as any;

    const pending = await prisma.pendingAction.findUnique({ where: { id } });
    if (!pending || pending.status !== ActionStatus.PENDING_APPROVAL) {
      return reply.status(404).send({ error: 'Aksi persetujuan tidak ditemukan atau sudah kadaluarsa.' });
    }

    const response = await ApprovalEngine.processResponse(userId, approved ? 'Ya' : 'Batal');
    return response;
  });
}
