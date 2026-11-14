import { Bot } from 'grammy';
import { prisma } from '../db.js';
import { LLMProviderService } from './llm-provider.js';
import { ApprovalEngine } from './approval-engine.js';
import { ActionType, InputSource, TransactionType } from '@prisma/client';

export class TelegramManager {
  public static globalBot: Bot | null = null;
  public static globalBotUsername: string | null = null;
  public static isGlobalBotRunning: boolean = false;
  private static activeBots: Map<string, Bot> = new Map();

  /**
   * Inisialisasi Bot Telegram Global dan Bot Telegram Mandiri Milik Keluarga
   */
  static async initAll() {
    // 1. Inisialisasi Global Telegram Bot (jika token tersedia di environment)
    await this.initGlobalBot();

    // 2. Inisialisasi Custom Family Telegram Bot (jika ada keluarga yang mengatur token sendiri)
    try {
      const families = await prisma.family.findMany({
        where: {
          telegramBotToken: { not: null },
        },
      });

      if (families.length > 0) {
        console.log(`🤖 Memulai ${families.length} bot Telegram mandiri keluarga...`);
        for (const fam of families) {
          if (fam.telegramBotToken) {
            await this.startFamilyBot(fam.id, fam.telegramBotToken).catch((err) => {
              console.error(`Gagal memulai bot Telegram mandiri untuk keluarga ${fam.name}:`, err.message);
            });
          }
        }
      }
    } catch (err) {
      console.error('Error saat inisialisasi custom bot Telegram:', err);
    }
  }

