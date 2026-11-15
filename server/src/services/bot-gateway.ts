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
import { FinancialReportsService } from './financial-reports.js';
import { TimezoneService } from './timezone-service.js';
import { normalizeBaileysSender, normalizePhone } from '../utils/phone.js';
import { ActionType, InputSource, TransactionType, BotChatPlatform, BotChatStatus } from '@prisma/client';

export class BotGateway {
  private static waSock: any = null;
  public static latestWaQrCode: string | null = null;
  public static isWaConnected: boolean = false;
  private static sentMessageIds: Set<string> = new Set();

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
        if (!msg.message) continue;
        // Abaikan pesan yang baru saja dikirim oleh bot Monee sendiri
        if (msg.key.id && this.sentMessageIds.has(msg.key.id)) continue;
        
        // Jika dari akun bot sendiri (fromMe)
        if (msg.key.fromMe) {
          const myJid = sock.user?.id?.split(':')[0];
          const targetJid = msg.key.remoteJid?.split(':')[0]?.replace('@s.whatsapp.net', '');
          // Izinkan jika pesan dikirim ke diri sendiri (Note to Self / chat ke nomor bot sendiri)
          if (myJid && targetJid && myJid !== targetJid) {
            continue;
          }
        }

        await this.handleIncomingWhatsAppMessage(msg);
      }
    });
  }

  /**
   * Catat riwayat chat bot AI ke database
   */
  static async logChatMessage(data: {
    familyId?: string;
    userId?: string;
    platform: BotChatPlatform;
    senderIdentifier: string;
    senderName?: string;
    messageType?: string;
    rawContent: string;
    replyContent?: string;
    status: BotChatStatus;
    metadata?: any;
  }) {
    try {
      return await prisma.botChatMessage.create({
        data: {
          familyId: data.familyId,
          userId: data.userId,
          platform: data.platform,
          senderIdentifier: data.senderIdentifier,
          senderName: data.senderName,
          messageType: data.messageType || 'text',
          rawContent: data.rawContent || '',
          replyContent: data.replyContent || null,
          status: data.status,
          metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        },
      });
    } catch (e) {
      console.error('Gagal mencatat riwayat chat bot:', e);
      return null;
    }
  }

  /**
   * Resolusi identitas pengguna dari WhatsApp (Mendukung Phone Number, JID, WhatsApp Multi-Device LID, dan PushName Auto-Discovery)
   */
  private static async resolveUserFromWhatsApp(
    cleanJid: string,
    phoneNumber: string,
    msg?: proto.IWebMessageInfo
  ) {
    const rawId = cleanJid.split('@')[0];
    const localPhone = phoneNumber.startsWith('62') ? phoneNumber.slice(2) : phoneNumber;
    const suffix = phoneNumber.length >= 8 ? phoneNumber.slice(-8) : phoneNumber;

    // 1. Ekstraksi dari Sender/Participant Phone Number metadata Baileys jika ada (senderPn / participantPn)
    const key = msg?.key as any;
    const senderPn = key?.senderPn || key?.participantPn || (msg as any)?.stanza?.attrs?.sender_pn;
    if (senderPn) {
      const normPn = normalizePhone(senderPn);
      if (normPn.cleanDigits) {
        const userByPn = await prisma.user.findFirst({
          where: {
            OR: [
              { whatsappNumber: normPn.cleanDigits },
              { whatsappNumber: `0${normPn.cleanDigits}` },
              { whatsappNumber: `62${normPn.cleanDigits}` },
              { whatsappNumber: { endsWith: normPn.cleanDigits.slice(-8) } },
              { whatsappJid: { contains: normPn.cleanDigits } },
            ],
          },
          include: { family: true },
        });

        if (userByPn) {
          try {
            await prisma.botWhitelist.upsert({
              where: {
                familyId_platform_identifier: {
                  familyId: userByPn.familyId,
                  platform: 'WHATSAPP',
                  identifier: rawId,
                },
              },
              update: { name: userByPn.name },
              create: {
                familyId: userByPn.familyId,
                platform: 'WHATSAPP',
                identifier: rawId,
                name: userByPn.name,
              },
            });
          } catch (_) {}
          return userByPn;
        }
      }
    }

    // 2. Pencarian Langsung di Tabel User
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { whatsappJid: cleanJid },
          { whatsappJid: `${phoneNumber}@s.whatsapp.net` },
          { whatsappJid: `${rawId}@lid` },
          { whatsappNumber: phoneNumber },
          { whatsappNumber: localPhone },
          { whatsappNumber: `0${localPhone}` },
          { whatsappNumber: { endsWith: suffix } },
        ],
      },
      include: {
        family: true,
      },
    });

    if (user) return user;

    // 3. Pencarian di Tabel BotWhitelist
    const whitelistEntry = await prisma.botWhitelist.findFirst({
      where: {
        platform: 'WHATSAPP',
        OR: [
          { identifier: cleanJid },
          { identifier: `${phoneNumber}@s.whatsapp.net` },
          { identifier: `${rawId}@lid` },
          { identifier: rawId },
          { identifier: phoneNumber },
          { identifier: localPhone },
          { identifier: `0${localPhone}` },
          { identifier: { contains: suffix } },
          { identifier: { contains: rawId } },
        ],
      },
      include: {
        family: {
          include: {
            users: true,
          },
        },
      },
    });

    if (whitelistEntry && whitelistEntry.family && whitelistEntry.family.users.length > 0) {
      return whitelistEntry.family.users[0] as any;
    }

    // 4. Resolusi Dinamis WhatsApp LID via USync Query (sock.onWhatsApp)
    if (this.waSock && (cleanJid.includes('@lid') || phoneNumber.length > 13)) {
      try {
        const candidateUsers = await prisma.user.findMany({
          where: { whatsappNumber: { not: null } },
          include: { family: true },
        });

        for (const cand of candidateUsers) {
          if (!cand.whatsappNumber) continue;
          const norm = normalizePhone(cand.whatsappNumber);
          if (!norm.fullNumber) continue;

          try {
            const results = await this.waSock.onWhatsApp(norm.fullNumber);
            if (results && results.length > 0) {
              const match = results.find(
                (r: any) =>
                  r.lid &&
                  (r.lid.includes(rawId) ||
                    r.lid.includes(phoneNumber) ||
                    r.lid.split('@')[0]?.split(':')[0] === rawId)
              );
              if (match) {
                console.log(`[WA Gateway] Auto-resolved LID ${cleanJid} to user ${cand.name} (${norm.fullNumber})!`);
                await prisma.botWhitelist.upsert({
                  where: {
                    familyId_platform_identifier: {
                      familyId: cand.familyId,
                      platform: 'WHATSAPP',
                      identifier: rawId,
                    },
                  },
                  update: { name: cand.name },
                  create: {
                    familyId: cand.familyId,
                    platform: 'WHATSAPP',
                    identifier: rawId,
                    name: cand.name,
                  },
                });
                return cand;
              }
            }
          } catch (_) {}
        }
      } catch (err) {
        console.warn('[WA Gateway] USync lookup warning:', err);
      }
    }

    // 5. Fallback Auto-Discovery berdasarkan PushName dan Email / Nama Pengguna
    if (msg?.pushName) {
      const pushNameStr = String(msg.pushName).trim();
      const cleanPush = pushNameStr.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (cleanPush.length >= 4) {
        const matchedUser = await prisma.user.findFirst({
          where: {
            OR: [
              { name: { contains: pushNameStr, mode: 'insensitive' } },
              { email: { startsWith: cleanPush, mode: 'insensitive' } },
            ],
          },
          include: { family: true },
        });

        if (matchedUser) {
          console.log(`[WA Gateway] Auto-matched user by pushName '${pushNameStr}' -> ${matchedUser.name}`);
          try {
            await prisma.botWhitelist.upsert({
              where: {
                familyId_platform_identifier: {
                  familyId: matchedUser.familyId,
                  platform: 'WHATSAPP',
                  identifier: rawId,
                },
              },
              update: { name: `${matchedUser.name} (${pushNameStr})` },
              create: {
                familyId: matchedUser.familyId,
                platform: 'WHATSAPP',
                identifier: rawId,
                name: `${matchedUser.name} (${pushNameStr})`,
              },
            });
          } catch (_) {}
          return matchedUser;
        }
      }
    }

    return null;
  }

  /**
   * Pemrosesan Pesan Masuk WhatsApp (Strict Whitelist Protected dengan Auto-Guide & Chat History)
   */
  private static async handleIncomingWhatsAppMessage(msg: proto.IWebMessageInfo) {
    const rawRemoteJid = msg.key.remoteJid;
    if (!rawRemoteJid || rawRemoteJid.includes('@g.us')) return; // Prioritaskan direct message

    const { cleanJid, phoneNumber } = normalizeBaileysSender(rawRemoteJid);
    const msgType = Object.keys(msg.message || {})[0] || 'conversation';
    const textContent =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    let user: any = null;

    try {
      // 1. Cek Whitelist: User terdaftar di database
      user = await this.resolveUserFromWhatsApp(cleanJid, phoneNumber, msg);

      // JIKA TIDAK ADA DI WHITELIST:
      // Jangan silent drop! Beri tahu pengguna bahwa nomornya belum terdaftar dan catat ke riwayat chat.
      if (!user) {
        console.log(`[WA Whitelist Guard] Pesan dari ${cleanJid} (${phoneNumber}) diabaikan (belum terdaftar).`);

        const pushGreeting = msg.pushName ? ` ${msg.pushName}` : '';
        const unwhitelistedReply =
          `Halo Kak${pushGreeting}! 👋\n\n` +
          `Nomor / Akun WhatsApp ini (*+${phoneNumber}*) belum terhubung ke keluarga aktif di aplikasi *Ini Uangku*.\n\n` +
          `👉 *Cara Menghubungkan 1-Klik:*\n` +
          `Buka aplikasi *Ini Uangku* -> Klik menu *Bot Status* -> Tab *Riwayat Chat AI* -> Klik tombol *⚡ Tautkan ID Ini ke Akun Saya*!\n\n` +
          `👉 *Atau Melalui Edit Profil:*\n` +
          `Masuk ke aplikasi di menu *Edit Profil*, lalu simpan nomor WhatsApp Kakak (*${phoneNumber.startsWith('62') ? '0' + phoneNumber.slice(2) : phoneNumber}*).\n\n` +
          `Setelah terhubung, Monee langsung siap membantu mencatat nota, voice note, dan konsultasi keuangan keluarga Kakak! 🎀`;

        await this.logChatMessage({
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber || cleanJid,
          senderName: (msg.pushName as string) || 'Pengguna Tidak Dikenal',
          messageType: msgType === 'imageMessage' ? 'image' : msgType === 'audioMessage' ? 'audio' : 'text',
          rawContent: textContent || `[Media: ${msgType}]`,
          replyContent: unwhitelistedReply,
          status: BotChatStatus.BLOCKED_NOT_WHITELISTED,
          metadata: { cleanJid, phoneNumber, rawRemoteJid },
        });

        await this.sendWhatsAppMessage(cleanJid, unwhitelistedReply);
        return;
      }

      const familyId = user.familyId;

      // 2. Cek apakah pesan adalah persetujuan untuk Draf yang sedang aktif
      const activePending = await ApprovalEngine.getActivePendingAction(user.id);
      if (activePending && textContent) {
        const response = await ApprovalEngine.processResponse(user.id, textContent);
        if (response.status === 'APPROVED' || response.status === 'REJECTED') {
          let replyMsg = response.message;
          if (response.alert) {
            replyMsg += `\n\n${response.alert}`;
          }
          await this.logChatMessage({
            familyId,
            userId: user.id,
            platform: BotChatPlatform.WHATSAPP,
            senderIdentifier: phoneNumber,
            senderName: user.name,
            messageType: 'text',
            rawContent: textContent,
            replyContent: replyMsg,
            status: BotChatStatus.SUCCESS,
            metadata: { pendingActionId: activePending.id, status: response.status },
          });
          await this.sendWhatsAppMessage(cleanJid, replyMsg);
          return;
        }
      }

      // 2.5 Quick Commands Finansial (/saldo, /hariini, /kemarin, /bulanini, /sinkingfund, /tagihan, /help)
      const trimmedLower = textContent.trim().toLowerCase();
      if (trimmedLower === '/saldo' || trimmedLower === 'saldo') {
        const report = await FinancialReportsService.getSaldoReport(familyId);
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/hariini' || trimmedLower === 'hari ini' || trimmedLower === '/hari_ini') {
        const report = await FinancialReportsService.getHariIniReport(familyId);
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/kemarin' || trimmedLower === 'kemarin') {
        const report = await FinancialReportsService.getKemarinReport(familyId);
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/bulanini' || trimmedLower === 'bulan ini' || trimmedLower === '/bulan_ini') {
        const report = await FinancialReportsService.getBulanIniReport(familyId);
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/sinkingfund' || trimmedLower === 'sinking fund' || trimmedLower === '/tabungan' || trimmedLower === 'tabungan') {
        const report = await FinancialReportsService.getSinkingFundReport(familyId);
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/tagihan' || trimmedLower === 'tagihan' || trimmedLower === '/bills') {
        const report = await FinancialReportsService.getTagihanReport(familyId);
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/help' || trimmedLower === '/bantuan' || trimmedLower === 'bantuan' || trimmedLower === 'help' || trimmedLower === '/start') {
        const report = FinancialReportsService.getHelpMessage();
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
      }
      if (trimmedLower === '/help' || trimmedLower === '/bantuan' || trimmedLower === 'bantuan' || trimmedLower === 'help' || trimmedLower === '/start') {
        const report = FinancialReportsService.getHelpMessage();
        await this.logChatMessage({
          familyId,
          userId: user.id,
          platform: BotChatPlatform.WHATSAPP,
          senderIdentifier: phoneNumber,
          senderName: user.name,
          messageType: 'text',
          rawContent: textContent,
          replyContent: report,
          status: BotChatStatus.CONSULTATION,
        });
        await this.sendWhatsAppMessage(cleanJid, report);
        return;
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

    let imageBase64: string | undefined = undefined;
    let audioBase64: string | undefined = undefined;

    // 4. Handle Media (Foto Nota / Tulisan Tangan Kertas / Voice Note)
    if (msgType === 'imageMessage') {
      await this.sendWhatsAppMessage(cleanJid, '🔍 Sedang membaca foto nota / tulisan tangan Anda dengan AI...');
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        imageBase64 = buffer.toString('base64');
      } catch (err) {
        console.error('Gagal mengunduh gambar WA:', err);
      }
    } else if (msgType === 'audioMessage') {
      await this.sendWhatsAppMessage(cleanJid, '🎙️ Sedang mendengarkan rekaman suara Anda...');
      try {
        const buffer = await downloadMediaMessage(msg, 'buffer', {});
        audioBase64 = buffer.toString('base64');
      } catch (err) {
        console.error('Gagal mengunduh audio WA:', err);
      }
    }

    if (!textContent && !imageBase64 && !audioBase64) return;

    // 5. Analisa Cerdas dengan AI (Kesadaran Waktu, CRUD Transaksi & Manajemen Finansial Lengkap)
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

    // 6. Jika berupa Pertanyaan / Konsultasi Finansial
    if (processed.intent === 'FINANCIAL_CONSULTATION' && processed.replyText) {
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent || '[Konsultasi Finansial]',
        replyContent: processed.replyText,
        status: BotChatStatus.CONSULTATION,
      });
      await this.sendWhatsAppMessage(cleanJid, processed.replyText);
      return;
    }

    // 7. Cabang berdasarkan Action Type Manajemen Keuangan:
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
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'UPDATE_TRANSACTION', target: processed.targetDescription },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
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
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'DELETE_TRANSACTION', target: processed.targetDescription },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
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
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'CREATE_WALLET', name: processed.walletName },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
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
          inputSource: InputSource.WHATSAPP_TEXT,
        },
        summaryText
      );
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'TRANSFER_WALLET', amount: numAmount },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
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
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'SET_BUDGET', category: catName, budget: monthlyBudget },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
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
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'CREATE_SINKING_FUND', name: processed.sinkingFundName },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
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
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: 'text',
        rawContent: textContent,
        replyContent: summaryText,
        status: BotChatStatus.PENDING_APPROVAL,
        metadata: { actionType: 'CREATE_RECURRING_BILL', name: processed.billName },
      });
      await this.sendWhatsAppMessage(cleanJid, summaryText);
      return;
    }

    // 8. Jika berupa Pencatatan Transaksi Baru (CREATE_TRANSACTION)
    if (!processed.amount || processed.amount <= 0) {
      const clarifyText = 'Mohon maaf Kak, Monee belum bisa membaca nominalnya dengan jelas. Boleh disebutkan kembali keperluan dan nominalnya ya Kak? 😊';
      await this.logChatMessage({
        familyId,
        userId: user.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber,
        senderName: user.name,
        messageType: msgType,
        rawContent: textContent || '[Foto / Suara]',
        replyContent: clarifyText,
        status: BotChatStatus.CONSULTATION,
      });
      await this.sendWhatsAppMessage(cleanJid, clarifyText);
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
        `👉 *Balas "Ya" jika sudah sesuai ya Kak, atau ketik koreksi Anda.*`;
    } else {
      summaryText =
        `📋 *Draf Pencatatan dari Monee:*\n` +
        `• *Keperluan*: ${processed.description}\n` +
        `• *Total*: Rp ${processed.amount.toLocaleString('id-ID')}\n` +
        `• *Tanggal Transaksi*: ${dateDisplay}\n` +
        `• *Dompet*: ${targetWallet?.name || 'Utama'}\n` +
        `• *Kategori*: ${targetCategory?.name || 'Umum'}\n\n` +
        `👉 *Balas "Ya" jika sudah sesuai ya Kak, atau ketik koreksi Anda.*`;
    }

    const proposedPayload = {
      walletId: targetWallet.id,
      categoryId: targetCategory.id,
      amount: processed.amount,
      description: processed.description || 'Pengeluaran Rumah Tangga',
      type: processed.type === 'INCOME' ? TransactionType.INCOME : TransactionType.EXPENSE,
      transactionDate: effectiveDate,
      inputSource: imageBase64 ? InputSource.WHATSAPP_IMAGE_RECEIPT : audioBase64 ? InputSource.WHATSAPP_VOICE_NOTE : InputSource.WHATSAPP_TEXT,
      items: processed.items,
    };

    await ApprovalEngine.createPendingAction(
      familyId,
      user.id,
      ActionType.CREATE_TRANSACTION,
      proposedPayload,
      summaryText
    );

    await this.logChatMessage({
      familyId,
      userId: user.id,
      platform: BotChatPlatform.WHATSAPP,
      senderIdentifier: phoneNumber,
      senderName: user.name,
      messageType: imageBase64 ? 'image' : audioBase64 ? 'audio' : 'text',
      rawContent: textContent || (imageBase64 ? '[Foto Nota]' : '[Pesan Suara]'),
      replyContent: summaryText,
      status: BotChatStatus.PENDING_APPROVAL,
      metadata: { actionType: 'CREATE_TRANSACTION', amount: processed.amount, description: processed.description },
    });

    await this.sendWhatsAppMessage(cleanJid, summaryText);
    } catch (err: any) {
      console.error('❌ [BotGateway] Error handling incoming WhatsApp message:', err);
      const errReply = `Mohon maaf Kak, terjadi kendala saat Monee memproses pesan Anda: ${err?.message || 'Kesalahan sistem'}. Mohon coba lagi sesaat lagi ya Kak. 🎀`;
      await this.logChatMessage({
        familyId: user?.familyId,
        userId: user?.id,
        platform: BotChatPlatform.WHATSAPP,
        senderIdentifier: phoneNumber || cleanJid,
        senderName: user?.name || (msg.pushName as string) || 'Pengguna',
        messageType: msgType,
        rawContent: textContent || `[Media: ${msgType}]`,
        replyContent: errReply,
        status: BotChatStatus.ERROR,
        metadata: { error: String(err?.stack || err?.message || err) },
      });
      await this.sendWhatsAppMessage(cleanJid, errReply);
    }
  }

  /**
   * Kirim pesan teks WhatsApp ke nomor tertentu
   */
  static async sendWhatsAppMessage(jid: string, text: string) {
    if (!this.waSock || !this.isWaConnected) {
      console.warn('Tidak dapat mengirim pesan WhatsApp: Baileys socket tidak aktif.');
      return null;
    }
    try {
      const cleanTarget = jid.includes('@') ? jid.split(':')[0] + '@' + jid.split('@')[1] : `${jid}@s.whatsapp.net`;
      const sent = await this.waSock.sendMessage(cleanTarget, { text });
      if (sent?.key?.id) {
        this.sentMessageIds.add(sent.key.id);
        if (this.sentMessageIds.size > 200) {
          const first = this.sentMessageIds.values().next().value;
          if (first) this.sentMessageIds.delete(first);
        }
      }
      return sent;
    } catch (err) {
      console.error('Error sending WhatsApp message:', err);
      return null;
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
