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
      const { walletId, categoryId, amount, description, type, inputSource, rawMediaUrl, aiRawResponse, items } = payload;
      const numAmount = Number(amount);

      // JIKA PENGGUNA MERINCI BANYAK ITEM DENGAN HARGA MASING-MASING:
      // SIMPAN SATU-SATU KE JURNAL SEBAGAI TRANSAKSI TERPISAH
      if (Array.isArray(items) && items.length > 1) {
        const itemRows: Array<{ name: string; total: number }> = [];
        let totalCalculated = 0;

        await prisma.$transaction(async (tx) => {
          for (const item of items) {
            const itemPrice = Math.abs(Number(item.price) || 0);
            const itemQty = Number(item.qty) || 1;
            const itemTotal = itemPrice * itemQty;
            if (itemTotal <= 0) continue;

            totalCalculated += itemTotal;
            const itemDesc = item.name ? (itemQty > 1 ? `${item.name} (${itemQty}x)` : item.name) : description;

            await tx.transaction.create({
              data: {
                familyId: pending.familyId,
                walletId,
                categoryId: item.categoryId || categoryId || null,
                userId: pending.userId,
                type: type || TransactionType.EXPENSE,
                amount: itemTotal,
                description: itemDesc,
                inputSource: inputSource || InputSource.WHATSAPP_TEXT,
                rawMediaUrl: rawMediaUrl || null,
                aiRawResponse: aiRawResponse || null,
                pendingActionId: pending.id,
              },
            });

            itemRows.push({ name: itemDesc, total: itemTotal });
          }

          // Update Saldo Wallet dengan akumulasi total seluruh item
          const effectiveTotal = totalCalculated > 0 ? totalCalculated : numAmount;
          const wallet = await tx.wallet.findUnique({ where: { id: walletId } });
          if (wallet) {
            const currentBal = Number(wallet.balance);
            const newBal = (type === TransactionType.INCOME) ? currentBal + effectiveTotal : currentBal - effectiveTotal;
            await tx.wallet.update({
              where: { id: walletId },
              data: { balance: newBal },
            });
          }
        });

        if (categoryId && (type === TransactionType.EXPENSE || !type)) {
          budgetAlertMessage = await this.checkBudgetGuardrail(pending.familyId, categoryId);
        }

        const updatedWallet = await prisma.wallet.findUnique({ where: { id: walletId } });
        const formattedBalance = updatedWallet ? `Rp ${Number(updatedWallet.balance).toLocaleString('id-ID')}` : '';

        const lines = itemRows.map((it) => `• ${it.name}: Rp ${it.total.toLocaleString('id-ID')}`);
        successMessage =
          `✅ *Pencatatan Berhasil Disetujui!*\n` +
          `Telah dicatat ${itemRows.length} transaksi satu-per-satu ke jurnal:\n` +
          lines.slice(0, 10).join('\n') +
          (lines.length > 10 ? `\n...dan ${lines.length - 10} item lainnya` : '') +
          `\n\n• *Total*: Rp ${totalCalculated.toLocaleString('id-ID')}\n• *Dompet*: ${updatedWallet?.name || 'Utama'}\n• *Sisa Saldo*: ${formattedBalance}`;
      } else {
        // Single Item Transaction
        await prisma.$transaction(async (tx) => {
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

        if (categoryId && (type === TransactionType.EXPENSE || !type)) {
          budgetAlertMessage = await this.checkBudgetGuardrail(pending.familyId, categoryId);
        }

        const updatedWallet = await prisma.wallet.findUnique({ where: { id: walletId } });
        const formattedBalance = updatedWallet ? `Rp ${Number(updatedWallet.balance).toLocaleString('id-ID')}` : '';

        successMessage = `✅ *Pencatatan Berhasil Disetujui!*\n• Transaksi: ${description}\n• Nominal: Rp ${numAmount.toLocaleString('id-ID')}\n• Dompet: ${updatedWallet?.name || 'Utama'}\n• Sisa Saldo: ${formattedBalance}`;
      }
    } else if (pending.actionType === ActionType.CREATE_WALLET) {
      const { name, type = 'BANK', initialBalance = 0 } = payload;
      const newWallet = await prisma.wallet.create({
        data: {
          familyId: pending.familyId,
          userId: pending.userId,
          name: name.trim(),
          type: type || 'BANK',
          balance: Number(initialBalance) || 0,
          isShared: true,
        },
      });

      successMessage =
        `🎉 *Dompet Baru Berhasil Dibuat!*\n` +
        `• *Nama Dompet*: ${newWallet.name}\n` +
        `• *Tipe*: ${newWallet.type}\n` +
        `• *Saldo Awal*: Rp ${Number(newWallet.balance).toLocaleString('id-ID')}`;
    } else if (pending.actionType === ActionType.TRANSFER_WALLET) {
      const { sourceWalletId, targetWalletId, amount, description = 'Transfer Antar Dompet' } = payload;
      const numAmount = Math.abs(Number(amount));

      await prisma.$transaction(async (tx) => {
        const [src, tgt] = await Promise.all([
          tx.wallet.findUnique({ where: { id: sourceWalletId } }),
          tx.wallet.findUnique({ where: { id: targetWalletId } }),
        ]);

        if (!src || !tgt) throw new Error('Dompet asal atau tujuan tidak ditemukan.');

        await tx.wallet.update({
          where: { id: sourceWalletId },
          data: { balance: Number(src.balance) - numAmount },
        });

        await tx.wallet.update({
          where: { id: targetWalletId },
          data: { balance: Number(tgt.balance) + numAmount },
        });

        await tx.transaction.create({
          data: {
            familyId: pending.familyId,
            walletId: sourceWalletId,
            userId: pending.userId,
            type: TransactionType.TRANSFER,
            amount: numAmount,
            description: `${description}: Dari ${src.name} ke ${tgt.name}`,
            inputSource: payload.inputSource || InputSource.TELEGRAM_TEXT,
            pendingActionId: pending.id,
          },
        });
      });

      const [updatedSrc, updatedTgt] = await Promise.all([
        prisma.wallet.findUnique({ where: { id: sourceWalletId } }),
        prisma.wallet.findUnique({ where: { id: targetWalletId } }),
      ]);

      successMessage =
        `💸 *Transfer Antar Dompet Berhasil!*\n` +
        `• *Dari Dompet*: ${updatedSrc?.name} (Sisa: Rp ${Number(updatedSrc?.balance).toLocaleString('id-ID')})\n` +
        `• *Ke Dompet*: ${updatedTgt?.name} (Saldo: Rp ${Number(updatedTgt?.balance).toLocaleString('id-ID')})\n` +
        `• *Nominal*: Rp ${numAmount.toLocaleString('id-ID')}`;
    } else if (pending.actionType === ActionType.SET_BUDGET) {
      const { categoryId, categoryName, monthlyBudget, alertThreshold = 80 } = payload;
      let cat;
      if (categoryId) {
        cat = await prisma.category.update({
          where: { id: categoryId },
          data: {
            monthlyBudget: Number(monthlyBudget),
            alertThreshold: Number(alertThreshold) || 80,
          },
        });
      } else if (categoryName) {
        cat = await prisma.category.create({
          data: {
            familyId: pending.familyId,
            name: categoryName.trim(),
            icon: 'tag',
            color: '#C1ECFD',
            type: TransactionType.EXPENSE,
            monthlyBudget: Number(monthlyBudget),
            alertThreshold: Number(alertThreshold) || 80,
          },
        });
      }

      successMessage =
        `🎯 *Batas Anggaran (Budget) Berhasil Diatur!*\n` +
        `• *Kategori*: ${cat?.name}\n` +
        `• *Batas Bulanan*: Rp ${Number(cat?.monthlyBudget).toLocaleString('id-ID')}\n` +
        `• *Peringatan Otomatis*: Saat mencapai ${cat?.alertThreshold || 80}% kuota`;
    } else if (pending.actionType === ActionType.CREATE_SINKING_FUND) {
      const { name, targetAmount, monthlyAlloc = 0, sourceWalletId } = payload;
      const defaultWallet = await prisma.wallet.findFirst({ where: { familyId: pending.familyId } });

      const fund = await prisma.sinkingFund.create({
        data: {
          familyId: pending.familyId,
          name: name.trim(),
          targetAmount: Number(targetAmount),
          monthlyAlloc: Number(monthlyAlloc),
          sourceWalletId: sourceWalletId || defaultWallet?.id || '',
          isActive: true,
        },
      });

      successMessage =
        `🎯 *Pos Dana Siaga (Sinking Fund) Baru Berhasil Dibuat!*\n` +
        `• *Nama Pos*: ${fund.name}\n` +
        `• *Target Dana*: Rp ${Number(fund.targetAmount).toLocaleString('id-ID')}\n` +
        `• *Alokasi Tiap Bulan*: Rp ${Number(fund.monthlyAlloc).toLocaleString('id-ID')}`;
    } else if (pending.actionType === ActionType.CREATE_RECURRING_BILL) {
      const { name, amount, dueDayOfMonth = 1, walletId, categoryId } = payload;
      const defaultWallet = await prisma.wallet.findFirst({ where: { familyId: pending.familyId } });
      const defaultCat = await prisma.category.findFirst({ where: { familyId: pending.familyId } });

      const bill = await prisma.recurringBill.create({
        data: {
          familyId: pending.familyId,
          name: name.trim(),
          amount: Number(amount),
          dueDayOfMonth: Math.min(Math.max(Number(dueDayOfMonth) || 1, 1), 31),
          walletId: walletId || defaultWallet?.id || '',
          categoryId: categoryId || defaultCat?.id || '',
          isActive: true,
        },
      });

      successMessage =
        `📅 *Jadwal Tagihan Rutin Berhasil Disimpan!*\n` +
        `• *Tagihan*: ${bill.name}\n` +
        `• *Nominal*: Rp ${Number(bill.amount).toLocaleString('id-ID')}\n` +
        `• *Jatuh Tempo*: Tanggal ${bill.dueDayOfMonth} setiap bulan\n` +
        `• *Notifikasi Otomatis*: AI akan mengingatkan pukul 07:00 pagi setiap jatuh tempo`;
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
