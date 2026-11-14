import cron from 'node-cron';
import { prisma } from '../db.js';
import { ActionType, TransactionType } from '@prisma/client';
import { ApprovalEngine } from './approval-engine.js';
import { BotGateway } from './bot-gateway.js';

export class SchedulerService {
  static init() {
    console.log('⏰ Inisialisasi Scheduler Keuangan Otomatis (Cron Engine)...');

    // 1. Cek Tagihan Rutin (Setiap Hari Pukul 07:00 Pagi)
    cron.schedule('0 7 * * *', async () => {
      await this.checkRecurringBills();
    });

    // 2. Alokasi Sinking Funds (Setiap Tanggal 1 Tiap Bulan Pukul 08:00 Pagi)
    cron.schedule('0 8 1 * *', async () => {
      await this.checkSinkingFunds();
    });

    // 3. Laporan Rekap Harian Otomatis (Setiap Malam Pukul 21:00)
    cron.schedule('0 21 * * *', async () => {
      await this.sendDailySummary();
    });
  }

  /**
   * Pengecekan Tagihan Rutin yang Jatuh Tempo Hari Ini
   */
  static async checkRecurringBills() {
    const today = new Date();
    const currentDay = today.getDate();

    const bills = await prisma.recurringBill.findMany({
      where: {
        isActive: true,
        dueDayOfMonth: currentDay,
      },
      include: {
        family: {
          include: {
            users: {
              where: { role: 'MANAGER' },
            },
          },
        },
      },
    });

    for (const bill of bills) {
      const manager = bill.family.users[0];
      if (!manager) continue;

      // Cek apakah sudah pernah dieksekusi hari ini
      if (bill.lastExecutedAt) {
        const last = new Date(bill.lastExecutedAt);
        if (last.toDateString() === today.toDateString()) continue;
      }

      const summaryText = `🔔 *Waktunya Bayar Tagihan Rutin!*\n• *Tagihan*: ${bill.name}\n• *Nominal*: Rp ${Number(bill.amount).toLocaleString('id-ID')}\n• *Jatuh Tempo*: Hari ini (Tgl ${currentDay})\n\n👉 *Balas "Ya" untuk menyetujui jurnal pembayaran ini.*`;

      await ApprovalEngine.createPendingAction(
        bill.familyId,
        manager.id,
        ActionType.EXECUTE_RECURRING_BILL,
        {
          billId: bill.id,
          name: bill.name,
          amount: Number(bill.amount),
          walletId: bill.walletId,
          categoryId: bill.categoryId,
        },
        summaryText
      );

      // Kirim pesan ke WhatsApp atau Telegram manager
      if (manager.whatsappJid) {
        await BotGateway.sendWhatsAppMessage(manager.whatsappJid, summaryText);
      }
      if (manager.telegramChatId) {
        await BotGateway.sendTelegramMessage(manager.telegramChatId, summaryText);
      }
    }
  }

  /**
   * Pengecekan Alokasi Sinking Funds Bulanan (Dana Siaga)
   */
  static async checkSinkingFunds() {
    const funds = await prisma.sinkingFund.findMany({
      where: { isActive: true },
      include: {
        family: {
          include: {
            users: {
              where: { role: 'MANAGER' },
            },
          },
        },
      },
    });

    for (const fund of funds) {
      const manager = fund.family.users[0];
      if (!manager) continue;

      const summaryText = `💰 *Alokasi Bulanan Sinking Fund:*\n• *Pos Dana*: ${fund.name}\n• *Nominal*: Rp ${Number(fund.monthlyAlloc).toLocaleString('id-ID')}\n• *Progress*: Rp ${Number(fund.currentAmount).toLocaleString('id-ID')} / Target Rp ${Number(fund.targetAmount).toLocaleString('id-ID')}\n\n👉 *Balas "Ya" untuk menyetujui pemindahan dana ini.*`;

      await ApprovalEngine.createPendingAction(
        fund.familyId,
        manager.id,
        ActionType.EXECUTE_SINKING_FUND,
        {
          fundId: fund.id,
          name: fund.name,
          amount: Number(fund.monthlyAlloc),
          sourceWalletId: fund.sourceWalletId,
        },
        summaryText
      );

      if (manager.whatsappJid) {
        await BotGateway.sendWhatsAppMessage(manager.whatsappJid, summaryText);
      }
      if (manager.telegramChatId) {
        await BotGateway.sendTelegramMessage(manager.telegramChatId, summaryText);
      }
    }
  }

  /**
   * Pengiriman Rekap Laporan Pengeluaran Harian Pukul 21:00
   */
  static async sendDailySummary() {
    const families = await prisma.family.findMany({
      include: {
        users: { where: { role: 'MANAGER' } },
      },
    });

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const family of families) {
      const manager = family.users[0];
      if (!manager) continue;

      const todayTransactions = await prisma.transaction.findMany({
        where: {
          familyId: family.id,
          transactionDate: { gte: startOfDay },
        },
        include: {
          category: true,
          wallet: true,
        },
      });

      if (todayTransactions.length === 0) continue;

      let totalExpense = 0;
      let totalIncome = 0;
      const details: string[] = [];

      for (const t of todayTransactions) {
        const amt = Number(t.amount);
        if (t.type === TransactionType.EXPENSE) {
          totalExpense += amt;
          details.push(`- ${t.description}: Rp ${amt.toLocaleString('id-ID')} (${t.wallet.name})`);
        } else if (t.type === TransactionType.INCOME) {
          totalIncome += amt;
        }
      }

      const message = `🌙 *Laporan Keuangan Harian (${now.toLocaleDateString('id-ID')})*\n\n📊 *Total Pengeluaran Hari Ini*: Rp ${totalExpense.toLocaleString('id-ID')}\n💵 *Total Pemasukan*: Rp ${totalIncome.toLocaleString('id-ID')}\n\n*Rincian Transaksi:*\n${details.slice(0, 8).join('\n')}\n\n_Tetap jaga kesehatan finansial keluarga bersama Ini Uangku! 🎀_`;

      if (manager.whatsappJid) {
        await BotGateway.sendWhatsAppMessage(manager.whatsappJid, message);
      }
      if (manager.telegramChatId) {
        await BotGateway.sendTelegramMessage(manager.telegramChatId, message);
      }
    }
  }
}
