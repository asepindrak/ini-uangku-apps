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
  public static latestWaQrCode: string | null = null;
  public static isWaConnected: boolean = false;

  /**
   * Inisialisasi Gateway WhatsApp (Baileys)
   */
  static async init() {
    await this.initWhatsApp();
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
   * Pemrosesan Pesan Masuk WhatsApp (Strict Whitelist Protected)
   */
  private static async handleIncomingWhatsAppMessage(msg: proto.IWebMessageInfo) {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.includes('@g.us')) return; // Prioritaskan direct message

    // Format nomor WhatsApp (e.g. 628123456789)
    const phoneNumber = remoteJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    // 1. Cek Whitelist: User terdaftar di database
    let user = await prisma.user.findFirst({
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

    // Jika tidak ditemukan di User, periksa tabel BotWhitelist (platform WHATSAPP)
    if (!user) {
      const whitelistEntry = await prisma.botWhitelist.findFirst({
        where: {
          platform: 'WHATSAPP',
          identifier: { contains: phoneNumber.slice(-10) },
        },
        include: {
          family: {
            include: {
              users: true,
            },
          },
        },
      });

      if (whitelistEntry && whitelistEntry.family.users.length > 0) {
        user = whitelistEntry.family.users[0] as any;
      }
    }

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

    // 3. Ambil context lengkap finansial keluarga (Dompet, Kategori, Transaksi Terkini, Ringkasan Bulanan)
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [wallets, categories, recentTransactions, monthlyAgg, sinkingFunds] = await Promise.all([
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
        take: 20,
        include: {
          wallet: { select: { name: true } },
          category: { select: { name: true } },
          user: { select: { name: true } },
        },
      }),
      prisma.transaction.groupBy({
        by: ['type'],
        where: { familyId, transactionDate: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.sinkingFund.findMany({
        where: { familyId, isActive: true },
        select: { name: true, currentAmount: true, targetAmount: true },
      }),
    ]);

    let totalExpense = 0;
    let totalIncome = 0;
    for (const g of monthlyAgg) {
      const sum = Number(g._sum.amount) || 0;
      if (g.type === 'EXPENSE') totalExpense += sum;
      if (g.type === 'INCOME') totalIncome += sum;
    }

    const formattedRecent = recentTransactions.map((t) => ({
      description: t.description,
      amount: Number(t.amount),
      type: t.type,
      date: t.transactionDate.toISOString().split('T')[0],
      walletName: t.wallet?.name || 'Dompet',
      categoryName: t.category?.name || 'Umum',
      userName: t.user?.name || 'Anggota',
    }));

    const formattedSinking = sinkingFunds.map((s) => ({
      name: s.name,
      currentAmount: Number(s.currentAmount),
      targetAmount: Number(s.targetAmount),
    }));

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

    // 5. Analisa Cerdas dengan AI (Deteksi Intensi: Konsultasi Keuangan vs Catat Transaksi)
    const processed = await LLMProviderService.processMessage({
      familyId,
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
      monthlySummary: {
        totalExpense,
        totalIncome,
        netBalance: totalIncome - totalExpense,
      },
      sinkingFunds: formattedSinking,
    });

    // 6. Jika berupa Pertanyaan / Konsultasi Finansial
    if (processed.intent === 'FINANCIAL_CONSULTATION' && processed.replyText) {
      await this.sendWhatsAppMessage(remoteJid, processed.replyText);
      return;
    }

    // 7. Jika berupa Pencatatan Transaksi Baru
    if (!processed.amount || processed.amount <= 0) {
      await this.sendWhatsAppMessage(
        remoteJid,
        'Mohon maaf, nominal pengeluaran belum terbaca dengan jelas. Bisa disebutkan kembali keperluan dan nominalnya?'
      );
      return;
    }

    // 8. Buat PendingAction & Minta Persetujuan (Human-in-the-Loop)
    const proposedPayload = {
      walletId: processed.walletId || wallets[0]?.id || '',
      categoryId: processed.categoryId || categories[0]?.id,
      amount: processed.amount,
      description: processed.description || 'Pengeluaran Rumah Tangga',
      type: processed.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      inputSource: imageBase64 ? InputSource.WHATSAPP_IMAGE_RECEIPT : audioBase64 ? InputSource.WHATSAPP_VOICE_NOTE : InputSource.WHATSAPP_TEXT,
      items: processed.items,
    };

    const targetWallet = wallets.find((w) => w.id === processed.walletId) || wallets[0];
    const targetCategory = categories.find((c) => c.id === processed.categoryId) || categories[0];

    const summaryText =
      `📋 *Draf Pencatatan Ditemukan:*\n` +
      `• *Keperluan*: ${processed.description}\n` +
      `• *Total*: Rp ${processed.amount.toLocaleString('id-ID')}\n` +
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

    await this.sendWhatsAppMessage(remoteJid, summaryText);
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
