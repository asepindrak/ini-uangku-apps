import { prisma } from '../db.js';
import { ActionType, ActionStatus, TransactionType, InputSource } from '@prisma/client';

export interface ProposedTransactionPayload {
  walletId: string;
  categoryId?: string | null;
  amount: number;
  description: string;
  type?: TransactionType;
  inputSource?: InputSource;
  rawMediaUrl?: string | null;
  aiRawResponse?: any;
  items?: Array<{ name: string; price: number; qty?: number }>;
}

export class ApprovalEngine {
  /**
   * Buat Draf Aksi (PendingAction) yang menunggu persetujuan eksplisit user
   */
  static async createPendingAction(
    familyId: string,
    userId: string,
    actionType: ActionType,
    payload: any,
    summaryText: string
  ) {
    // Batalkan action pending sebelumnya dari user yang sama agar tidak tumpang tindih
    await prisma.pendingAction.updateMany({
      where: {
        userId,
        status: ActionStatus.PENDING_APPROVAL,
      },
      data: {
        status: ActionStatus.EXPIRED,
      },
    });

    // Buat pending action baru dengan batas waktu 24 jam
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const pending = await prisma.pendingAction.create({
      data: {
        familyId,
        userId,
        actionType,
        status: ActionStatus.PENDING_APPROVAL,
        proposedPayload: payload,
        summaryText,
        expiresAt,
      },
      include: {
        user: true,
      },
    });

    return pending;
  }

