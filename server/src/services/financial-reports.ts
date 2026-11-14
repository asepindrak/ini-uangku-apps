import { prisma } from '../db.js';
import { TransactionType } from '@prisma/client';
import { TimezoneService } from './timezone-service.js';

export class FinancialReportsService {
  /**
   * Laporan Saldo Seluruh Dompet Keluarga
   */
  static async getSaldoReport(familyId: string): Promise<string> {
    const wallets = await prisma.wallet.findMany({
      where: { familyId },
      orderBy: { balance: 'desc' },
    });

    if (wallets.length === 0) {
      return '💳 Belum ada dompet yang terdaftar di keluarga Anda.';
    }

    let totalLiquid = 0;
    const lines: string[] = [];

    for (const w of wallets) {
      const bal = Number(w.balance);
      totalLiquid += bal;
      const typeIcon = w.type === 'BANK' ? '🏦' : w.type === 'E_WALLET' ? '📱' : w.type === 'CASH' ? '💵' : '📈';
      lines.push(`${typeIcon} *${w.name}*: Rp ${bal.toLocaleString('id-ID')}`);
    }

    return (
      `💳 *Laporan Saldo Dompet Keluarga*\n\n` +
      lines.join('\n') +
      `\n\n━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *Total Saldo Kas/Bank*: Rp ${totalLiquid.toLocaleString('id-ID')}`
    );
  }

  /**
   * Laporan Pengeluaran & Pemasukan Hari Ini
   */
  static async getHariIniReport(familyId: string): Promise<string> {
    const tz = await TimezoneService.getFamilyTimezone(familyId);
    const bounds = TimezoneService.getTimezoneBounds(tz);

    const transactions = await prisma.transaction.findMany({
      where: {
        familyId,
        transactionDate: { gte: bounds.startOfToday },
      },
      include: {
        wallet: true,
        category: true,
      },
      orderBy: { transactionDate: 'desc' },
    });

    const todayDateLabel = TimezoneService.formatDate(new Date(), tz, { dateStyle: 'full' });

    if (transactions.length === 0) {
      return `☀️ *Laporan Hari Ini (${todayDateLabel})*\n\nBelum ada pengeluaran atau pemasukan yang dicatat hari ini.`;
    }

    let totalExpense = 0;
    let totalIncome = 0;
    const lines: string[] = [];

    for (const t of transactions) {
      const amt = Number(t.amount);
      const timeStr = TimezoneService.formatTime(t.transactionDate, tz);
      if (t.type === TransactionType.EXPENSE) {
        totalExpense += amt;
        lines.push(`• [${timeStr}] *${t.description}*: -Rp ${amt.toLocaleString('id-ID')} (${t.wallet.name})`);
      } else if (t.type === TransactionType.INCOME) {
        totalIncome += amt;
        lines.push(`• [${timeStr}] *${t.description}*: +Rp ${amt.toLocaleString('id-ID')} (${t.wallet.name})`);
      }
    }

    return (
      `☀️ *Laporan Hari Ini (${todayDateLabel})*\n\n` +
      lines.join('\n') +
      `\n\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔴 *Total Pengeluaran*: Rp ${totalExpense.toLocaleString('id-ID')}\n` +
      `🟢 *Total Pemasukan*: Rp ${totalIncome.toLocaleString('id-ID')}`
    );
  }

