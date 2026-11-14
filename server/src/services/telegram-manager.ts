import { Bot } from 'grammy';
import { prisma } from '../db.js';
import { LLMProviderService } from './llm-provider.js';
import { ApprovalEngine } from './approval-engine.js';
import { ActionType, InputSource, TransactionType } from '@prisma/client';

export class TelegramManager {
  private static activeBots: Map<string, Bot> = new Map();

  /**
   * Inisialisasi seluruh bot Telegram milik setiap keluarga saat server boot
   */
  static async initAll() {
    try {
      const families = await prisma.family.findMany({
        where: {
          telegramBotToken: { not: null },
        },
      });

      console.log(`🤖 Memulai ${families.length} bot Telegram mandiri keluarga...`);
      for (const fam of families) {
        if (fam.telegramBotToken) {
          await this.startFamilyBot(fam.id, fam.telegramBotToken).catch((err) => {
            console.error(`Gagal memulai bot Telegram untuk keluarga ${fam.name}:`, err.message);
          });
        }
      }
    } catch (err) {
      console.error('Error saat inisialisasi TelegramManager:', err);
    }
  }

  /**
   * Cek apakah bot Telegram keluarga sedang aktif
   */
  static isBotRunning(familyId: string): boolean {
    return this.activeBots.has(familyId);
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

    // 1. Validasi token dengan getMe()
    const me = await bot.api.getMe();
    const botUsername = me.username;

    // 2. Simpan token & username ke database
    await prisma.family.update({
      where: { id: familyId },
      data: {
        telegramBotToken: botToken.trim(),
        telegramBotUsername: botUsername,
      },
    });

    // 3. Listener /start
    bot.command('start', async (ctx) => {
      const chatId = String(ctx.from?.id);
      const family = await prisma.family.findUnique({
        where: { id: familyId },
        include: { users: true, whitelists: true },
      });

      if (!family) return;

      const isWhitelisted =
        family.users.some((u) => u.telegramChatId === chatId) ||
        family.whitelists.some((w) => w.platform === 'TELEGRAM' && w.identifier === chatId);

      if (!isWhitelisted) {
        await ctx.reply(
          `Halo ${ctx.from?.first_name || ''}! 👋\n\n` +
          `ID Telegram Anda adalah: \`${chatId}\`\n\n` +
          `⚠️ Anda *belum terdaftar* di whitelist keluarga *"${family.name}"*.\n` +
          `Silakan berikan ID Telegram ini kepada Manager keluarga untuk ditambahkan di aplikasi agar Anda bisa mencatat keuangan.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      await ctx.reply(
        `Halo ${ctx.from?.first_name || ''}! 🎀\n\n` +
        `Selamat datang di Bot Finansial Keluarga *"${family.name}"*.\n\n` +
        `Anda dapat:\n` +
        `• Mengirim pesan teks belanja (e.g. *"Beli beras 75rb bayar pake BCA"*)\n` +
        `• Mengirim foto nota / struk belanjaan\n` +
        `• Mengirim foto kotretan catatan belanja di kertas\n` +
        `• Mengirim voice note (rekaman suara)\n\n` +
        `Setiap draf yang dideteksi akan diajukan ke Anda terlebih dahulu untuk disetujui!`,
        { parse_mode: 'Markdown' }
      );
    });

    // 4. Listener pesan masuk
    bot.on(['message:text', 'message:photo', 'message:voice'], async (ctx) => {
      await this.handleIncomingMessage(familyId, ctx);
    });

    // 5. Jalankan polling
    bot.start({
      onStart: () => {
        console.log(`✅ Bot Telegram @${botUsername} aktif untuk keluarga ${familyId}!`);
      },
    });

    this.activeBots.set(familyId, bot);
    return { username: botUsername };
  }

  /**
   * Handle pesan masuk dari bot Telegram keluarga
   */
  private static async handleIncomingMessage(familyId: string, ctx: any) {
    const chatId = String(ctx.from?.id);

    // Ambil data keluarga dan cek apakah chatId ada di whitelist
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      include: {
        users: true,
        whitelists: {
          where: { platform: 'TELEGRAM' },
        },
      },
    });

    if (!family) return;

    // Cari user yang bersangkutan
    let user = family.users.find((u) => u.telegramChatId === chatId);
    const whitelistEntry = family.whitelists.find((w) => w.identifier === chatId);

    // Jika tidak ada di user dan tidak ada di whitelist -> Silent Drop / Reject
    if (!user && !whitelistEntry) {
      await ctx.reply(
        `⚠️ ID Telegram Anda (\`${chatId}\`) belum terdaftar di whitelist keluarga "${family.name}". Hubungi Manager keluarga Anda untuk mendaftarkan ID ini.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Jika user belum memiliki record User utama, gunakan Manager atau User terdaftar pertama
    if (!user) {
      user = family.users[0];
    }
    if (!user) return;

    const textContent = ctx.message?.text || ctx.message?.caption || '';

    // Cek apakah pesan adalah persetujuan untuk Draf yang sedang aktif
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

    // Ambil context Dompet & Kategori keluarga
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

    // Handle Foto (Struk / Kotretan Kertas)
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      await ctx.reply('🔍 Sedang membaca foto nota / tulisan tangan Anda dengan AI...');
      try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Resolusi tertinggi
        const file = await ctx.api.getFile(photo.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${family.telegramBotToken}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          imageBase64 = buf.toString('base64');
        }
      } catch (err) {
        console.error('Gagal mengunduh foto dari Telegram:', err);
      }
    }

    // Handle Voice Note
    if (ctx.message?.voice) {
      await ctx.reply('🎙️ Sedang mendengarkan pesan suara Anda...');
      try {
        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        if (file.file_path) {
          const fileUrl = `https://api.telegram.org/file/bot${family.telegramBotToken}/${file.file_path}`;
          const res = await fetch(fileUrl);
          const buf = Buffer.from(await res.arrayBuffer());
          audioBase64 = buf.toString('base64');
        }
      } catch (err) {
        console.error('Gagal mengunduh voice note dari Telegram:', err);
      }
    }

    if (!textContent && !imageBase64 && !audioBase64) return;

    // Ekstraksi dengan AI
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

    // Buat draf persetujuan (Human-in-the-Loop)
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
   * Kirim pesan ke chatId pengguna melalui bot Telegram milik keluarga tertentu
   */
  static async sendMessage(familyId: string, chatId: string, text: string) {
    const bot = this.activeBots.get(familyId);
    if (!bot) {
      console.warn(`Bot Telegram untuk keluarga ${familyId} tidak aktif.`);
      return;
    }

    try {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error(`Gagal mengirim pesan Telegram ke ${chatId}:`, err.message);
    }
  }
}
