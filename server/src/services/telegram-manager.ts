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

    // 3. Ambil context Dompet & Kategori keluarga
    const [wallets, categories] = await Promise.all([
      prisma.wallet.findMany({
        where: { familyId },
        select: { id: true, name: true, type: true },
      }),
      prisma.category.findMany({
        where: { familyId },
        select: { id: true, name: true },
      }),
    ]);

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

    // 6. Ekstraksi dengan AI (hanya menggunakan dompet & kategori keluarga ini)
    const extracted = await LLMProviderService.extractTransaction({
      familyId,
      rawText: textContent,
      imageBase64,
      imageMimeType: 'image/jpeg',
      audioBase64,
      audioMimeType: 'audio/ogg',
      contextWallets: wallets,
      contextCategories: categories,
    });

    if (extracted.amount <= 0) {
      await ctx.reply('Mohon maaf, nominal pengeluaran belum terbaca dengan jelas. Bisa disebutkan kembali keperluan dan nominalnya?');
      return;
    }

    // 7. Buat draf persetujuan (Human-in-the-Loop)
    const proposedPayload = {
      walletId: extracted.walletId,
      categoryId: extracted.categoryId,
      amount: extracted.amount,
      description: extracted.description,
      type: extracted.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      inputSource: imageBase64 ? InputSource.TELEGRAM_IMAGE_RECEIPT : audioBase64 ? InputSource.TELEGRAM_VOICE_NOTE : InputSource.TELEGRAM_TEXT,
      items: extracted.items,
    };

    const targetWallet = wallets.find((w) => w.id === extracted.walletId);
    const targetCategory = categories.find((c) => c.id === extracted.categoryId);

    const summaryText =
      `📋 *Draf Pencatatan Ditemukan:*\n` +
      `• *Keperluan*: ${extracted.description}\n` +
      `• *Total*: Rp ${extracted.amount.toLocaleString('id-ID')}\n` +
      `• *Dompet*: ${targetWallet?.name || 'Utama'}\n` +
      `• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n` +
      `👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;

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