  /**
   * Laporan Pengeluaran Kemarin
   */
  static async getKemarinReport(familyId: string): Promise<string> {
    const tz = await TimezoneService.getFamilyTimezone(familyId);
    const bounds = TimezoneService.getTimezoneBounds(tz);

    const transactions = await prisma.transaction.findMany({
      where: {
        familyId,
        transactionDate: {
          gte: bounds.startOfYesterday,
          lt: bounds.startOfToday,
        },
      },
      include: {
        wallet: true,
        category: true,
      },
      orderBy: { transactionDate: 'desc' },
    });

    const yesterdayLabel = TimezoneService.formatDate(bounds.startOfYesterday, tz, { dateStyle: 'full' });

    if (transactions.length === 0) {
      return `📅 *Laporan Kemarin (${yesterdayLabel})*\n\nTidak ada catatan transaksi kemarin.`;
    }

    let totalExpense = 0;
    let totalIncome = 0;
    const lines: string[] = [];

    for (const t of transactions) {
      const amt = Number(t.amount);
      const timeStr = TimezoneService.formatTime(t.transactionDate, tz);
      if (t.type === TransactionType.EXPENSE) {
        totalExpense += amt;
        lines.push(`• [${timeStr}] *${t.description}*: -Rp ${amt.toLocaleString('id-ID')} (${t.wallet.name})`);
      } else if (t.type === TransactionType.INCOME) {
        totalIncome += amt;
        lines.push(`• [${timeStr}] *${t.description}*: +Rp ${amt.toLocaleString('id-ID')} (${t.wallet.name})`);
      }
    }

    return (
      `📅 *Laporan Kemarin (${yesterdayLabel})*\n\n` +
      lines.join('\n') +
      `\n\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🔴 *Total Pengeluaran Kemarin*: Rp ${totalExpense.toLocaleString('id-ID')}\n` +
      `🟢 *Total Pemasukan*: Rp ${totalIncome.toLocaleString('id-ID')}`
    );
  }

  /**
   * Laporan Bulan Berjalan
   */
  static async getBulanIniReport(familyId: string): Promise<string> {
    const tz = await TimezoneService.getFamilyTimezone(familyId);
    const bounds = TimezoneService.getTimezoneBounds(tz);

    const [grouped, categories] = await Promise.all([
      prisma.transaction.groupBy({
        by: ['type'],
        where: {
          familyId,
          transactionDate: { gte: bounds.startOfThisMonth },
        },
        _sum: { amount: true },
      }),
      prisma.category.findMany({
        where: { familyId, monthlyBudget: { not: null } },
      }),
    ]);

    let totalExpense = 0;
    let totalIncome = 0;
    for (const g of grouped) {
      const sum = Number(g._sum.amount) || 0;
      if (g.type === TransactionType.EXPENSE) totalExpense += sum;
      if (g.type === TransactionType.INCOME) totalIncome += sum;
    }

    const monthName = TimezoneService.formatDate(new Date(), tz, { month: 'long', year: 'numeric' });
    const net = totalIncome - totalExpense;

    let budgetLines: string[] = [];
    if (categories.length > 0) {
      for (const cat of categories) {
        const catSpentAgg = await prisma.transaction.aggregate({
          where: {
            familyId,
            categoryId: cat.id,
            type: TransactionType.EXPENSE,
            transactionDate: { gte: bounds.startOfThisMonth },
          },
          _sum: { amount: true },
        });

        const spent = Number(catSpentAgg._sum.amount) || 0;
        const budget = Number(cat.monthlyBudget) || 1;
        const pct = Math.min(Math.round((spent / budget) * 100), 999);
        const icon = pct >= 80 ? '⚠️' : '✅';

        budgetLines.push(`  ${icon} *${cat.name}*: Rp ${spent.toLocaleString('id-ID')} / Rp ${budget.toLocaleString('id-ID')} (${pct}%)`);
      }
    }

    return (
      `📊 *Rekap Finansial Bulan Ini (${monthName})*\n\n` +
      `🟢 *Pemasukan*: Rp ${totalIncome.toLocaleString('id-ID')}\n` +
      `🔴 *Pengeluaran*: Rp ${totalExpense.toLocaleString('id-ID')}\n` +
      `💵 *Arus Kas Bersih (Net)*: Rp ${net.toLocaleString('id-ID')}\n\n` +
      (budgetLines.length > 0
        ? `*Status Anggaran (Budget Guardrails):*\n${budgetLines.join('\n')}\n\n`
        : '') +
      `_Tetap jaga disiplin finansial keluarga bersama Ini Uangku! 🎀_`
    );
  }

