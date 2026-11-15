import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { TransactionType, InputSource, ActionStatus } from '@prisma/client';
import { ApprovalEngine } from '../services/approval-engine.js';

export async function transactionRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  // List transactions with FULL FILTERING
  fastify.get('/', async (request) => {
    const { familyId } = (request as any).user;
    const {
      limit = '100',
      walletId,
      categoryId,
      userId,
      type,
      search,
      startDate,
      endDate,
    } = request.query as any;

    const where: any = { familyId };
    if (walletId && walletId !== 'ALL') where.walletId = walletId;
    if (categoryId && categoryId !== 'ALL') where.categoryId = categoryId;
    if (userId && userId !== 'ALL') where.userId = userId;
    if (type && type !== 'ALL') where.type = type as TransactionType;

    if (search && search.trim()) {
      where.OR = [
        { description: { contains: search.trim(), mode: 'insensitive' } },
        { category: { name: { contains: search.trim(), mode: 'insensitive' } } },
        { wallet: { name: { contains: search.trim(), mode: 'insensitive' } } },
      ];
    }

    if (startDate || endDate) {
      where.transactionDate = {};
      if (startDate) {
        where.transactionDate.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.transactionDate.lte = end;
      }
    }

    const list = await prisma.transaction.findMany({
      where,
      take: Math.min(Number(limit) || 100, 500),
      orderBy: { transactionDate: 'desc' },
      include: {
        wallet: { select: { id: true, name: true, type: true } },
        category: { select: { id: true, name: true, color: true, icon: true } },
        user: { select: { id: true, name: true } },
      },
    });

    return list.map((t) => ({
      id: t.id,
      walletId: t.walletId,
      walletName: t.wallet.name,
      walletType: t.wallet.type,
      categoryId: t.categoryId,
      categoryName: t.category?.name,
      categoryColor: t.category?.color,
      categoryIcon: t.category?.icon,
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

  // Analytics & Dashboard Visual Data
  fastify.get('/analytics', async (request) => {
    const { familyId } = (request as any).user;
    const { period = '30d', walletId } = request.query as any;

    const now = new Date();
    let startDate: Date;
    if (period === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === '90d') {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (period === 'year') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else {
      // 30d default
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const where: any = {
      familyId,
      transactionDate: { gte: startDate },
    };
    if (walletId && walletId !== 'ALL') where.walletId = walletId;

    const [transactions, categories, wallets] = await Promise.all([
      prisma.transaction.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, color: true, icon: true } },
          wallet: { select: { id: true, name: true, type: true } },
        },
        orderBy: { transactionDate: 'asc' },
      }),
      prisma.category.findMany({ where: { familyId } }),
      prisma.wallet.findMany({ where: { familyId } }),
    ]);

    let totalIncome = 0;
    let totalExpense = 0;
    const catMap = new Map<string, { id: string; name: string; color: string; icon: string; total: number; count: number }>();
    const walletSpendingMap = new Map<string, { id: string; name: string; income: number; expense: number }>();
    const dailyMap = new Map<string, { date: string; label: string; income: number; expense: number }>();

    for (const t of transactions) {
      const amt = Number(t.amount);
      if (t.type === TransactionType.INCOME) {
        totalIncome += amt;
      } else if (t.type === TransactionType.EXPENSE) {
        totalExpense += amt;

        // Category breakdown (for expenses)
        const catKey = t.category?.id || 'uncategorized';
        const existingCat = catMap.get(catKey) || {
          id: catKey,
          name: t.category?.name || 'Tanpa Kategori',
          color: t.category?.color || '#FFC1B6',
          icon: t.category?.icon || 'Tag',
          total: 0,
          count: 0,
        };
        existingCat.total += amt;
        existingCat.count += 1;
        catMap.set(catKey, existingCat);
      }

      // Wallet breakdown
      const wKey = t.walletId;
      const existingW = walletSpendingMap.get(wKey) || {
        id: wKey,
        name: t.wallet.name,
        income: 0,
        expense: 0,
      };
      if (t.type === TransactionType.INCOME) existingW.income += amt;
      if (t.type === TransactionType.EXPENSE) existingW.expense += amt;
      walletSpendingMap.set(wKey, existingW);

      // Daily trend
      const d = new Date(t.transactionDate);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayLabel = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const existingDay = dailyMap.get(dateKey) || { date: dateKey, label: dayLabel, income: 0, expense: 0 };
      if (t.type === TransactionType.INCOME) existingDay.income += amt;
      if (t.type === TransactionType.EXPENSE) existingDay.expense += amt;
      dailyMap.set(dateKey, existingDay);
    }

    const categoryBreakdown = Array.from(catMap.values())
      .map((c) => ({
        ...c,
        percentage: totalExpense > 0 ? Math.round((c.total / totalExpense) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const walletBreakdown = Array.from(walletSpendingMap.values());
    const dailyTrend = Array.from(dailyMap.values());

    // Top 5 largest expenses
    const topExpenses = transactions
      .filter((t) => t.type === TransactionType.EXPENSE)
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 5)
      .map((t) => ({
        id: t.id,
        description: t.description,
        amount: Number(t.amount),
        date: t.transactionDate,
        categoryName: t.category?.name || 'Umum',
        walletName: t.wallet?.name,
      }));

    return {
      period,
      totalIncome,
      totalExpense,
      netSavings: totalIncome - totalExpense,
      savingsRate: totalIncome > 0 ? Math.max(0, Math.round(((totalIncome - totalExpense) / totalIncome) * 100)) : 0,
      categoryBreakdown,
      walletBreakdown,
      dailyTrend,
      topExpenses,
    };
  });

  // Financial Report (Laporan Keuangan Keluarga Komprehensif)
  fastify.get('/report', async (request) => {
    const { familyId } = (request as any).user;
    const { month, year } = request.query as any;

    const now = new Date();
    const selYear = Number(year) || now.getFullYear();
    const selMonth = month !== undefined ? Number(month) : now.getMonth(); // 0-indexed

    const startOfMonth = new Date(selYear, selMonth, 1);
    const endOfMonth = new Date(selYear, selMonth + 1, 0, 23, 59, 59, 999);

    const [transactions, wallets, sinkingFunds, categories] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          familyId,
          transactionDate: { gte: startOfMonth, lte: endOfMonth },
        },
        include: {
          wallet: { select: { id: true, name: true, type: true } },
          category: { select: { id: true, name: true, color: true, monthlyBudget: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { transactionDate: 'desc' },
      }),
      prisma.wallet.findMany({ where: { familyId } }),
      prisma.sinkingFund.findMany({ where: { familyId } }),
      prisma.category.findMany({ where: { familyId } }),
    ]);

    let totalIncome = 0;
    let totalExpense = 0;
    const catMap = new Map<string, { id: string; name: string; budget: number; actual: number; count: number }>();

    for (const c of categories) {
      catMap.set(c.id, {
        id: c.id,
        name: c.name,
        budget: Number(c.monthlyBudget || 0),
        actual: 0,
        count: 0,
      });
    }

    for (const t of transactions) {
      const amt = Number(t.amount);
      if (t.type === TransactionType.INCOME) {
        totalIncome += amt;
      } else if (t.type === TransactionType.EXPENSE) {
        totalExpense += amt;
        if (t.categoryId && catMap.has(t.categoryId)) {
          const item = catMap.get(t.categoryId)!;
          item.actual += amt;
          item.count += 1;
        } else {
          const uncat = catMap.get('uncategorized') || {
            id: 'uncategorized',
            name: 'Lain-lain / Umum',
            budget: 0,
            actual: 0,
            count: 0,
          };
          uncat.actual += amt;
          uncat.count += 1;
          catMap.set('uncategorized', uncat);
        }
      }
    }

    const budgetReport = Array.from(catMap.values())
      .filter((c) => c.actual > 0 || c.budget > 0)
      .map((c) => ({
        ...c,
        variance: c.budget > 0 ? c.budget - c.actual : 0,
        utilization: c.budget > 0 ? Math.round((c.actual / c.budget) * 100) : 100,
      }));

    return {
      periodLabel: startOfMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
      totalIncome,
      totalExpense,
      netCashFlow: totalIncome - totalExpense,
      transactionCount: transactions.length,
      budgetReport,
      wallets: wallets.map((w) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        balance: Number(w.balance),
      })),
      sinkingFunds: sinkingFunds.map((s) => ({
        id: s.id,
        name: s.name,
        target: Number(s.targetAmount),
        collected: Number(s.currentAmount),
        progress: Math.min(100, Math.round((Number(s.currentAmount) / Number(s.targetAmount)) * 100)),
      })),
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

  // Delete transaction and safely revert wallet balance
  fastify.delete('/:id', async (request, reply) => {
    const { familyId } = (request as any).user;
    const { id } = request.params as any;

    const existing = await prisma.transaction.findFirst({
      where: { id, familyId },
    });

    if (!existing) {
      return reply.status(404).send({ error: 'Transaksi tidak ditemukan.' });
    }

    await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { id: existing.walletId } });
      if (wallet) {
        const bal = Number(wallet.balance);
        const amt = Number(existing.amount);
        // Revert: if it was EXPENSE, add back; if INCOME, deduct
        await tx.wallet.update({
          where: { id: existing.walletId },
          data: {
            balance: existing.type === TransactionType.EXPENSE ? bal + amt : bal - amt,
          },
        });
      }

      await tx.transaction.delete({ where: { id } });
    });

    return { success: true, message: 'Transaksi berhasil dihapus dan saldo dompet telah disesuaikan.' };
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

  // Respond to pending approval from app (Uses direct action ID!)
  fastify.post('/pending/:id/respond', async (request, reply) => {
    const { id } = request.params as any;
    const { approved } = request.body as any;

    try {
      const response = await ApprovalEngine.respondToPendingActionById(id, approved === true);
      return response;
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Gagal memproses persetujuan aksi.' });
    }
  });
}
