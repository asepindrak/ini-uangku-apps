import { Bot, InlineKeyboard } from 'grammy';
import { prisma } from '../db.js';
import { LLMProviderService } from './llm-provider.js';
import { ApprovalEngine } from './approval-engine.js';
import { FinancialReportsService } from './financial-reports.js';
import { TimezoneService } from './timezone-service.js';
import { BotGateway } from './bot-gateway.js';
import { ActionType, ActionStatus, InputSource, TransactionType, BotChatPlatform, BotChatStatus } from '@prisma/client';

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

      // Pasang handler command, callback query tombol, dan pesan masuk
      await this.setupBotHandlers(bot, null, token.trim());

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
   * Pasang semua command finansial, callback query button inline, dan message listener
   */
  private static async setupBotHandlers(bot: Bot, targetFamilyId: string | null, token: string) {
    // 1. Daftarkan menu autocomplete command resmi Telegram
    bot.api
      .setMyCommands([
        { command: 'saldo', description: 'Cek saldo seluruh dompet kas & bank' },
        { command: 'hariini', description: 'Rekap transaksi pengeluaran hari ini' },
        { command: 'kemarin', description: 'Rekap transaksi kemarin' },
        { command: 'bulanini', description: 'Rekap pengeluaran & budget bulan ini' },
        { command: 'sinkingfund', description: 'Cek pos tabungan dana siaga' },
        { command: 'tagihan', description: 'Cek jadwal tagihan rutin bulanan' },
        { command: 'help', description: 'Panduan lengkap cara pakai bot' },
      ])
      .catch((e) => console.warn('Gagal setMyCommands:', e.message));

    // 2. /start
    bot.command('start', async (ctx) => {
      await this.handleStartCommand(ctx, targetFamilyId);
    });

    // 3. /saldo
    bot.command('saldo', async (ctx) => {
      const user = await this.identifyUser(ctx, targetFamilyId);
      if (!user) return;
      const res = await FinancialReportsService.getSaldoReport(user.familyId);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 4. /hariini
    bot.command('hariini', async (ctx) => {
      const user = await this.identifyUser(ctx, targetFamilyId);
      if (!user) return;
      const res = await FinancialReportsService.getHariIniReport(user.familyId);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 5. /kemarin
    bot.command('kemarin', async (ctx) => {
      const user = await this.identifyUser(ctx, targetFamilyId);
      if (!user) return;
      const res = await FinancialReportsService.getKemarinReport(user.familyId);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 6. /bulanini
    bot.command('bulanini', async (ctx) => {
      const user = await this.identifyUser(ctx, targetFamilyId);
      if (!user) return;
      const res = await FinancialReportsService.getBulanIniReport(user.familyId);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 7. /sinkingfund
    bot.command('sinkingfund', async (ctx) => {
      const user = await this.identifyUser(ctx, targetFamilyId);
      if (!user) return;
      const res = await FinancialReportsService.getSinkingFundReport(user.familyId);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 8. /tagihan
    bot.command('tagihan', async (ctx) => {
      const user = await this.identifyUser(ctx, targetFamilyId);
      if (!user) return;
      const res = await FinancialReportsService.getTagihanReport(user.familyId);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 9. /help & /bantuan
    bot.command(['help', 'bantuan'], async (ctx) => {
      const res = FinancialReportsService.getHelpMessage(this.globalBotUsername || undefined);
      await ctx.reply(res, { parse_mode: 'Markdown' });
    });

    // 10. Callback Query Handler (Interaktif Tombol Inline "Setuju" & "Batal")
    bot.on('callback_query:data', async (ctx) => {
      const data = ctx.callbackQuery.data;
      const [action, actionId] = data.split(':');

      if (action === 'approve' || action === 'reject') {
        const isApprove = action === 'approve';
        await ctx.answerCallbackQuery({
          text: isApprove ? 'Menyetujui aksi...' : 'Membatalkan...',
        });

        const pending = await prisma.pendingAction.findUnique({
          where: { id: actionId },
        });

        if (!pending || pending.status !== ActionStatus.PENDING_APPROVAL) {
          await ctx.editMessageText('⚠️ Draf ini sudah pernah diproses atau kedaluwarsa.');
          return;
        }

        const response = await ApprovalEngine.processResponse(pending.userId, isApprove ? 'ya' : 'batal');
        let replyMsg = response.message;
        if (response.alert) replyMsg += `\n\n${response.alert}`;

        await ctx.editMessageText(replyMsg, { parse_mode: 'Markdown' });
      }
    });

    // 11. Incoming Messages (Text, Photo, Voice)
    bot.on(['message:text', 'message:photo', 'message:voice'], async (ctx) => {
      await this.handleIncomingMessage(targetFamilyId, ctx, token);
    });
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

    await this.setupBotHandlers(bot, familyId, botToken.trim());

    bot.start({
      onStart: () => {
        console.log(`✅ Bot Telegram Mandiri @${botUsername} aktif untuk keluarga ${familyId}!`);
      },
    });

    this.activeBots.set(familyId, bot);
    return { username: botUsername };
  }

  /**
   * Helper Identifikasi User Telegram
   */
  private static async identifyUser(ctx: any, targetFamilyId: string | null) {
    const chatId = String(ctx.from?.id);
    let user = await prisma.user.findFirst({
      where: {
        telegramChatId: chatId,
        ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
      },
      include: { family: true },
    });

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
        `⚠️ ID Telegram Anda (\`${chatId}\`) belum terdaftar di keluarga mana pun di aplikasi Ini Uangku.\n` +
        `Ketik /start untuk melihat petunjuk pendaftaran.`,
        { parse_mode: 'Markdown' }
      );
      return null;
    }

    return user;
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
      `Halo Kak ${user.name || ctx.from?.first_name}! 🎀\n\n` +
      `Kenalin, aku *Monee*, asisten & konsultan keuangan cerdas untuk keluarga *"${user.family.name}"* siap bantu kelola keuangan Kakak!\n\n` +
      `*Perintah Cepat ke Monee:*\n` +
      `• /saldo - Cek saldo seluruh dompet kas & bank\n` +
      `• /hariini - Rekap transaksi hari ini\n` +
      `• /kemarin - Rekap transaksi kemarin\n` +
      `• /bulanini - Rekap pengeluaran & budget bulan ini\n` +
      `• /sinkingfund - Cek pos tabungan dana siaga\n` +
      `• /tagihan - Cek jadwal tagihan rutin bulanan\n` +
      `• /help - Panduan lengkap dari Monee\n\n` +
      `*Kakak juga bisa langsung chat ke Monee:* ketik belanjaan, kirim foto nota/struk belanja, kirim voice note, atau tanya saran keuangan!`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Handle pesan masuk dari Telegram (Global atau Custom Family Bot)
   */
  private static async handleIncomingMessage(targetFamilyId: string | null, ctx: any, botToken: string) {
    const chatId = String(ctx.from?.id);
    const textContent = ctx.message?.text || ctx.message?.caption || '';

    // 1. Identifikasi User dan Keluarga pengirim
    let user = await prisma.user.findFirst({
      where: {
        telegramChatId: chatId,
        ...(targetFamilyId ? { familyId: targetFamilyId } : {}),
      },
      include: { family: true },
    });

    let effectiveFamily = user?.family;

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

    if (!user || !effectiveFamily) {
      const blockedText =
        `⚠️ ID Telegram Anda (\`${chatId}\`) belum terdaftar di aplikasi Ini Uangku.\n` +
        `Silakan berikan ID ini kepada Manager keluarga Anda untuk didaftarkan di menu Whitelist Bot.`;

      await BotGateway.logChatMessage({
        platform: BotChatPlatform.TELEGRAM,
        senderIdentifier: chatId,
        senderName: ctx.from?.first_name || 'Pengguna Telegram',
        messageType: 'text',
        rawContent: textContent || '[Pesan Telegram]',
        replyContent: blockedText,
        status: BotChatStatus.BLOCKED_NOT_WHITELISTED,
      });

      await ctx.reply(blockedText, { parse_mode: 'Markdown' });
      return;
    }

    const familyId = effectiveFamily.id;

    // 2. Cek apakah pesan adalah persetujuan teks ("Ya" / "Batal") untuk Draf yang sedang aktif
    const activePending = await ApprovalEngine.getActivePendingAction(user.id, user.familyId);
    if (activePending && textContent) {
      const response = await ApprovalEngine.processResponse(user.id, textContent, user.familyId);
      if (response.status === 'APPROVED' || response.status === 'REJECTED') {
        let replyMsg = response.message;
        if (response.alert) replyMsg += `\n\n${response.alert}`;
        await ctx.reply(replyMsg, { parse_mode: 'Markdown' });
        return;
      }
    }

    // 3. Konteks Waktu & Agregasi Temporal Finansial Keluarga (Berdasarkan Timezone Keluarga)
    const tz = await TimezoneService.getFamilyTimezone(familyId);
    const bounds = TimezoneService.getTimezoneBounds(tz);

    const currentDateIso = bounds.todayIso;
    const currentDateTimeFormatted = bounds.nowFormatted;

    const startOfToday = bounds.startOfToday;
    const startOfYesterday = bounds.startOfYesterday;
    const endOfYesterday = bounds.endOfYesterday;
    const startOfThisMonth = bounds.startOfThisMonth;
    const startOfLastMonth = bounds.startOfLastMonth;
    const endOfLastMonth = bounds.endOfLastMonth;
    const startOfThisYear = bounds.startOfThisYear;

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
      pendingActionsList,
      recentChatList,
    ] = await Promise.all([
      prisma.wallet.findMany({
        where: { familyId },
        select: { id: true, name: true, type: true, balance: true, isDefaultExpense: true },
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
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfYesterday, lt: startOfToday } },
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfThisMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfThisYear } },
        _sum: { amount: true },
      }),
      prisma.sinkingFund.findMany({
        where: { familyId, isActive: true },
        select: { name: true, currentAmount: true, targetAmount: true },
      }),
      prisma.pendingAction.findMany({
        where: {
          familyId,
          status: 'PENDING_APPROVAL',
          expiresAt: { gt: new Date() },
        },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.botChatMessage.findMany({
        where: { familyId },
        orderBy: { createdAt: 'desc' },
        take: 6,
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
      const isToday = d.getTime() >= startOfToday.getTime() && d.getTime() <= bounds.endOfToday.getTime();
      const isYesterday = d.getTime() >= startOfYesterday.getTime() && d.getTime() < startOfToday.getTime();
      const relLabel = isToday ? 'Hari Ini' : isYesterday ? 'Kemarin' : TimezoneService.formatDate(d, tz, { day: 'numeric', month: 'short' });

      return {
        id: t.id,
        description: t.description,
        amount: Number(t.amount),
        type: t.type,
        date: d.toISOString().split('T')[0],
        time: TimezoneService.formatTime(d, tz),
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

    const formattedPending = (pendingActionsList || []).map((p) => {
      const payload = (p.proposedPayload as any) || {};
      return {
        id: p.id,
        userName: p.user?.name || 'Anggota Keluarga',
        actionType: p.actionType,
        summary: p.summaryText || `${payload?.description || 'Transaksi'} Rp ${(payload?.amount || 0).toLocaleString('id-ID')}`,
        proposedDate: payload?.transactionDate || null,
        createdAt: TimezoneService.formatDateTime(p.createdAt, tz),
      };
    });

    const formattedChatHistory = (recentChatList || [])
      .slice()
      .reverse()
      .map((c) => ({
        sender: c.senderName || 'Pengguna',
        message: c.rawContent,
        reply: c.replyContent || undefined,
      }));

    let imageBase64: string | undefined = undefined;
    let audioBase64: string | undefined = undefined;

    // 4. Handle Foto (Struk / Catatan Kertas)
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      await ctx.reply('🔍 Monee sedang membaca foto nota / tulisan tangan Kakak...');
      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
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
      await ctx.reply('🎙️ Monee sedang mendengarkan pesan suara Kakak...');
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
        isDefaultExpense: !!w.isDefaultExpense,
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
      pendingActions: formattedPending,
      recentChatHistory: formattedChatHistory,
    });

    // 7. Jika berupa Pertanyaan / Konsultasi Finansial
    if (processed.intent === 'FINANCIAL_CONSULTATION' && processed.replyText) {
      await ctx.reply(processed.replyText, { parse_mode: 'Markdown' });
      return;
    }

    // 8. Helper pembuatan draf dengan tombol InlineKeyboard interaktif
    const sendDraftWithButtons = async (
      actionType: ActionType,
      payload: any,
      summaryText: string
    ) => {
      const pending = await ApprovalEngine.createPendingAction(
        familyId,
        user.id,
        actionType,
        payload,
        summaryText
      );

      const keyboard = new InlineKeyboard()
        .text('✅ Setuju ("Ya")', `approve:${pending.id}`)
        .text('❌ Batalkan', `reject:${pending.id}`);

      await ctx.reply(summaryText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    };

    // 9. Cabang Action Types Manajemen Keuangan:
    if (processed.actionType === 'UPDATE_TRANSACTION') {
      const summaryText =
        `📋 *Draf Pembaruan (Edit) Transaksi:*\n` +
        `${processed.summaryMessage || `• Ubah: ${processed.targetDescription}\n• Nominal Baru: Rp ${(processed.newAmount || 0).toLocaleString('id-ID')}`}\n\n` +
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui:*`;

      await sendDraftWithButtons(
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
      return;
    }

    if (processed.actionType === 'DELETE_TRANSACTION') {
      const summaryText =
        `📋 *Draf Penghapusan Transaksi:*\n` +
        `${processed.summaryMessage || `• Hapus Transaksi: ${processed.targetDescription}`}\n\n` +
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui:*`;

      await sendDraftWithButtons(
        ActionType.DELETE_TRANSACTION,
        {
          targetTransactionId: processed.targetTransactionId,
          targetDescription: processed.targetDescription,
        },
        summaryText
      );
      return;
    }

    if (processed.actionType === 'CREATE_WALLET') {
      const hasBatchWallets = Array.isArray(processed.wallets) && processed.wallets.length > 0;
      const hasBatchCategories = Array.isArray(processed.categories) && processed.categories.length > 0;

      let summaryText = '';
      if (hasBatchWallets || hasBatchCategories) {
        summaryText = `📋 *Draf Penambahan Pos Keuangan:*\n`;
        if (hasBatchWallets) {
          summaryText += `\n💳 *Dompet Baru (${processed.wallets!.length}):*\n`;
          processed.wallets!.forEach((w, i) => {
            summaryText += `${i + 1}. ${w.name} (${w.type || 'CASH'} - Saldo: Rp ${(w.initialBalance || 0).toLocaleString('id-ID')})\n`;
          });
        }
        if (hasBatchCategories) {
          summaryText += `\n🏷️ *Kategori Pengeluaran/Pemasukan (${processed.categories!.length}):*\n`;
          processed.categories!.forEach((c, i) => {
            summaryText += `${i + 1}. ${c.name}${c.monthlyBudget ? ` (Budget: Rp ${c.monthlyBudget.toLocaleString('id-ID')})` : ''}\n`;
          });
        }
        summaryText += `\n👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui sekaligus:* `;
      } else {
        summaryText =
          `📋 *Draf Pembuatan Dompet Baru:*\n` +
          `• *Nama Dompet*: ${processed.walletName}\n` +
          `• *Tipe*: ${processed.walletType || 'BANK'}\n` +
          `• *Saldo Awal*: Rp ${(processed.initialBalance || 0).toLocaleString('id-ID')}\n\n` +
          `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui:*`;
      }

      await sendDraftWithButtons(
        ActionType.CREATE_WALLET,
        {
          name: processed.walletName,
          type: processed.walletType || 'BANK',
          initialBalance: processed.initialBalance || 0,
          wallets: processed.wallets,
          categories: processed.categories,
        },
        summaryText
      );
      return;
    }

    if (processed.actionType === 'UPDATE_WALLET') {
      const targetWallet = wallets.find((w) => w.id === processed.targetWalletId || w.name.toLowerCase() === (processed.walletName || '').toLowerCase()) || wallets[0];
      const newName = processed.newWalletName || targetWallet?.name;
      const summaryText =
        `📋 *Draf Pembaruan Nama Dompet:*\n` +
        `• *Dompet Lama*: ${targetWallet?.name}\n` +
        `• *Nama Baru*: ${newName}\n\n` +
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui:*`;

      await sendDraftWithButtons(
        ActionType.UPDATE_WALLET,
        {
          walletId: targetWallet.id,
          newName,
          newType: processed.newWalletType,
        },
        summaryText
      );
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
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui transfer ini:*`;

      await sendDraftWithButtons(
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
      return;
    }

    if (processed.actionType === 'SET_BUDGET') {
      const hasBatchCategories = Array.isArray(processed.categories) && processed.categories.length > 0;
      const hasBatchWallets = Array.isArray(processed.wallets) && processed.wallets.length > 0;

      let summaryText = '';
      if (hasBatchCategories || hasBatchWallets) {
        summaryText = `📋 *Draf Penambahan Pos Keuangan:*\n`;
        if (hasBatchCategories) {
          summaryText += `\n🏷️ *Kategori Baru (${processed.categories!.length}):*\n`;
          processed.categories!.forEach((c, i) => {
            summaryText += `${i + 1}. ${c.name}${c.monthlyBudget ? ` (Budget: Rp ${c.monthlyBudget.toLocaleString('id-ID')})` : ''}\n`;
          });
        }
        if (hasBatchWallets) {
          summaryText += `\n💳 *Dompet Baru (${processed.wallets!.length}):*\n`;
          processed.wallets!.forEach((w, i) => {
            summaryText += `${i + 1}. ${w.name} (${w.type || 'CASH'} - Saldo: Rp ${(w.initialBalance || 0).toLocaleString('id-ID')})\n`;
          });
        }
        summaryText += `\n👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui sekaligus:* `;
      } else {
        const targetCat = categories.find((c) => c.id === processed.categoryId || c.name.toLowerCase() === (processed.categoryName || '').toLowerCase());
        const catName = targetCat?.name || processed.categoryName || 'Kategori';
        const monthlyBudget = processed.monthlyBudget || 0;

        summaryText =
          `📋 *Draf Pengaturan Anggaran (Budget):*\n` +
          `• *Kategori*: ${catName}\n` +
          `• *Batas Anggaran Bulanan*: Rp ${monthlyBudget.toLocaleString('id-ID')}\n` +
          `• *Peringatan Guardrail*: 80% kuota\n\n` +
          `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui anggaran ini:*`;
      }

      await sendDraftWithButtons(
        ActionType.SET_BUDGET,
        {
          categoryId: processed.categoryId,
          categoryName: processed.categoryName,
          monthlyBudget: processed.monthlyBudget,
          alertThreshold: 80,
          categories: processed.categories,
          wallets: processed.wallets,
        },
        summaryText
      );
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
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui pembuatan pos tabungan ini:*`;

      await sendDraftWithButtons(
        ActionType.CREATE_SINKING_FUND,
        {
          name: processed.sinkingFundName,
          targetAmount: processed.targetAmount || 0,
          monthlyAlloc: processed.monthlyAlloc || 0,
          sourceWalletId: processed.sourceWalletId || defaultWallet?.id,
        },
        summaryText
      );
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
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui jadwal tagihan ini:*`;

      await sendDraftWithButtons(
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
      return;
    }

    if (processed.actionType === 'SET_DEFAULT_WALLET') {
      const targetWallet = wallets.find((w) => w.id === processed.targetWalletId || w.name.toLowerCase() === (processed.walletName || '').toLowerCase()) || wallets[0];
      const summaryText =
        `📋 *Draf Pengaturan Dompet Default Pengeluaran:*\n` +
        `• *Dompet*: ${targetWallet?.name}\n\n` +
        `Jika disetujui, setiap pengeluaran baru yang tidak menyebutkan dompet akan otomatis dialokasikan ke *${targetWallet?.name}*.\n\n` +
        `👉 *Ketuk tombol di bawah atau balas "Ya" untuk menyetujui:*`;

      await sendDraftWithButtons(
        ActionType.SET_DEFAULT_WALLET,
        {
          targetWalletId: targetWallet.id,
          walletName: targetWallet.name,
        },
        summaryText
      );
      return;
    }

    // 10. Jika berupa Pencatatan Transaksi Baru (CREATE_TRANSACTION)
    if (!processed.amount || processed.amount <= 0) {
      await ctx.reply('Mohon maaf Kak, Monee belum bisa membaca nominalnya dengan jelas. Boleh disebutkan kembali keperluan dan nominalnya ya Kak? 😊');
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
        `📋 *Draf Pencatatan dari Monee (${processed.items!.length} Item Terpisah):*\n` +
        itemsList +
        `\n\n• *Total*: Rp ${processed.amount.toLocaleString('id-ID')}\n` +
        `• *Tanggal Transaksi*: ${dateDisplay}\n` +
        `• *Dompet*: ${targetWallet?.name || 'Utama'}\n` +
        `• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n` +
        `👉 *Ketuk tombol di bawah atau balas "Ya" jika sudah sesuai ya Kak:*`;
    } else {
      summaryText =
        `📋 *Draf Pencatatan dari Monee:*\n` +
        `• *Keperluan*: ${processed.description}\n` +
        `• *Total*: Rp ${processed.amount.toLocaleString('id-ID')}\n` +
        `• *Tanggal Transaksi*: ${dateDisplay}\n` +
        `• *Dompet*: ${targetWallet?.name || 'Utama'}\n` +
        `• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n` +
        `👉 *Ketuk tombol di bawah atau balas "Ya" jika sudah sesuai ya Kak:*`;
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

    await sendDraftWithButtons(
      ActionType.CREATE_TRANSACTION,
      proposedPayload,
      summaryText
    );
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