  /**
   * Laporan Sinking Funds (Dana Siaga)
   */
  static async getSinkingFundReport(familyId: string): Promise<string> {
    const funds = await prisma.sinkingFund.findMany({
      where: { familyId, isActive: true },
      orderBy: { currentAmount: 'desc' },
    });

    if (funds.length === 0) {
      return '🎯 Belum ada Pos Dana Siaga (Sinking Fund) aktif di keluarga Anda.';
    }

    const lines: string[] = [];
    for (const f of funds) {
      const cur = Number(f.currentAmount);
      const tgt = Number(f.targetAmount);
      const alloc = Number(f.monthlyAlloc);
      const pct = Math.min(Math.round((cur / tgt) * 100), 100);

      // Simple visual progress bar [████░░░░]
      const filled = Math.round(pct / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      lines.push(
        `🎯 *${f.name}*\n` +
        `  Progress: [${bar}] ${pct}%\n` +
        `  Terkumpul: Rp ${cur.toLocaleString('id-ID')} / Target Rp ${tgt.toLocaleString('id-ID')}\n` +
        `  Alokasi Bulanan: Rp ${alloc.toLocaleString('id-ID')}/bln`
      );
    }

    return (
      `🎯 *Pos Dana Siaga & Tabungan Target (Sinking Funds)*\n\n` +
      lines.join('\n\n')
    );
  }

  /**
   * Laporan Tagihan Rutin Bulanan
   */
  static async getTagihanReport(familyId: string): Promise<string> {
    const bills = await prisma.recurringBill.findMany({
      where: { familyId, isActive: true },
      orderBy: { dueDayOfMonth: 'asc' },
    });

    if (bills.length === 0) {
      return '📅 Belum ada jadwal tagihan rutin bulanan di keluarga Anda.';
    }

    let totalBills = 0;
    const lines: string[] = [];

    for (const b of bills) {
      const amt = Number(b.amount);
      totalBills += amt;
      lines.push(`• *${b.name}*: Rp ${amt.toLocaleString('id-ID')} (Tiap Tgl ${b.dueDayOfMonth})`);
    }

    return (
      `📅 *Jadwal Tagihan Rutin Bulanan*\n\n` +
      lines.join('\n') +
      `\n\n━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *Total Beban Rutin*: Rp ${totalBills.toLocaleString('id-ID')}/bulan\n` +
      `_Bot akan otomatis mengingatkan konfirmasi pada tgl jatuh tempo pukul 07:00 pagi._`
    );
  }

  /**
   * Pesan Bantuan & Panduan Lengkap
   */
  static getHelpMessage(botUsername?: string): string {
    return (
      `🎀 *Panduan Asisten Finansial Ini Uangku*\n\n` +
      `*Perintah Cepat (Command):*\n` +
      `• /saldo - Cek saldo seluruh dompet kas & bank\n` +
      `• /hariini - Rekap transaksi hari ini\n` +
      `• /kemarin - Rekap transaksi kemarin\n` +
      `• /bulanini - Rekap pengeluaran & sisa budget bulan ini\n` +
      `• /sinkingfund - Cek progres tabungan dana siaga\n` +
      `• /tagihan - Cek jadwal tagihan rutin bulanan\n` +
      `• /help - Tampilkan panduan ini\n\n` +
      `*Kemampuan AI Agent Lainnya:*\n` +
      `1. *Catat Belanja*: "Beli bakso 25rb bayar pake Gopay"\n` +
      `2. *Rincian Item*: "Beli beras 70rb, telur 25rb, minyak 35rb pake BCA"\n` +
      `3. *Kirim Foto*: Foto struk Indomaret atau coretan tangan di kertas\n` +
      `4. *Kirim Suara*: Kirim rekaman Voice Note pengeluaran\n` +
      `5. *Buat Dompet*: "bikin dompet baru Bank Jago saldo 500rb"\n` +
      `6. *Transfer*: "transfer dari BCA ke Gopay 200rb"\n` +
      `7. *Atur Budget*: "atur budget makan 2 juta sebulan"\n` +
      `8. *Edit/Hapus Transaksi*: "ubah pengeluaran bensin kemarin jadi 60rb" atau "hapus transaksi bensin kemarin"\n` +
      `9. *Tanya Konsultan*: "pengeluaran ada apa aja?", "apakah bulan ini boros?"`
    );
  }
}
