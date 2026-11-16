import { prisma } from '../db.js';
import { ActionType, ActionStatus, TransactionType, InputSource, WalletType } from '@prisma/client';

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
   * Cek apakah user (atau keluarga, jika Manager) memiliki aksi pending
   */
  static async getActivePendingAction(userId: string, familyId?: string) {
    // 1. Cek aksi pending dari user itu sendiri terlebih dahulu
    const ownPending = await prisma.pendingAction.findFirst({
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
    if (ownPending) return ownPending;

    // 2. Jika user adalah MANAGER (Kepala Keluarga) dan familyId tersedia:
    // Izinkan Manager menyetujui atau menolak draf anggota keluarga lain via chat!
    if (familyId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (user?.role === 'MANAGER') {
        return prisma.pendingAction.findFirst({
          where: {
            familyId,
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
    }

    return null;
  }

  /**
   * Cek apakah teks input merupakan indikasi persetujuan (approval)
   */
  static isApprovalText(text: string): boolean {
    if (!text) return false;
    const clean = text.trim().toLowerCase().replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return false;

    // 1. Exact match kata atau frasa umum
    const exactMatches = new Set([
      'ya', 'iya', 'y', 'yes', 'ok', 'oke', 'siap', '1', 'benar', 'betul',
      'acc', 'lanjut', 'lanjutkan', 'setuju', 'setujui', 'simpan', 'approve',
      'eksekusi', 'gas', 'gaskan', 'deal', 'cocok', 'sudah sesuai', 'sudah benar',
      'masukkan aja', 'catat aja', 'simpan aja', 'eksekusi aja', 'acc aja', 'setujui aja',
      'setuju aja', 'iya setuju', 'iya setujui', 'ya setuju', 'ya setujui', 'oke setuju',
      'oke setujui', 'oke simpan', 'siap setujui', 'siap simpan', 'tolong simpan',
      'tolong setujui', 'ya simpan', 'ya simpan aja', 'ya setuju aja', 'ya setujui aja',
      'simpan ya', 'setujui ya', 'setuju ya'
    ]);
    if (exactMatches.has(clean)) return true;

    // 2. Frasa persetujuan yang diawali atau mengandung kombinasi kata kunci afirmasi
    const approvalRegex = /^(ya|iya|yes|y|ok|oke|siap|acc|benar|betul|lanjut|lanjutkan|setuju|setujui|simpan|approve|eksekusi|gas|gaskan)(\s+(ya|setuju|setujui|simpan|approve|eksekusi|acc|masukkan|catat|monee|kak|kakak|dong|deh|aja|saja|semua|draf|draft|transaksi|ini|itu|tersebut|min))+$/i;
    if (approvalRegex.test(clean)) return true;

    // 3. Frasa sopan: "tolong simpan ya monee", "tolong disetujui ya"
    const politeApprovalRegex = /^(tolong|mohon|silakan|silahkan)\s+(di)?(setujui|simpan|eksekusi|acc|masukkan|catat)(\s+(ya|monee|kak|kakak|dong|deh|aja|saja|draf|draft|transaksi|ini|itu))*$/i;
    if (politeApprovalRegex.test(clean)) return true;

    return false;
  }

  /**
   * Cek apakah teks input merupakan indikasi penolakan / pembatalan (rejection)
   */
  static isRejectionText(text: string): boolean {
    if (!text) return false;
    const clean = text.trim().toLowerCase().replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return false;

    // 1. Exact match kata atau frasa umum
    const exactMatches = new Set([
      'batal', 'tolak', 'tidak', 'ga jadi', 'gak jadi', 'nggak jadi', 'tidak jadi',
      'batalin', 'batalkan', 'cancel', 'no', 't', 'jangan', 'skip', '0', 'reject',
      'tolak saja', 'tolak draf', 'batal aja', 'batalin aja', 'batalkan draf',
      'hapus draf', 'jangan disimpan', 'jangan dicatat', 'ga usah', 'gak usah',
      'tolak ya', 'batal ya', 'batalkan ya'
    ]);
    if (exactMatches.has(clean)) return true;

    // 2. Frasa penolakan diawali kata tolak/batal
    const rejectionRegex = /^(batal|tolak|tidak|no|t|jangan|batalin|batalkan|skip|reject|cancel|hapus)(\s+(ya|monee|kak|kakak|dong|deh|aja|saja|draf|draft|transaksi|ini|itu|tersebut|min|disimpan|dicatat))+$/i;
    if (rejectionRegex.test(clean)) return true;

    // 3. Frasa "gak jadi / tidak jadi"
    const cancelRegex = /^(g[a|a]k?\s*jadi|ngg[a|a]k?\s*jadi|tidak\s*jadi|g[a|a]k?\s*usah|ngg[a|a]k?\s*usah)(\s+(deh|aja|saja|ya|monee|kak|kakak|beli|catat|simpan|draf|draft|transaksi|ini|itu))*$/i;
    if (cancelRegex.test(clean)) return true;

    // 4. Frasa sopan penolakan
    const politeRejectionRegex = /^(tolong|mohon)\s+(di)?(batal(kan|in)?|tolak|hapus)(\s+(ya|monee|kak|kakak|dong|deh|aja|saja|draf|draft|transaksi|ini|itu))*$/i;
    if (politeRejectionRegex.test(clean)) return true;

    return false;
  }

  /**
   * Proses respon dari user (Ya / Setuju / Tolak / Batal / Koreksi)
   */
  static async processResponse(
    userId: string,
    responseRaw: string,
    familyId?: string
  ): Promise<{ status: 'APPROVED' | 'REJECTED' | 'NEEDS_CORRECTION' | 'NO_PENDING'; message: string; alert?: string }> {
    const pending = await this.getActivePendingAction(userId, familyId);
    if (!pending) {
      return {
        status: 'NO_PENDING',
        message: 'Kakak tidak memiliki draf transaksi yang sedang menunggu persetujuan Monee saat ini. 🎀',
      };
    }

    const cleanText = responseRaw.trim().toLowerCase();
    const isApproval = this.isApprovalText(cleanText);
    const isRejection = this.isRejectionText(cleanText);

    if (isApproval) {
      const result = await this.executeAction(pending);
      const submitterInfo = pending.user?.name && pending.userId !== userId ? ` dari Kak ${pending.user.name}` : '';
      return {
        status: 'APPROVED',
        message: `${result.message}${submitterInfo ? `\n👤 *Diajukan oleh:* Kak ${pending.user?.name || ''}` : ''}`,
        alert: result.alert,
      };
    } else if (isRejection) {
      await prisma.pendingAction.update({
        where: { id: pending.id },
        data: { status: ActionStatus.REJECTED },
      });
      const payload = (pending.proposedPayload as any) || {};
      const desc = payload?.description || pending.summaryText || 'Transaksi';
      const submitter = pending.user?.name ? ` (diajukan oleh Kak ${pending.user.name})` : '';
      return {
        status: 'REJECTED',
        message: `❌ Siap Kak, draf "${desc}"${submitter} berhasil DITOLAK/DIBATALKAN dan tidak Monee catat ke pembukuan. 🎀`,
      };
    } else {
      // Input pengguna berupa teks kalimat atau koreksi -> akan dianalisa lebih lanjut oleh LLM
      return {
        status: 'NEEDS_CORRECTION',
        message: cleanText,
      };
    }
  }

  /**
   * Proses respon approval langsung berdasarkan ID pending action (misal dari aplikasi UI)
   */
  static async respondToPendingActionById(
    pendingId: string,
    approved: boolean
  ): Promise<{ status: 'APPROVED' | 'REJECTED'; message: string; alert?: string }> {
    const pending = await prisma.pendingAction.findUnique({
      where: { id: pendingId },
      include: { user: true, family: true },
    });

    if (!pending || pending.status !== ActionStatus.PENDING_APPROVAL) {
      throw new Error('Aksi persetujuan tidak ditemukan atau sudah kadaluarsa.');
    }

    if (approved) {
      const result = await this.executeAction(pending);
      const submitterInfo = pending.user?.name ? `\n👤 *Diajukan oleh:* Kak ${pending.user.name}` : '';
      return {
        status: 'APPROVED',
        message: `${result.message}${submitterInfo}`,
        alert: result.alert,
      };
    } else {
      await prisma.pendingAction.update({
        where: { id: pending.id },
        data: { status: ActionStatus.REJECTED },
      });
      const payload = (pending.proposedPayload as any) || {};
      const desc = payload?.description || pending.summaryText || 'Transaksi';
      const submitter = pending.user?.name ? ` (diajukan oleh Kak ${pending.user.name})` : '';
      return {
        status: 'REJECTED',
        message: `❌ Siap Kak, draf "${desc}"${submitter} berhasil DITOLAK/DIBATALKAN dan tidak Monee catat ke pembukuan. 🎀`,
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
                transactionDate: payload.transactionDate ? new Date(payload.transactionDate) : new Date(),
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
          `Monee sudah catat ${itemRows.length} transaksi satu-per-satu ke jurnal ya Kak:\n` +
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
              transactionDate: payload.transactionDate ? new Date(payload.transactionDate) : new Date(),
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

        successMessage = `✅ *Pencatatan Berhasil Disetujui!*\nMonee sudah catat ke jurnal ya Kak:\n• Transaksi: ${description}\n• Nominal: Rp ${numAmount.toLocaleString('id-ID')}\n• Dompet: ${updatedWallet?.name || 'Utama'}\n• Sisa Saldo: ${formattedBalance}`;
      }
    } else if (pending.actionType === ActionType.UPDATE_TRANSACTION) {
      const { targetTransactionId, targetDescription, newAmount, newDescription, newDate, newWalletId, newCategoryId } = payload;

      let txRecord = null;
      if (targetTransactionId) {
        txRecord = await prisma.transaction.findFirst({
          where: { id: targetTransactionId, familyId: pending.familyId },
          include: { wallet: true, category: true },
        });
      }
      if (!txRecord && targetDescription) {
        txRecord = await prisma.transaction.findFirst({
          where: {
            familyId: pending.familyId,
            description: { contains: targetDescription, mode: 'insensitive' },
          },
          orderBy: { transactionDate: 'desc' },
          include: { wallet: true, category: true },
        });
      }

      if (!txRecord) {
        throw new Error('Transaksi yang ingin diubah tidak ditemukan dalam database.');
      }

      const oldAmount = Number(txRecord.amount);
      const updatedAmount = newAmount !== undefined ? Math.abs(Number(newAmount)) : oldAmount;
      const updatedWalletId = newWalletId || txRecord.walletId;
      const updatedCategoryId = newCategoryId !== undefined ? newCategoryId : txRecord.categoryId;
      const updatedDesc = newDescription || txRecord.description;
      const updatedDate = newDate ? new Date(newDate) : txRecord.transactionDate;

      await prisma.$transaction(async (tx) => {
        // Revert wallet lama & apply ke wallet baru
        if (txRecord.type === TransactionType.EXPENSE) {
          await tx.wallet.update({
            where: { id: txRecord.walletId },
            data: { balance: { increment: oldAmount } },
          });
          await tx.wallet.update({
            where: { id: updatedWalletId },
            data: { balance: { decrement: updatedAmount } },
          });
        } else if (txRecord.type === TransactionType.INCOME) {
          await tx.wallet.update({
            where: { id: txRecord.walletId },
            data: { balance: { decrement: oldAmount } },
          });
          await tx.wallet.update({
            where: { id: updatedWalletId },
            data: { balance: { increment: updatedAmount } },
          });
        }

        await tx.transaction.update({
          where: { id: txRecord.id },
          data: {
            amount: updatedAmount,
            description: updatedDesc,
            walletId: updatedWalletId,
            categoryId: updatedCategoryId,
            transactionDate: updatedDate,
          },
        });
      });

      const walletUpdated = await prisma.wallet.findUnique({ where: { id: updatedWalletId } });
      const dateFormatted = updatedDate.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      successMessage =
        `✏️ *Transaksi Berhasil Diperbarui!*\n` +
        `Monee sudah perbarui datanya ya Kak:\n` +
        `• *Transaksi*: ${updatedDesc}\n` +
        `• *Nominal*: Rp ${updatedAmount.toLocaleString('id-ID')} (Sebelumnya: Rp ${oldAmount.toLocaleString('id-ID')})\n` +
        `• *Tanggal*: ${dateFormatted}\n` +
        `• *Dompet*: ${walletUpdated?.name || 'Utama'} (Saldo: Rp ${Number(walletUpdated?.balance || 0).toLocaleString('id-ID')})`;
    } else if (pending.actionType === ActionType.DELETE_TRANSACTION) {
      const { targetTransactionId, targetDescription } = payload;

      let txRecord = null;
      if (targetTransactionId) {
        txRecord = await prisma.transaction.findFirst({
          where: { id: targetTransactionId, familyId: pending.familyId },
          include: { wallet: true },
        });
      }
      if (!txRecord && targetDescription) {
        txRecord = await prisma.transaction.findFirst({
          where: {
            familyId: pending.familyId,
            description: { contains: targetDescription, mode: 'insensitive' },
          },
          orderBy: { transactionDate: 'desc' },
          include: { wallet: true },
        });
      }

      if (!txRecord) {
        throw new Error('Transaksi yang ingin dihapus tidak ditemukan dalam database.');
      }

      const txAmount = Number(txRecord.amount);

      await prisma.$transaction(async (tx) => {
        // Kembalikan saldo dompet
        if (txRecord.type === TransactionType.EXPENSE) {
          await tx.wallet.update({
            where: { id: txRecord.walletId },
            data: { balance: { increment: txAmount } },
          });
        } else if (txRecord.type === TransactionType.INCOME) {
          await tx.wallet.update({
            where: { id: txRecord.walletId },
            data: { balance: { decrement: txAmount } },
          });
        }

        await tx.transaction.delete({
          where: { id: txRecord.id },
        });
      });

      const walletRestored = await prisma.wallet.findUnique({ where: { id: txRecord.walletId } });

      successMessage =
        `🗑️ *Transaksi Berhasil Dihapus & Saldo Dipulihkan!*\n` +
        `Monee sudah hapus transaksi ini dari pembukuan Kakak:\n` +
        `• *Transaksi Dihapus*: ${txRecord.description}\n` +
        `• *Nominal*: Rp ${txAmount.toLocaleString('id-ID')}\n` +
        `• *Dompet*: ${walletRestored?.name} (Saldo Sekarang: Rp ${Number(walletRestored?.balance || 0).toLocaleString('id-ID')})`;
    } else if (pending.actionType === ActionType.CREATE_WALLET) {
      const walletsToAdd: Array<{ name: string; type?: WalletType; initialBalance?: number }> = [];
      if (Array.isArray(payload.wallets) && payload.wallets.length > 0) {
        walletsToAdd.push(...payload.wallets);
      } else if (payload.name) {
        walletsToAdd.push({
          name: payload.name,
          type: payload.type || 'BANK',
          initialBalance: payload.initialBalance || 0,
        });
      }

      const createdWallets: any[] = [];
      for (const w of walletsToAdd) {
        if (!w.name || !w.name.trim()) continue;
        const trimmed = w.name.trim();
        const typeStr = (w.type as WalletType) || (trimmed.toLowerCase().startsWith('kas') ? WalletType.CASH : WalletType.BANK);
        const newWallet = await prisma.wallet.create({
          data: {
            familyId: pending.familyId,
            userId: pending.userId,
            name: trimmed,
            type: typeStr,
            balance: Number(w.initialBalance) || 0,
            isShared: true,
          },
        });
        createdWallets.push(newWallet);
      }

      // Juga dukung pembuatan kategori jika disertakan dalam batch
      const categoriesToAdd: Array<{ name: string; type?: TransactionType; monthlyBudget?: number }> = [];
      if (Array.isArray(payload.categories) && payload.categories.length > 0) {
        categoriesToAdd.push(...payload.categories);
      }

      const createdCategories: any[] = [];
      for (const c of categoriesToAdd) {
        if (!c.name || !c.name.trim()) continue;
        const trimmed = c.name.trim();
        const existing = await prisma.category.findFirst({
          where: { familyId: pending.familyId, name: { equals: trimmed, mode: 'insensitive' } },
        });
        if (!existing) {
          const newCat = await prisma.category.create({
            data: {
              familyId: pending.familyId,
              name: trimmed,
              type: c.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
              monthlyBudget: c.monthlyBudget ? Number(c.monthlyBudget) : null,
              icon: 'tag',
              color: '#FFC1B6',
            },
          });
          createdCategories.push(newCat);
        } else {
          createdCategories.push(existing);
        }
      }

      if (createdWallets.length > 1 || createdCategories.length > 0) {
        successMessage = `🎉 *Berhasil Menambahkan Pos Keuangan Baru!*\n`;
        if (createdWallets.length > 0) {
          successMessage += `\n💳 *${createdWallets.length} Dompet Baru Berhasil Didaftarkan:*\n`;
          createdWallets.forEach((w, i) => {
            successMessage += `${i + 1}. *${w.name}* (${w.type} - Saldo: Rp ${Number(w.balance).toLocaleString('id-ID')})\n`;
          });
        }
        if (createdCategories.length > 0) {
          successMessage += `\n🏷️ *${createdCategories.length} Kategori Berhasil Ditambahkan:*\n`;
          createdCategories.forEach((c, i) => {
            successMessage += `${i + 1}. *${c.name}* (${c.type === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'}${c.monthlyBudget ? ` - Plafon: Rp ${Number(c.monthlyBudget).toLocaleString('id-ID')}` : ''})\n`;
          });
        }
        successMessage += `\nMonee siap bantu pantau alokasi keuangan keluarga ya Kak! 🥰`;
      } else {
        const singleW = createdWallets[0];
        successMessage =
          `🎉 *Dompet Baru Berhasil Dibuat!*\n` +
          `Monee sudah daftarkan dompet baru keluarga Kakak:\n` +
          `• *Nama Dompet*: ${singleW?.name}\n` +
          `• *Tipe*: ${singleW?.type}\n` +
          `• *Saldo Awal*: Rp ${Number(singleW?.balance || 0).toLocaleString('id-ID')}`;
      }
    } else if (pending.actionType === ActionType.UPDATE_WALLET) {
      const { walletId, newName, newType } = payload;
      const target = await prisma.wallet.findFirst({
        where: { id: walletId, familyId: pending.familyId },
      });
      if (!target) throw new Error('Dompet tidak ditemukan.');

      const oldName = target.name;
      const updated = await prisma.wallet.update({
        where: { id: target.id },
        data: {
          ...(newName ? { name: newName.trim() } : {}),
          ...(newType ? { type: newType } : {}),
        },
      });

      successMessage =
        `✏️ *Nama Dompet Berhasil Diperbarui!*\n` +
        `• Dari: *${oldName}*\n` +
        `• Menjadi: *${updated.name}*` +
        (newType ? `\n• Tipe: ${updated.type}` : '');
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
        `Monee sudah sesuaikan saldo dompet Kakak:\n` +
        `• *Dari Dompet*: ${updatedSrc?.name} (Sisa: Rp ${Number(updatedSrc?.balance).toLocaleString('id-ID')})\n` +
        `• *Ke Dompet*: ${updatedTgt?.name} (Saldo: Rp ${Number(updatedTgt?.balance).toLocaleString('id-ID')})\n` +
        `• *Nominal*: Rp ${numAmount.toLocaleString('id-ID')}`;
    } else if (pending.actionType === ActionType.SET_BUDGET) {
      const categoriesToAdd: Array<{ name?: string; type?: TransactionType; monthlyBudget?: number; categoryId?: string }> = [];
      if (Array.isArray(payload.categories) && payload.categories.length > 0) {
        categoriesToAdd.push(...payload.categories);
      } else if (payload.categoryId || payload.categoryName) {
        categoriesToAdd.push({
          categoryId: payload.categoryId,
          name: payload.categoryName,
          monthlyBudget: payload.monthlyBudget,
        });
      }

      const processedCats: any[] = [];
      for (const c of categoriesToAdd) {
        if (c.categoryId) {
          const updated = await prisma.category.update({
            where: { id: c.categoryId },
            data: {
              monthlyBudget: Number(c.monthlyBudget) || 0,
              alertThreshold: Number(payload.alertThreshold) || 80,
            },
          });
          processedCats.push(updated);
        } else if (c.name && c.name.trim()) {
          const trimmed = c.name.trim();
          const existing = await prisma.category.findFirst({
            where: { familyId: pending.familyId, name: { equals: trimmed, mode: 'insensitive' } },
          });
          if (existing) {
            const updated = await prisma.category.update({
              where: { id: existing.id },
              data: {
                monthlyBudget: c.monthlyBudget !== undefined && c.monthlyBudget !== null ? Number(c.monthlyBudget) : existing.monthlyBudget,
              },
            });
            processedCats.push(updated);
          } else {
            const created = await prisma.category.create({
              data: {
                familyId: pending.familyId,
                name: trimmed,
                icon: 'tag',
                color: '#C1ECFD',
                type: c.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
                monthlyBudget: c.monthlyBudget ? Number(c.monthlyBudget) : null,
                alertThreshold: Number(payload.alertThreshold) || 80,
              },
            });
            processedCats.push(created);
          }
        }
      }

      // Juga dukung pembuatan dompet jika ada dalam batch
      const walletsToAdd: Array<{ name: string; type?: WalletType; initialBalance?: number }> = [];
      if (Array.isArray(payload.wallets) && payload.wallets.length > 0) {
        walletsToAdd.push(...payload.wallets);
      }
      const createdWallets: any[] = [];
      for (const w of walletsToAdd) {
        if (!w.name || !w.name.trim()) continue;
        const trimmed = w.name.trim();
        const typeStr = (w.type as WalletType) || (trimmed.toLowerCase().startsWith('kas') ? WalletType.CASH : WalletType.BANK);
        const newWallet = await prisma.wallet.create({
          data: {
            familyId: pending.familyId,
            userId: pending.userId,
            name: trimmed,
            type: typeStr,
            balance: Number(w.initialBalance) || 0,
            isShared: true,
          },
        });
        createdWallets.push(newWallet);
      }

      if (processedCats.length > 1 || createdWallets.length > 0) {
        successMessage = `🎉 *Berhasil Menambahkan Pos Keuangan Baru!*\n`;
        if (processedCats.length > 0) {
          successMessage += `\n🏷️ *${processedCats.length} Kategori Berhasil Didaftarkan:*\n`;
          processedCats.forEach((c, i) => {
            successMessage += `${i + 1}. *${c.name}* (${c.type === 'INCOME' ? 'Pemasukan' : 'Pengeluaran'}${c.monthlyBudget ? ` - Plafon: Rp ${Number(c.monthlyBudget).toLocaleString('id-ID')}` : ''})\n`;
          });
        }
        if (createdWallets.length > 0) {
          successMessage += `\n💳 *${createdWallets.length} Dompet Baru Berhasil Didaftarkan:*\n`;
          createdWallets.forEach((w, i) => {
            successMessage += `${i + 1}. *${w.name}* (${w.type} - Saldo: Rp ${Number(w.balance).toLocaleString('id-ID')})\n`;
          });
        }
        successMessage += `\nMonee siap bantu pantau alokasi keuangan keluarga ya Kak! 🥰`;
      } else {
        const cat = processedCats[0];
        successMessage =
          `🎯 *Batas Anggaran (Budget) Berhasil Diatur!*\n` +
          `Monee siap bantu pantau kuota anggaran ini ya Kak:\n` +
          `• *Kategori*: ${cat?.name}\n` +
          `• *Batas Bulanan*: Rp ${Number(cat?.monthlyBudget || 0).toLocaleString('id-ID')}\n` +
          `• *Peringatan Otomatis*: Saat mencapai ${cat?.alertThreshold || 80}% kuota`;
      }
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
        `Monee sudah aktifkan pos tabungan ini untuk keluarga Kakak:\n` +
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
        `Monee akan otomatis mengingatkan Kakak saat jatuh tempo tiba:\n` +
        `• *Tagihan*: ${bill.name}\n` +
        `• *Nominal*: Rp ${Number(bill.amount).toLocaleString('id-ID')}\n` +
        `• *Jatuh Tempo*: Tanggal ${bill.dueDayOfMonth} setiap bulan\n` +
        `• *Notifikasi Otomatis*: Pukul 07:00 pagi setiap jatuh tempo`;
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
    } else if (pending.actionType === ActionType.SET_DEFAULT_WALLET) {
      const { targetWalletId, walletName } = payload;
      if (!targetWalletId) throw new Error('Target dompet tidak valid');

      await prisma.$transaction(async (tx) => {
        await tx.wallet.updateMany({
          where: { familyId: pending.familyId },
          data: { isDefaultExpense: false },
        });

        await tx.wallet.update({
          where: { id: targetWalletId },
          data: { isDefaultExpense: true },
        });
      });

      successMessage = `⭐ *Dompet Default Pengeluaran Berhasil Diatur!*\n• Dompet Utama: *${walletName || 'Dompet'}*\n\nMulai sekarang, setiap transaksi pengeluaran baru yang tidak menyebutkan nama dompet akan otomatis dialokasikan ke *${walletName || 'dompet ini'}*! 🎀✨`;
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
      return `⚠️ *PERINGATAN ANGGARAN DARI MONEE (GUARDRAIL ${thresholdPct}%)*\nPengeluaran keluarga Kakak untuk kategori *[${category.name}]* sudah mencapai *${usagePct}%* dari plafon anggaran bulanan nih Kak.\n• Terpakai: Rp ${totalSpent.toLocaleString('id-ID')} / Rp ${monthlyBudget.toLocaleString('id-ID')}\n• Sisa Kuota: Rp ${remaining.toLocaleString('id-ID')}\n_Yuk lebih hemat lagi untuk pos ini ya Kak! 🎀_`;
    }

    return undefined;
  }
}