  /**
   * Inisialisasi Bot Telegram Global (Official Shared Bot)
   */
  static async initGlobalBot() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || !token.trim()) {
      console.log('ℹ️ TELEGRAM_BOT_TOKEN belum diisi di environment. Global Telegram Bot dilewati.');
      return;
    }

    try {
      if (this.globalBot) {
        try {
          this.globalBot.stop();
        } catch (e) {
          // ignore
        }
      }

      const bot = new Bot(token.trim());
      const me = await bot.api.getMe();
      this.globalBot = bot;
      this.globalBotUsername = me.username;
      this.isGlobalBotRunning = true;

      // 1. Command /start
      bot.command('start', async (ctx) => {
        await this.handleStartCommand(ctx, null);
      });

      // 2. Incoming Messages
      bot.on(['message:text', 'message:photo', 'message:voice'], async (ctx) => {
        await this.handleIncomingMessage(null, ctx, token.trim());
      });

      // Jalankan polling bot global
      bot.start({
        onStart: () => {
          console.log(`✅ Global Telegram Bot @${this.globalBotUsername} aktif dan siap melayani seluruh keluarga!`);
        },
      });
    } catch (err: any) {
      this.isGlobalBotRunning = false;
      console.error('❌ Gagal menginisialisasi Global Telegram Bot:', err.message);
    }
  }

  /**
   * Cek apakah bot Telegram (global atau keluarga) sedang aktif
   */
  static isBotRunning(familyId?: string): boolean {
    if (familyId && this.activeBots.has(familyId)) return true;
    return this.isGlobalBotRunning;
  }

  /**
   * Hentikan bot Telegram keluarga
   */
  static async stopFamilyBot(familyId: string) {
    const existing = this.activeBots.get(familyId);
    if (existing) {
      try {
        existing.stop();
      } catch (e) {
        // ignore stop error
      }
      this.activeBots.delete(familyId);
    }
  }

  /**
   * Mulai / Restart bot Telegram mandiri milik keluarga
   */
  static async startFamilyBot(familyId: string, botToken: string): Promise<{ username: string }> {
    await this.stopFamilyBot(familyId);

    const bot = new Bot(botToken.trim());
    const me = await bot.api.getMe();
    const botUsername = me.username;

    await prisma.family.update({
      where: { id: familyId },
      data: {
        telegramBotToken: botToken.trim(),
        telegramBotUsername: botUsername,
      },
    });

    bot.command('start', async (ctx) => {
      await this.handleStartCommand(ctx, familyId);
    });

    bot.on(['message:text', 'message:photo', 'message:voice'], async (ctx) => {
      await this.handleIncomingMessage(familyId, ctx, botToken.trim());
    });

    bot.start({
      onStart: () => {
        console.log(`✅ Bot Telegram Mandiri @${botUsername} aktif untuk keluarga ${familyId}!`);
      },
    });

    this.activeBots.set(familyId, bot);
    return { username: botUsername };
  }

  /**
   * Handler untuk command /start
   */
  private static async handleStartCommand(ctx: any, targetFamilyId: string | null) {
    const chatId = String(ctx.from?.id);

    // Cari user berdasarkan telegramChatId
    let user = await prisma.user.findFirst({
      where: {
        telegramChatId: chatId,
        ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
      },
      include: { family: true },
    });

    // Jika belum ada di tabel User, cek tabel BotWhitelist
    if (!user) {
      const whitelist = await prisma.botWhitelist.findFirst({
        where: {
          platform: 'TELEGRAM',
          identifier: chatId,
          ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
        },
        include: { family: { include: { users: true } } },
      });

      if (whitelist && whitelist.family.users.length > 0) {
        user = whitelist.family.users[0] as any;
        (user as any).family = whitelist.family;
      }
    }

    if (!user) {
      await ctx.reply(
        `Halo ${ctx.from?.first_name || ''}! 👋\n\n` +
        `ID Telegram Anda adalah: \`${chatId}\`\n\n` +
        `⚠️ ID ini *belum terdaftar* di keluarga mana pun di aplikasi *Ini Uangku*.\n\n` +
        `Salin ID di atas dan berikan kepada Manager keluarga Anda untuk ditambahkan ke daftar whitelist di aplikasi, agar Anda dapat mulai mencatat keuangan keluarga.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply(
      `Halo ${user.name || ctx.from?.first_name}! 🎀\n\n` +
      `Selamat datang di Bot Finansial Keluarga *"${user.family.name}"*.\n\n` +
      `Bot siap membantu mencatat keuangan keluarga Anda:\n` +
      `• Ketik pesan belanja (e.g. *"Beli beras 75rb bayar pake BCA"*)\n` +
      `• Kirim foto nota / struk belanjaan\n` +
      `• Kirim foto catatan coretan belanja di kertas\n` +
      `• Kirim rekaman suara (Voice Note)\n\n` +
      `Setiap draf yang terdeteksi akan diajukan ke Anda terlebih dahulu untuk disetujui (*"Ya"* / *"Setuju"*)!`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle pesan masuk dari Telegram (Global atau Custom Family Bot)
   */
  private static async handleIncomingMessage(targetFamilyId: string | null, ctx: any, botToken: string) {
    const chatId = String(ctx.from?.id);

    // 1. Identifikasi User dan Keluarga pengirim
    let user = await prisma.user.findFirst({
      where: {
        telegramChatId: chatId,
        ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
      },
      include: { family: true },
    });

    let effectiveFamily = user?.family;

    // Jika tidak ditemukan di tabel User, cek di tabel BotWhitelist
    if (!user) {
      const whitelistEntry = await prisma.botWhitelist.findFirst({
        where: {
          platform: 'TELEGRAM',
          identifier: chatId,
          ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
        },
        include: {
          family: {
            include: { users: true },
          },
        },
      });

      if (whitelistEntry && whitelistEntry.family) {
        effectiveFamily = whitelistEntry.family;
        user = whitelistEntry.family.users[0] as any;
      }
    }

    // JIKA TIDAK ADA DI WHITELIST KELUARGA MANA PUN -> Beritahu petunjuk pendaftaran
    if (!user || !effectiveFamily) {
      await ctx.reply(
        `⚠️ ID Telegram Anda (\`${chatId}\`) belum terdaftar di aplikasi Ini Uangku.\n` +
        `Silakan berikan ID ini kepada Manager keluarga Anda untuk didaftarkan di menu Whitelist Bot.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const familyId = effectiveFamily.id;
    const textContent = ctx.message?.text || ctx.message?.caption || '';

    // 2. Cek apakah pesan adalah persetujuan untuk Draf yang sedang aktif
    const activePending = await ApprovalEngine.getActivePendingAction(user.id);
    if (activePending && textContent) {
      const response = await ApprovalEngine.processResponse(user.id, textContent);
      if (response.status === 'APPROVED' || response.status === 'REJECTED') {
        let replyMsg = response.message;
        if (response.alert) replyMsg += `\n\n${response.alert}`;
        await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
        return;
      }
    }

    // 3. Konteks Waktu & Agregasi Temporal Finansial Keluarga
    const now = new Date();
    const currentDateIso = now.toISOString().split('T')[0];
    const currentDateTimeFormatted = now.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' WIB';

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    const startOfThisYear = new Date(now.getFullYear(), 0, 1);

    const [
      wallets,
      categories,
      recentTransactions,
      todayAgg,
      yesterdayAgg,
      thisMonthAgg,
      lastMonthAgg,
      thisYearAgg,
      sinkingFunds,
    ] = await Promise.all([
      prisma.wallet.findMany({
        where: { familyId },
        select: { id: true, name: true, type: true, balance: true },
      }),
      prisma.category.findMany({
        where: { familyId },
        select: { id: true, name: true, monthlyBudget: true, alertThreshold: true },
      }),
      prisma.transaction.findMany({
        where: { familyId },
        orderBy: { transactionDate: 'desc' },
        take: 35,
        include: {
          wallet: { select: { name: true } },
          category: { select: { name: true } },
          user: { select: { name: true } },
        },
      }),
      // Hari ini
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      // Kemarin
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfYesterday, lt: startOfToday } },
        _sum: { amount: true },
      }),
      // Bulan ini
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfThisMonth } },
        _sum: { amount: true },
      }),
      // Bulan lalu
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { amount: true },
      }),
      // Tahun ini
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfThisYear } },
        _sum: { amount: true },
      }),
      prisma.sinkingFund.findMany({
        where: { familyId, isActive: true },
        select: { name: true, currentAmount: true, targetAmount: true },
      }),
    ]);

    const getSums = (aggList: any[]) => {
      let expense = 0;
      let income = 0;
      for (const g of aggList) {
        const sum = Number(g._sum.amount) || 0;
        if (g.type === 'EXPENSE') expense += sum;
        if (g.type === 'INCOME') income += sum;
      }
      return { expense, income };
    };

    const todaySums = getSums(todayAgg);
    const yesterdaySums = getSums(yesterdayAgg);
    const thisMonthSums = getSums(thisMonthAgg);
    const lastMonthSums = getSums(lastMonthAgg);
    const thisYearSums = getSums(thisYearAgg);

    const formattedRecent = recentTransactions.map((t) => {
      const d = new Date(t.transactionDate);
      const isToday = d.toDateString() === now.toDateString();
      const yDay = new Date(now);
      yDay.setDate(yDay.getDate() - 1);
      const isYesterday = d.toDateString() === yDay.toDateString();
      const relLabel = isToday ? 'Hari Ini' : isYesterday ? 'Kemarin' : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

      return {
        id: t.id,
        description: t.description,
        amount: Number(t.amount),
        type: t.type,
        date: d.toISOString().split('T')[0],
        time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        label: relLabel,
        walletName: t.wallet?.name || 'Dompet',
        categoryName: t.category?.name || 'Umum',
        userName: t.user?.name || 'Anggota',
      };
    });

    const formattedSinking = sinkingFunds.map((s) => ({
      name: s.name,
      currentAmount: Number(s.currentAmount),
      targetAmount: Number(s.targetAmount),
    }));

    let imageBase64: string | undefined = undefined;
    let audioBase64: string | undefined = undefined;

    // 4. Handle Foto (Struk / Catatan Kertas)
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      await ctx.reply('🔍 Sedang membaca foto nota / tulisan tangan Anda dengan AI...');
      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Resolusi tertinggi
        const file = await ctx.api.getFile(photo.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          imageBase64 = buf.toString('base64');
        }
      } catch (err) {
        console.error('Gagal mengunduh foto dari Telegram:', err);
      }
    }

    // 5. Handle Voice Note
    if (ctx.message?.voice) {
      await ctx.reply('🎙️ Sedang mendengarkan pesan suara Anda...');
      try {
        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          audioBase64 = buf.toString('base64');
        }
      } catch (err) {
        console.error('Gagal mengunduh voice note dari Telegram:', err);
      }
    }

    if (!textContent && !imageBase64 && !audioBase64) return;

    // 6. Analisa Cerdas dengan AI (Kesadaran Waktu, CRUD Transaksi & Manajemen Finansial Lengkap)
    const processed = await LLMProviderService.processMessage({
      familyId,
      currentDateIso,
      currentDateTimeFormatted,
      rawText: textContent,
      imageBase64,
      imageMimeType: 'image/jpeg',
      audioBase64,
      audioMimeType: 'audio/ogg',
      contextWallets: wallets.map((w) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        balance: Number(w.balance),
      })),
      contextCategories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        monthlyBudget: c.monthlyBudget ? Number(c.monthlyBudget) : undefined,
        alertThreshold: c.alertThreshold ? Number(c.alertThreshold) : undefined,
      })),
      recentTransactions: formattedRecent,
      timeAggregations: {
        todayExpense: todaySums.expense,
        todayIncome: todaySums.income,
        yesterdayExpense: yesterdaySums.expense,
        yesterdayIncome: yesterdaySums.income,
        thisMonthExpense: thisMonthSums.expense,
        thisMonthIncome: thisMonthSums.income,
        lastMonthExpense: lastMonthSums.expense,
        lastMonthIncome: lastMonthSums.income,
        thisYearExpense: thisYearSums.expense,
        thisYearIncome: thisYearSums.income,
      },
      monthlySummary: {
        totalExpense: thisMonthSums.expense,
        totalIncome: thisMonthSums.income,
        netBalance: thisMonthSums.income - thisMonthSums.expense,
      },
      sinkingFunds: formattedSinking,
    });

    // 7. Jika berupa Pertanyaan / Konsultasi Finansial (Read / Analisis Waktu)
    if (processed.intent === 'FINANCIAL_CONSULTATION' && processed.replyText) {
      await ctx.reply(processed.replyText, { parse_mode: 'Markdown' });
      return;
    }

    // 8. Cabang berdasarkan Action Type Manajemen Keuangan:
    if (processed.actionType === 'UPDATE_TRANSACTION') {
      const summaryText =
        `📋 *Draf Pembaruan (Edit) Transaksi:*\n` +
        `${processed.summaryMessage || `• Ubah: ${processed.targetDescription}\n• Nominal Baru: Rp ${(processed.newAmount || 0).toLocaleString('id-ID')}`}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui pembaruan transaksi ini, atau ketik koreksi Anda.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.UPDATE_TRANSACTION,
        {
          targetTransactionId: processed.targetTransactionId,
          targetDescription: processed.targetDescription,
          newAmount: processed.newAmount,
          newDescription: processed.newDescription,
          newDate: processed.newDate,
          newWalletId: processed.newWalletId,
          newCategoryId: processed.newCategoryId,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    if (processed.actionType === 'DELETE_TRANSACTION') {
      const summaryText =
        `📋 *Draf Penghapusan Transaksi:*\n` +
        `${processed.summaryMessage || `• Hapus Transaksi: ${processed.targetDescription}`}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui penghapusan transaksi ini dan memulihkan saldo dompet.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.DELETE_TRANSACTION,
        {
          targetTransactionId: processed.targetTransactionId,
          targetDescription: processed.targetDescription,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    if (processed.actionType === 'CREATE_WALLET') {
      const summaryText =
        `📋 *Draf Pembuatan Dompet Baru:*\n` +
        `• *Nama Dompet*: ${processed.walletName}\n` +
        `• *Tipe*: ${processed.walletType || 'BANK'}\n` +
        `• *Saldo Awal*: Rp ${(processed.initialBalance || 0).toLocaleString('id-ID')}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.CREATE_WALLET,
        {
          name: processed.walletName,
          type: processed.walletType || 'BANK',
          initialBalance: processed.initialBalance || 0,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    if (processed.actionType === 'TRANSFER_WALLET') {
      const srcWallet = wallets.find((w) => w.id === processed.sourceWalletId) || wallets[0];
      const tgtWallet = wallets.find((w) => w.id === processed.targetWalletId) || wallets[1] || wallets[0];
      const numAmount = processed.amount || 0;

      const summaryText =
        `📋 *Draf Transfer Antar Dompet:*\n` +
        `• *Dari Dompet*: ${srcWallet?.name}\n` +
        `• *Ke Dompet*: ${tgtWallet?.name}\n` +
        `• *Nominal*: Rp ${numAmount.toLocaleString('id-ID')}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui transfer ini, atau ketik koreksi Anda.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.TRANSFER_WALLET,
        {
          sourceWalletId: srcWallet.id,
          targetWalletId: tgtWallet.id,
          amount: numAmount,
          description: processed.description || 'Transfer Antar Dompet',
          inputSource: InputSource.TELEGRAM_TEXT,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    if (processed.actionType === 'SET_BUDGET') {
      const targetCat = categories.find((c) => c.id === processed.categoryId || c.name.toLowerCase() === (processed.categoryName || '').toLowerCase());
      const catName = targetCat?.name || processed.categoryName || 'Kategori';
      const monthlyBudget = processed.monthlyBudget || 0;

      const summaryText =
        `📋 *Draf Pengaturan Anggaran (Budget):*\n` +
        `• *Kategori*: ${catName}\n` +
        `• *Batas Anggaran Bulanan*: Rp ${monthlyBudget.toLocaleString('id-ID')}\n` +
        `• *Peringatan Guardrail*: 80% kuota\n\n` +
        `👉 *Balas "Ya" untuk menyetujui anggaran ini, atau ketik koreksi Anda.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.SET_BUDGET,
        {
          categoryId: targetCat?.id,
          categoryName: catName,
          monthlyBudget,
          alertThreshold: 80,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    if (processed.actionType === 'CREATE_SINKING_FUND') {
      const defaultWallet = wallets[0];
      const summaryText =
        `📋 *Draf Pos Dana Siaga (Sinking Fund):*\n` +
        `• *Nama Pos*: ${processed.sinkingFundName}\n` +
        `• *Target Dana*: Rp ${(processed.targetAmount || 0).toLocaleString('id-ID')}\n` +
        `• *Alokasi Bulanan*: Rp ${(processed.monthlyAlloc || 0).toLocaleString('id-ID')}\n` +
        `• *Sumber Dana*: ${defaultWallet?.name || 'Utama'}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui pembuatan pos tabungan ini.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.CREATE_SINKING_FUND,
        {
          name: processed.sinkingFundName,
          targetAmount: processed.targetAmount || 0,
          monthlyAlloc: processed.monthlyAlloc || 0,
          sourceWalletId: processed.sourceWalletId || defaultWallet?.id,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    if (processed.actionType === 'CREATE_RECURRING_BILL') {
      const defaultWallet = wallets[0];
      const defaultCat = categories[0];
      const summaryText =
        `📋 *Draf Jadwal Tagihan Rutin Bulanan:*\n` +
        `• *Nama Tagihan*: ${processed.billName}\n` +
        `• *Nominal*: Rp ${(processed.amount || 0).toLocaleString('id-ID')}\n` +
        `• *Jatuh Tempo*: Tanggal ${processed.dueDayOfMonth || 1} setiap bulan\n` +
        `• *Sumber Dompet*: ${defaultWallet?.name || 'Utama'}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui jadwal tagihan ini.*`;

      await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        ActionType.CREATE_RECURRING_BILL,
        {
          name: processed.billName,
          amount: processed.amount || 0,
          dueDayOfMonth: processed.dueDayOfMonth || 1,
          walletId: processed.walletId || defaultWallet?.id,
          categoryId: processed.categoryId || defaultCat?.id,
        },
        summaryText
      );
      await ctx.reply(summaryText, { parse_mode: 'Markdown' });
      return;
    }

    // 9. Jika berupa Pencatatan Transaksi Baru (CREATE_TRANSACTION)
    if (!processed.amount || processed.amount <= 0) {
      await ctx.reply('Mohon maaf, nominal pengeluaran belum terbaca dengan jelas. Bisa disebutkan kembali keperluan dan nominalnya?');
      return;
    }

    const targetWallet = wallets.find((w) => w.id === processed.walletId) || wallets[0];
    const targetCategory = categories.find((c) => c.id === processed.categoryId) || categories[0];

    const hasMultipleItems = Array.isArray(processed.items) && processed.items.length > 1;
    let summaryText = '';

    const effectiveDate = processed.transactionDate || currentDateIso;
    const dateDisplay = new Date(effectiveDate).toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    if (hasMultipleItems) {
      const itemsList = (processed.items || []).map((it, idx) => `  ${idx + 1}. ${it.name}: Rp ${((it.price || 0) * (it.qty || 1)).toLocaleString('id-ID')}`).join('\n');
      summaryText =
        `📋 *Draf Pencatatan Transaksi (${processed.items!.length} Item Terpisah):*\n` +
        itemsList +
        `\n\n• *Total*: Rp ${processed.amount.toLocaleString('id-ID')}\n` +
        `• *Tanggal Transaksi*: ${dateDisplay}\n` +
        `• *Dompet*: ${targetWallet?.name || 'Utama'}\n` +
        `• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui dan mencatat tiap item satu-per-satu ke jurnal, atau ketik koreksi Anda.*`;
    } else {
      summaryText =
        `📋 *Draf Pencatatan Ditemukan:*\n` +
        `• *Keperluan*: ${processed.description}\n` +
        `• *Total*: Rp ${processed.amount.toLocaleString('id-ID')}\n` +
        `• *Tanggal Transaksi*: ${dateDisplay}\n` +
        `• *Dompet*: ${targetWallet?.name || 'Utama'}\n` +
        `• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n` +
        `👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;
    }

    const proposedPayload = {
      walletId: targetWallet.id,
      categoryId: targetCategory.id,
      amount: processed.amount,
      description: processed.description || 'Pengeluaran Rumah Tangga',
      type: processed.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      transactionDate: effectiveDate,
      inputSource: imageBase64 ? InputSource.TELEGRAM_IMAGE_RECEIPT : audioBase64 ? InputSource.TELEGRAM_VOICE_NOTE : InputSource.TELEGRAM_TEXT,
      items: processed.items,
    };

    await ApprovalEngine.createPendingAction(
      familyId,
      user.id,
      ActionType.CREATE_TRANSACTION,
      proposedPayload,
      summaryText
    );

    await ctx.reply(summaryText, { parse_mode: 'Markdown' });
  }

  /**
   * Kirim pesan ke chatId pengguna melalui Telegram (Global Bot atau Custom Family Bot)
   */
  static async sendMessage(familyId: string, chatId: string, text: string) {
    const customBot = this.activeBots.get(familyId);
    if (customBot) {
      try {
        await customBot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        return;
      } catch (err: any) {
        console.error(`Gagal mengirim via custom bot ke ${chatId}:`, err.message);
      }
    }

    if (this.globalBot) {
      try {
        await this.globalBot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      } catch (err: any) {
        console.error(`Gagal mengirim via global Telegram bot ke ${chatId}:`, err.message);
      }
    } else {
      console.warn(`Tidak ada bot Telegram yang aktif untuk mengirim pesan ke ${chatId}`);
    }
  }
}