  /**
   * Cek apakah user memiliki aksi pending
   */
  static async getActivePendingAction(userId: string) {
    return prisma.pendingAction.findFirst({
      where: {
        userId,
        status: ActionStatus.PENDING_APPROVAL,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * Proses respon dari user (Ya / Setuju / Batal / Koreksi)
   */
  static async processResponse(
    userId: string,
    responseRaw: string
  ): Promise<{ status: 'APPROVED' | 'REJECTED' | 'NEEDS_CORRECTION' | 'NO_PENDING'; message: string; alert?: string }> {
    const pending = await this.getActivePendingAction(userId);
    if (!pending) {
      return {
        status: 'NO_PENDING',
        message: 'Tidak ada draf transaksi yang sedang menunggu persetujuan Anda saat ini.',
      };
    }

    const cleanText = responseRaw.trim().toLowerCase();
    const isApproval = ['ya', 'setuju', 'oke', 'ok', 'yes', 'siap', '1', 'y', 'benar', 'betul', 'acc', 'lanjutkan'].includes(cleanText);
    const isRejection = ['batal', 'tidak', 'ga jadi', 'batalin', 'cancel', 'no', 'jangan', 'skip', '0'].includes(cleanText);

    if (isApproval) {
      const result = await this.executeAction(pending);
      return {
        status: 'APPROVED',
        message: result.message,
        alert: result.alert,
      };
    } else if (isRejection) {
      await prisma.pendingAction.update({
        where: { id: pending.id },
        data: { status: ActionStatus.REJECTED },
      });
      return {
        status: 'REJECTED',
        message: '❌ Transaksi berhasil dibatalkan dan tidak dicatat ke pembukuan.',
      };
    } else {
      // Input pengguna berupa koreksi teks
      return {
        status: 'NEEDS_CORRECTION',
        message: cleanText,
      };
    }
  }

  /**
   * Eksekusi mutasi ke database setelah disetujui user
   */
  private static async executeAction(pending: any): Promise<{ message: string; alert?: string }> {
    const payload = pending.proposedPayload as any;
    let successMessage = '';
    let budgetAlertMessage: string | undefined = undefined;

    if (pending.actionType === ActionType.CREATE_TRANSACTION) {
      const { walletId, categoryId, amount, description, type, inputSource, rawMediaUrl, aiRawResponse } = payload;
      const numAmount = Number(amount);

      // Jalankan Prisma Interactive Transaction
      await prisma.$transaction(async (tx) => {
        // 1. Simpan Transaksi
        await tx.transaction.create({
          data: {
            familyId: pending.familyId,
            walletId,
            categoryId: categoryId || null,
            userId: pending.userId,
            type: type || TransactionType.EXPENSE,
            amount: numAmount,
            description,
            inputSource: inputSource || InputSource.WHATSAPP_TEXT,
            rawMediaUrl: rawMediaUrl || null,
            aiRawResponse: aiRawResponse || null,
            pendingActionId: pending.id,
          },
        });

        // 2. Update Saldo Wallet
        const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
        if (wallet) {
          const currentBal = Number(wallet.balance);
          const newBal = (type === TransactionType.INCOME) ? currentBal + numAmount : currentBal - numAmount;
          await tx.wallet.update({
            where: { id: walletId },
            data: { balance: newBal },
          });
        }
      });

      // 3. Cek Budget Guardrails jika pengeluaran berkategori
      if (categoryId && (payload.type === TransactionType.EXPENSE || !payload.type)) {
        budgetAlertMessage = await this.checkBudgetGuardrail(pending.familyId, categoryId);
      }

      // Ambil saldo dompet terbaru untuk ditampilkan
      const updatedWallet = await prisma.wallet.findUnique({ where: { id: walletId } });
      const formattedBalance = updatedWallet ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(updatedWallet.balance)) : '';

      successMessage = `✅ *Pencatatan Berhasil Disetujui!*\n• Transaksi: ${description}\n• Nominal: ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(numAmount)}\n• Dompet: ${updatedWallet?.name || 'Utama'}\n• Sisa Saldo: ${formattedBalance}`;
    } else if (pending.actionType === ActionType.EXECUTE_RECURRING_BILL) {
      const { billId, walletId, categoryId, amount, name } = payload;
      const numAmount = Number(amount);

      await prisma.$transaction(async (tx) => {
        await tx.transaction.create({
          data: {
            familyId: pending.familyId,
            walletId,
            categoryId,
            userId: pending.userId,
            type: TransactionType.EXPENSE,
            amount: numAmount,
            description: `Tagihan Rutin: ${name}`,
            inputSource: InputSource.AUTO_RECURRING,
            pendingActionId: pending.id,
          },
        });

        const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
        if (wallet) {
          await tx.wallet.update({
            where: { id: walletId },
            data: { balance: Number(wallet.balance) - numAmount },
          });
        }

        await tx.recurringBill.update({
          where: { id: billId },
          data: { lastExecutedAt: new Date() },
        });
      });

      successMessage = `✅ *Tagihan Rutin Disetujui!*\n• ${name} sebesar Rp ${numAmount.toLocaleString('id-ID')} telah dibukukan.`;
    } else if (pending.actionType === ActionType.EXECUTE_SINKING_FUND) {
      const { fundId, sourceWalletId, amount, name } = payload;
      const numAmount = Number(amount);

      await prisma.$transaction(async (tx) => {
        await tx.transaction.create({
          data: {
            familyId: pending.familyId,
            walletId: sourceWalletId,
            userId: pending.userId,
            type: TransactionType.SINKING_FUND_ALLOCATION,
            amount: numAmount,
            description: `Alokasi Sinking Fund: ${name}`,
            inputSource: InputSource.AUTO_SINKING_FUND,
            pendingActionId: pending.id,
          },
        });

        // Potong dompet operasional
        const wallet = await tx.wallet.findUnique({ where: { id: sourceWalletId } });
        if (wallet) {
          await tx.wallet.update({
            where: { id: sourceWalletId },
            data: { balance: Number(wallet.balance) - numAmount },
          });
        }

        // Tambah saldo terkumpul di Sinking Fund
        const fund = await tx.sinkingFund.findUnique({ where: { id: fundId } });
        if (fund) {
          await tx.sinkingFund.update({
            where: { id: fundId },
            data: {
              currentAmount: Number(fund.currentAmount) + numAmount,
              lastAllocatedAt: new Date(),
            },
          });
        }
      });

      const updatedFund = await prisma.sinkingFund.findUnique({ where: { id: fundId } });
      successMessage = `💰 *Alokasi Dana Siaga Berhasil!*\n• Pos: ${name}\n• Nominal: Rp ${numAmount.toLocaleString('id-ID')}\n• Total Terkumpul: Rp ${Number(updatedFund?.currentAmount || 0).toLocaleString('id-ID')} / Target Rp ${Number(updatedFund?.targetAmount || 0).toLocaleString('id-ID')}`;
    }

    // Tandai action menjadi APPROVED
    await prisma.pendingAction.update({
      where: { id: pending.id },
      data: { status: ActionStatus.APPROVED },
    });

    return { message: successMessage, alert: budgetAlertMessage };
  }

  /**
   * Cek apakah kategori pengeluaran sudah menyentuh 80% kuota anggaran
   */
  private static async checkBudgetGuardrail(familyId: string, categoryId: string): Promise<string | undefined> {
    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category || !category.monthlyBudget || Number(category.monthlyBudget) <= 0) return undefined;

    const monthlyBudget = Number(category.monthlyBudget);
    const thresholdPct = category.alertThreshold || 80;

    // Hitung total pengeluaran kategori ini di bulan berjalan
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const agg = await prisma.transaction.aggregate({
      where: {
        familyId,
        categoryId,
        type: TransactionType.EXPENSE,
        transactionDate: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });

    const totalSpent = Number(agg._sum.amount || 0);
    const usagePct = Math.round((totalSpent / monthlyBudget) * 100);

    if (usagePct >= thresholdPct && !category.isAlertSent) {
      // Tandai agar tidak mengirim peringatan berkali-kali di bulan yang sama
      await prisma.category.update({
        where: { id: categoryId },
        data: { isAlertSent: true },
      });

      const remaining = Math.max(0, monthlyBudget - totalSpent);
      return `⚠️ *PERINGATAN ANGGARAN KELUARGA (GUARDRAIL ${thresholdPct}%)*\nPengeluaran untuk kategori *[${category.name}]* telah mencapai *${usagePct}%* dari plafon anggaran bulanan.\n• Terpakai: Rp ${totalSpent.toLocaleString('id-ID')} / Rp ${monthlyBudget.toLocaleString('id-ID')}\n• Sisa Kuota: Rp ${remaining.toLocaleString('id-ID')}`;
    }

    return undefined;
  }
}
