import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  proto,
} from '@whiskeysockets/baileys';
import { Bot, InlineKeyboard } from 'grammy';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db.js';
import { LLMProviderService } from './llm-provider.js';
import { ApprovalEngine } from './approval-engine.js';
import { ActionType, InputSource, TransactionType } from '@prisma/client';

export class BotGateway {
  private static waSock: any = null;
  private static telegramBot: Bot | null = null;
  public static latestWaQrCode: string | null = null;
  public static isWaConnected: boolean = false;
  public static isTelegramConnected: boolean = false;

  /**
   * Inisialisasi Gateway WhatsApp (Baileys) dan Telegram
   */
  static async init() {
    await this.initWhatsApp();
    await this.initTelegram();
  }

  /**
   * Inisialisasi WhatsApp Web Socket dengan Baileys
   */
  static async initWhatsApp() {
    const authDir = process.env.BAILEYS_AUTH_DIR || './baileys_auth';
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    // 1. Auto-Restore sesi dari PostgreSQL jika folder lokal kosong
    await this.restoreAuthFromDB(authDir);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['Ini Uangku', 'Chrome', '1.0.0'],
    });

    this.waSock = sock;

    // Setiap kredensial diperbarui, simpan ke file lokal DAN backup otomatis ke PostgreSQL
    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await this.syncAuthToDB(authDir);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.latestWaQrCode = await qrcode.toDataURL(qr);
        console.log('📱 WhatsApp QR Code Siap di-scan:');
        qrcodeTerminal.generate(qr, { small: true });
      }

      if (connection === 'close') {
        this.isWaConnected = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️ Koneksi WhatsApp terputus (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(() => this.initWhatsApp(), 5000);
        }
      } else if (connection === 'open') {
        this.isWaConnected = true;
        this.latestWaQrCode = null;
        console.log('✅ WhatsApp Baileys terhubung dan siap melayani keluarga!');
        // Sinkronisasi seluruh token/keys ke database
        await this.syncAuthToDB(authDir);
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;
        await this.handleIncomingWhatsAppMessage(msg);
      }
    });
  }

  /**
   * Inisialisasi Telegram Bot via grammY
   */
  static async initTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.log('ℹ️ TELEGRAM_BOT_TOKEN belum diisi di .env. Telegram bot dilewati.');
      return;
    }

    try {
      const bot = new Bot(token);
      this.telegramBot = bot;

      bot.command('start', async (ctx) => {
        const chatId = String(ctx.from?.id);
        const user = await prisma.user.findFirst({
          where: { telegramChatId: chatId },
        });

        if (!user) {
          await ctx.reply(
            `Halo! ID Telegram Anda adalah: \`${chatId}\`\nNomor ini belum terdaftar di whitelist keluarga. Berikan ID ini kepada Manager keluarga Anda untuk ditambahkan ke aplikasi.`,
            { parse_mode: 'Markdown' }
          );
          return;
        }

        await ctx.reply(`Halo ${user.name}! 🎀\nBot Finansial Keluarga "Ini Uangku" siap membantu mencatat pengeluaran Anda.`);
      });

      bot.on('message:text', async (ctx) => {
        await this.handleIncomingTelegramMessage(ctx);
      });

      bot.on('message:photo', async (ctx) => {
        await this.handleIncomingTelegramMessage(ctx);
      });

      bot.on('message:voice', async (ctx) => {
        await this.handleIncomingTelegramMessage(ctx);
      });

      bot.start();
      this.isTelegramConnected = true;
      console.log('✅ Telegram Bot siap melayani keluarga!');
    } catch (err) {
      console.error('❌ Gagal menjalankan Telegram Bot:', err);
    }
  }

  /**
   * Pemrosesan Pesan Masuk WhatsApp (Strict Whitelist Protected)
   */
  private static async handleIncomingWhatsAppMessage(msg: proto.IWebMessageInfo) {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.includes('@g.us')) return; // Prioritaskan direct message

    // Format nomor WhatsApp (e.g. 628123456789)
    const phoneNumber = remoteJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    // 1. Cek Whitelist: User terdaftar di database
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { whatsappJid: remoteJid },
          { whatsappNumber: { contains: phoneNumber.slice(-10) } },
        ],
      },
      include: {
        family: true,
      },
    });

    // JIKA TIDAK ADA DI WHITELIST -> DROP PESAN SECARA DIAM-DIAM (SILENT DROP)
    if (!user) {
      console.log(`[WA Whitelist Guard] Pesan dari ${remoteJid} diabaikan (bukan anggota keluarga terdaftar).`);
      return;
    }

    const familyId = user.familyId;
    const msgType = Object.keys(msg.message || {})[0];
    const textContent =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    // 2. Cek apakah pesan adalah persetujuan untuk Draf yang sedang aktif
    const activePending = await ApprovalEngine.getActivePendingAction(user.id);
    if (activePending && textContent) {
      const response = await ApprovalEngine.processResponse(user.id, textContent);
      if (response.status === 'APPROVED' || response.status === 'REJECTED') {
        let replyMsg = response.message;
        if (response.alert) {
          replyMsg += `\n\n${response.alert}`;
        }
        await this.sendWhatsAppMessage(remoteJid, replyMsg);
        return;
      }
    }

    // 3. Ambil context Dompet & Kategori keluarga
    const wallets = await prisma.wallet.findMany({
      where: { familyId },
      select: { id: true, name: true, type: true },
    });
    const categories = await prisma.category.findMany({
      where: { familyId },
      select: { id: true, name: true },
    });

    let imageBase64: string | undefined = undefined;
    let audioBase64: string | undefined = undefined;

    // 4. Handle Media (Foto Nota / Tulisan Tangan Kertas / Voice Note)
    if (msgType === 'imageMessage') {
      await this.sendWhatsAppMessage(remoteJid, '🔍 Sedang membaca foto nota / tulisan tangan Anda dengan AI...');
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        imageBase64 = buffer.toString('base64');
      } catch (err) {
        console.error('Gagal mengunduh gambar WA:', err);
      }
    } else if (msgType === 'audioMessage') {
      await this.sendWhatsAppMessage(remoteJid, '🎙️ Sedang mendengarkan rekaman suara Anda...');
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        audioBase64 = buffer.toString('base64');
      } catch (err) {
        console.error('Gagal mengunduh audio WA:', err);
      }
    }

    if (!textContent && !imageBase64 && !audioBase64) return;

    // 5. Ekstraksi dengan AI Agent
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
      await this.sendWhatsAppMessage(
        remoteJid,
        'Mohon maaf, saya belum menemukan nominal pengeluaran yang jelas. Bisa sebutkan nominal dan keperluan belanjanya?'
      );
      return;
    }

    // 6. Buat PendingAction & Minta Persetujuan (Human-in-the-Loop)
    const proposedPayload = {
      walletId: extracted.walletId,
      categoryId: extracted.categoryId,
      amount: extracted.amount,
      description: extracted.description,
      type: extracted.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      inputSource: imageBase64 ? InputSource.WHATSAPP_IMAGE_RECEIPT : audioBase64 ? InputSource.WHATSAPP_VOICE_NOTE : InputSource.WHATSAPP_TEXT,
      items: extracted.items,
    };

    const targetWallet = wallets.find((w) => w.id === extracted.walletId);
    const targetCategory = categories.find((c) => c.id === extracted.categoryId);

    const summaryText = `📋 *Draf Pencatatan Ditemukan:*\n• *Keperluan*: ${extracted.description}\n• *Total*: Rp ${extracted.amount.toLocaleString('id-ID')}\n• *Dompet*: ${targetWallet?.name || 'Utama'}\n• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;

    await ApprovalEngine.createPendingAction(
      familyId,
      user.id,
      ActionType.CREATE_TRANSACTION,
      proposedPayload,
      summaryText
    );

    await this.sendWhatsAppMessage(remoteJid, summaryText);
  }

  /**
   * Pemrosesan Pesan Masuk Telegram
   */
  private static async handleIncomingTelegramMessage(ctx: any) {
    const chatId = String(ctx.from?.id);
    const user = await prisma.user.findFirst({
      where: { telegramChatId: chatId },
      include: { family: true },
    });

    if (!user) return; // Silent drop jika bukan whitelist

    const familyId = user.familyId;
    const textContent = ctx.message?.text || ctx.message?.caption || '';

    // Cek persetujuan aktif
    const activePending = await ApprovalEngine.getActivePendingAction(user.id);
    if (activePending && textContent) {
      const response = await ApprovalEngine.processResponse(user.id, textContent);
      if (response.status === 'APPROVED' || response.status === 'REJECTED') {
        let replyMsg = response.message;
        if (response.alert) replyMsg += `\n\n${response.alert}`;
        await ctx.reply(replyMsg);
        return;
      }
    }

    // Ambil context Dompet & Kategori keluarga
    const wallets = await prisma.wallet.findMany({
      where: { familyId },
      select: { id: true, name: true, type: true },
    });
    const categories = await prisma.category.findMany({
      where: { familyId },
      select: { id: true, name: true },
    });

    const extracted = await LLMProviderService.extractTransaction({
      familyId,
      rawText: textContent,
      contextWallets: wallets,
      contextCategories: categories,
    });

    if (extracted.amount <= 0) {
      await ctx.reply('Mohon maaf, nominal pengeluaran belum terbaca jelas. Mohon sebutkan nominal belanjanya.');
      return;
    }

    const proposedPayload = {
      walletId: extracted.walletId,
      categoryId: extracted.categoryId,
      amount: extracted.amount,
      description: extracted.description,
      type: extracted.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      inputSource: InputSource.TELEGRAM_TEXT,
      items: extracted.items,
    };

    const targetWallet = wallets.find((w) => w.id === extracted.walletId);
    const targetCategory = categories.find((c) => c.id === extracted.categoryId);

    const summaryText = `📋 *Draf Pencatatan Ditemukan:*\n• *Keperluan*: ${extracted.description}\n• *Total*: Rp ${extracted.amount.toLocaleString('id-ID')}\n• *Dompet*: ${targetWallet?.name || 'Utama'}\n• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;

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
   * Kirim pesan teks WhatsApp ke nomor tertentu
   */
  static async sendWhatsAppMessage(jid: string, text: string) {
    if (!this.waSock || !this.isWaConnected) {
      console.warn('Tidak dapat mengirim pesan WhatsApp: Baileys socket tidak aktif.');
      return;
    }
    try {
      await this.waSock.sendMessage(jid, { text });
    } catch (err) {
      console.error('Error sending WhatsApp message:', err);
    }
  }

  /**
   * Kirim pesan teks Telegram ke chatId tertentu
   */
  static async sendTelegramMessage(chatId: string, text: string) {
    if (!this.telegramBot) return;
    try {
      await this.telegramBot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error('Error sending Telegram message:', err);
    }
  }

  /**
   * Auto-Restore berkas auth Baileys dari PostgreSQL jika folder lokal kosong
   */
  private static async restoreAuthFromDB(authDir: string) {
    try {
      const credsFile = path.join(authDir, 'creds.json');
      if (!fs.existsSync(credsFile)) {
        const sessions = await prisma.botSession.findMany();
        if (sessions.length > 0) {
          console.log(`🔄 Memulihkan ${sessions.length} berkas sesi WhatsApp dari PostgreSQL...`);
          for (const s of sessions) {
            const filePath = path.join(authDir, s.key);
            fs.writeFileSync(filePath, s.data, 'utf-8');
          }
          console.log('✅ Sesi WhatsApp berhasil dipulihkan secara otomatis dari database!');
        }
      }
    } catch (err) {
      console.warn('Gagal memulihkan sesi dari DB:', err);
    }
  }

  /**
   * Auto-Backup / Sinkronisasi berkas auth Baileys ke PostgreSQL
   */
  private static async syncAuthToDB(authDir: string) {
    try {
      if (!fs.existsSync(authDir)) return;
      const files = fs.readdirSync(authDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const filePath = path.join(authDir, file);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          await prisma.botSession.upsert({
            where: { key: file },
            create: { key: file, data: content },
            update: { data: content },
          });
        }
      }
    } catch (err) {
      console.warn('Gagal menyinkronkan sesi ke DB:', err);
    }
  }
}
