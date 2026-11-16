import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  Browsers,
  proto,
} from '@whiskeysockets/baileys';
import { Bot, InlineKeyboard } from 'grammy';
import sharp from 'sharp';
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
  public static lastSendError: string | null = null;
  private static sentMessageIds: Set<string> = new Set();
  private static sentMessageStore = new Map<string, any>();
  private static syncAuthTimer: NodeJS.Timeout | null = null;

  // External Retry Counter Cache untuk mencegah pesan 'Menunggu pesan ini' / Decryption Loop
  private static msgRetryCounterCache = {
    store: new Map<string, number>(),
    get(key: string): number | undefined {
      return this.store.get(key);
    },
    set(key: string, value: number) {
      this.store.set(key, value);
    },
    del(key: string) {
      this.store.delete(key);
    },
    flushAll() {
      this.store.clear();
    },
  };

  // Bi-directional In-Memory Cache: WhatsApp Multi-Device LID (@lid) <-> Real Phone JID (@s.whatsapp.net)
  private static lidToJidMap = new Map<string, string>();
  private static jidToLidMap = new Map<string, string>();

  /**
   * Simpan pemetaan nomor telepon WhatsApp asli dengan LID akun
   */
  public static saveLidMapping(lid: string, jidOrPn: string) {
    if (!lid || !jidOrPn) return;
    const cleanLid = lid.split('@')[0]?.split(':')[0];
    const norm = normalizePhone(jidOrPn);
    const cleanPnJid = norm.whatsappJid || (jidOrPn.includes('@') ? jidOrPn : `${jidOrPn}@s.whatsapp.net`);

    if (cleanLid && cleanPnJid) {
      const fullLid = `${cleanLid}@lid`;
      this.lidToJidMap.set(cleanLid, cleanPnJid);
      this.lidToJidMap.set(fullLid, cleanPnJid);
      this.jidToLidMap.set(cleanPnJid, fullLid);
      if (norm.cleanDigits) {
        this.jidToLidMap.set(norm.cleanDigits, fullLid);
      }
    }
  }

  /**
   * Pra-sinkronisasi LID seluruh keluarga terdaftar langsung dari WhatsApp Server & Database
   */
  public static async syncFamilyLids() {
    if (!this.waSock || !this.isWaConnected) return;
    try {
      // 1. Baca whitelist yang memiliki platform WHATSAPP
      const whitelists = await prisma.botWhitelist.findMany({
        where: { platform: 'WHATSAPP' },
        include: { family: { include: { users: true } } },
      });
      for (const w of whitelists) {
        if (w.identifier && w.family?.users?.[0]?.whatsappNumber) {
          const userPhone = w.family.users[0].whatsappNumber;
          const norm = normalizePhone(userPhone);
          if (w.identifier.includes('@lid') || /^\d{13,}$/.test(w.identifier)) {
            this.saveLidMapping(w.identifier, norm.whatsappJid);
          }
        }
      }

      // 2. Query USync onWhatsApp untuk semua user yang terdaftar
      const candidateUsers = await prisma.user.findMany({
        where: { whatsappNumber: { not: null } },
        include: { family: true },
      });

      for (const u of candidateUsers) {
        if (!u.whatsappNumber) continue;
        const norm = normalizePhone(u.whatsappNumber);
        if (!norm.fullNumber) continue;

        try {
          const results = await this.waSock.onWhatsApp(norm.fullNumber);
          if (results && results.length > 0) {
            for (const r of results) {
              if (r.lid) {
                console.log(`[WA Gateway] Auto-synced user ${u.name}: LID ${r.lid} <-> Phone JID ${norm.whatsappJid}`);
                this.saveLidMapping(r.lid, norm.whatsappJid);

                await prisma.botWhitelist.upsert({
                  where: {
                    familyId_platform_identifier: {
                      familyId: u.familyId,
                      platform: 'WHATSAPP',
                      identifier: r.lid.split('@')[0]?.split(':')[0],
                    },
                  },
                  update: { name: u.name },
                  create: {
                    familyId: u.familyId,
                    platform: 'WHATSAPP',
                    identifier: r.lid.split('@')[0]?.split(':')[0],
                    name: u.name,
                  },
                });
              }
            }
          }
        } catch (_) { }
      }
    } catch (err) {
      console.warn('[WA Gateway] syncFamilyLids warning:', err);
    }
  }

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

    // Tutup socket lama secara bersih jika sudah ada
    if (this.waSock) {
      try {
        this.waSock.ev.removeAllListeners('connection.update');
        this.waSock.ev.removeAllListeners('messages.upsert');
        this.waSock.ev.removeAllListeners('creds.update');
        this.waSock.end(undefined);
      } catch (_) { }
      this.waSock = null;
    }

    // 1. Auto-Restore sesi dari PostgreSQL jika folder lokal kosong
    await this.restoreAuthFromDB(authDir);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      markOnlineOnConnect: true,
      msgRetryCounterCache: this.msgRetryCounterCache as any,
      getMessage: async (key: proto.IMessageKey) => {
        // Layani permintaan retry receipt dari ponsel pengguna jika terjadi desync
        if (key.id && this.sentMessageStore.has(key.id)) {
          return this.sentMessageStore.get(key.id);
        }
        try {
          if (key.id) {
            const dbMsg = await prisma.botChatMessage.findFirst({
              where: {
                OR: [
                  { metadata: { contains: key.id } },
                  { id: key.id }
                ]
              }
            });
            if (dbMsg?.replyContent) {
              return {
                conversation: dbMsg.replyContent,
              };
            }
          }
        } catch (_) { }
        return proto.Message.fromObject({});
      },
    });

    this.waSock = sock;

    // Setiap kredensial diperbarui, simpan ke file lokal DAN backup cepat creds.json ke PostgreSQL
    sock.ev.on('creds.update', async () => {
      await saveCreds();
      await this.syncCredsToDB(authDir);
      this.scheduleDebouncedSyncAuth(authDir);
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
        // Pre-sync seluruh LID keluarga terdaftar
        await this.syncFamilyLids();
      }
    });

    // Tangkap sinkronisasi nomor telepon resmi dari Baileys (chats.phoneNumberShare & contacts)
    sock.ev.on('chats.phoneNumberShare', ({ lid, jid }: any) => {
      console.log(`[WA Gateway] chats.phoneNumberShare event: LID ${lid} <-> JID ${jid}`);
      this.saveLidMapping(lid, jid);
    });

    sock.ev.on('contacts.upsert', (contacts: any[]) => {
      for (const c of contacts) {
        if (c.lid && (c.jid || c.id?.endsWith('@s.whatsapp.net'))) {
          this.saveLidMapping(c.lid, c.jid || c.id);
        }
      }
    });

    sock.ev.on('contacts.update', (updates: any[]) => {
      for (const c of updates) {
        if (c.lid && (c.jid || c.id?.endsWith('@s.whatsapp.net'))) {
          this.saveLidMapping(c.lid, c.jid || c.id);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (!msg.message) continue;
        // Abaikan pesan yang baru saja dikirim oleh bot Monee sendiri
        if (msg.key.id && this.sentMessageIds.has(msg.key.id)) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) continue;

        // Abaikan status WhatsApp (Story), broadcast list, newsletter (channel), dan grup
        if (
          remoteJid === 'status@broadcast' ||
          remoteJid.endsWith('@broadcast') ||
          remoteJid.endsWith('@newsletter') ||
          remoteJid.includes('@g.us')
        ) {
          continue;
        }

        // Tangkap mapping LID jika pesan menyertakan senderPn / participantPn
        const senderPn = (msg.key as any).senderPn || (msg.key as any).participantPn;
        if (remoteJid.endsWith('@lid') && senderPn) {
          this.saveLidMapping(remoteJid, senderPn);
        }

        // Jika dari akun bot sendiri (fromMe)
        if (msg.key.fromMe) {
          const myJid = sock.user?.id?.split(':')[0]?.replace(/[^0-9]/g, '');
          const targetJid = remoteJid.split('@')[0]?.split(':')[0]?.replace(/[^0-9]/g, '');
          // Hanya izinkan jika benar-benar Note to Self (chat ke nomor bot sendiri)
          if (!myJid || !targetJid || myJid !== targetJid) {
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
    if (
      !cleanJid ||
      cleanJid === 'status@broadcast' ||
      cleanJid.endsWith('@broadcast') ||
      cleanJid.endsWith('@newsletter')
    ) {
      return null;
    }

    const rawId = cleanJid.split('@')[0];
    const localPhone = phoneNumber.startsWith('62') ? phoneNumber.slice(2) : phoneNumber;
    const suffix = phoneNumber.length >= 8 ? phoneNumber.slice(-8) : '';

    // 0. Cek In-Memory Cache LID -> Phone JID
    const cachedPhoneJid = this.lidToJidMap.get(cleanJid) || this.lidToJidMap.get(rawId);
    if (cachedPhoneJid) {
      const normCached = normalizePhone(cachedPhoneJid);
      if (normCached.cleanDigits && normCached.cleanDigits.length >= 5) {
        const userByCached = await prisma.user.findFirst({
          where: {
            OR: [
              { whatsappNumber: normCached.cleanDigits },
              { whatsappNumber: `0${normCached.cleanDigits}` },
              { whatsappNumber: `62${normCached.cleanDigits}` },
              { whatsappJid: normCached.whatsappJid },
            ],
          },
          include: { family: true },
        });
        if (userByCached) return userByCached;
      }
    }

    // 1. Ekstraksi dari Sender/Participant Phone Number metadata Baileys jika ada (senderPn / participantPn)
    const key = msg?.key as any;
    const senderPn = key?.senderPn || key?.participantPn || (msg as any)?.stanza?.attrs?.sender_pn;
    if (senderPn) {
      const normPn = normalizePhone(senderPn);
      if (normPn.cleanDigits && normPn.cleanDigits.length >= 5) {
        const pnOrConditions: any[] = [
          { whatsappNumber: normPn.cleanDigits },
          { whatsappNumber: `0${normPn.cleanDigits}` },
          { whatsappNumber: `62${normPn.cleanDigits}` },
          { whatsappJid: { contains: normPn.cleanDigits } },
        ];
        if (normPn.cleanDigits.length >= 8) {
          pnOrConditions.push({ whatsappNumber: { endsWith: normPn.cleanDigits.slice(-8) } });
        }

        const userByPn = await prisma.user.findFirst({
          where: { OR: pnOrConditions },
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
          } catch (_) { }
          return userByPn;
        }
      }
    }

    // 2. Pencarian Langsung di Tabel User (Strict: jangan query string kosong)
    const userOrConditions: any[] = [];
    if (cleanJid) {
      userOrConditions.push({ whatsappJid: cleanJid });
    }
    if (rawId && rawId.length >= 5) {
      userOrConditions.push({ whatsappJid: `${rawId}@lid` });
    }
    if (phoneNumber && phoneNumber.length >= 5) {
      userOrConditions.push({ whatsappJid: `${phoneNumber}@s.whatsapp.net` });
      userOrConditions.push({ whatsappNumber: phoneNumber });
      if (localPhone && localPhone.length >= 5) {
        userOrConditions.push({ whatsappNumber: localPhone });
        userOrConditions.push({ whatsappNumber: `0${localPhone}` });
      }
      if (suffix && suffix.length >= 6) {
        userOrConditions.push({ whatsappNumber: { endsWith: suffix } });
      }
    }

    let user = null;
    if (userOrConditions.length > 0) {
      user = await prisma.user.findFirst({
        where: { OR: userOrConditions },
        include: { family: true },
      });
    }

    if (user) return user;

    // 3. Pencarian di Tabel BotWhitelist (Strict: jangan query string kosong)
    const whitelistOrConditions: any[] = [];
    if (cleanJid) {
      whitelistOrConditions.push({ identifier: cleanJid });
    }
    if (rawId && rawId.length >= 5) {
      whitelistOrConditions.push({ identifier: rawId });
      whitelistOrConditions.push({ identifier: `${rawId}@lid` });
      whitelistOrConditions.push({ identifier: { contains: rawId } });
    }
    if (phoneNumber && phoneNumber.length >= 5) {
      whitelistOrConditions.push({ identifier: phoneNumber });
      whitelistOrConditions.push({ identifier: `${phoneNumber}@s.whatsapp.net` });
      if (localPhone && localPhone.length >= 5) {
        whitelistOrConditions.push({ identifier: localPhone });
        whitelistOrConditions.push({ identifier: `0${localPhone}` });
      }
      if (suffix && suffix.length >= 6) {
        whitelistOrConditions.push({ identifier: { contains: suffix } });
      }
    }

    if (whitelistOrConditions.length > 0) {
      const whitelistEntry = await prisma.botWhitelist.findFirst({
        where: {
          platform: 'WHATSAPP',
          OR: whitelistOrConditions,
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
          } catch (_) { }
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
          } catch (_) { }
          return matchedUser;
        }
      }
    }

    return null;
  }

  /**
   * Resolusi JID tujuan pengiriman balasan WhatsApp:
   * Selalu prioritaskan JID thread tempat pesan masuk (cleanJid / remoteJid)
   * agar balasan langsung mendarat di percakapan aktif yang dibuka oleh pengguna.
   */
  private static resolveReplyJid(
    cleanJid: string,
    user?: any,
    msg?: proto.IWebMessageInfo
  ): string {
    // 1. Selalu balas langsung ke thread tempat pesan masuk (cleanJid / remoteJid)
    // Ini mutlak diperlukan agar pesan langsung mendarat di layar chat yang sedang dibuka
    // (misalnya WhatsApp Web di thread @lid atau WhatsApp Mobile di thread @s.whatsapp.net).
    if (cleanJid) {
      return cleanJid;
    }
    if (msg?.key?.remoteJid) {
      return msg.key.remoteJid;
    }

    // 2. Jika tidak ada remoteJid (misalnya notifikasi mandiri / laporan terjadwal):
    if (user?.whatsappNumber) {
      const mappedLid = this.jidToLidMap.get(user.whatsappNumber);
      if (mappedLid) return mappedLid;
      const norm = normalizePhone(user.whatsappNumber);
      if (norm.whatsappJid) return norm.whatsappJid;
    }

    return cleanJid || msg?.key?.remoteJid || '';
  }

  /**
   * Pemrosesan Pesan Masuk WhatsApp (Strict Whitelist Protected dengan Auto-Guide & Chat History)
   */
  private static async handleIncomingWhatsAppMessage(msg: proto.IWebMessageInfo) {
    const rawRemoteJid = msg.key.remoteJid;
    if (
      !rawRemoteJid ||
      rawRemoteJid === 'status@broadcast' ||
      rawRemoteJid.endsWith('@broadcast') ||
      rawRemoteJid.endsWith('@newsletter') ||
      rawRemoteJid.includes('@g.us')
    ) {
      return; // Prioritaskan direct message, abaikan story/broadcast/channel/grup
    }

    const { cleanJid, phoneNumber } = normalizeBaileysSender(rawRemoteJid);
    const msgType = Object.keys(msg.message || {})[0] || 'conversation';
    const textContent =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    let user: any = null;
    let replyJid = cleanJid;

    try {
      // 1. Cek Whitelist: User terdaftar di database
      user = await this.resolveUserFromWhatsApp(cleanJid, phoneNumber, msg);

      // Jika user terdaftar dan pesan datang dari @lid, otomatis simpan pemetaan LID <-> No HP
      if (user && cleanJid.endsWith('@lid')) {
        const userPhone = user.whatsappNumber || phoneNumber;
        if (userPhone) {
          this.saveLidMapping(cleanJid, userPhone);
        }
      }

      replyJid = this.resolveReplyJid(cleanJid, user, msg);

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

        await this.sendWhatsAppMessage(replyJid, unwhitelistedReply);
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
          await this.sendWhatsAppMessage(replyJid, replyMsg);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        await this.sendWhatsAppMessage(replyJid, report);
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
        // Draf transaksi menunggu persetujuan (Pending Action)
        prisma.pendingAction.findMany({
          where: {
            familyId,
            status: 'PENDING_APPROVAL',
            expiresAt: { gt: new Date() },
          },
          include: {
            user: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        // Riwayat chat terakhir untuk memori percakapan multi-turn
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

      // 4. Handle Media (Foto Nota / Tulisan Tangan Kertas / Voice Note)
      if (msgType === 'imageMessage') {
        await this.sendWhatsAppMessage(replyJid, '🔍 Sedang membaca foto nota / tulisan tangan Anda dengan AI...');
        try {
          const rawBuffer = await downloadMediaMessage(msg, 'buffer', {});
          // Kompres dan optimasi resolusi struk (maksimal 1024x1024) agar ringan dan cepat diproses AI
          try {
            const compressed = await sharp(rawBuffer)
              .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 75 })
              .toBuffer();
            imageBase64 = compressed.toString('base64');
          } catch (compErr) {
            console.warn('[WA Gateway] Kompresi sharp gagal, menggunakan buffer asli:', compErr);
            imageBase64 = rawBuffer.toString('base64');
          }
        } catch (err: any) {
          console.error('Gagal mengunduh gambar WA:', err?.message || err);
        }
      } else if (msgType === 'audioMessage') {
        await this.sendWhatsAppMessage(replyJid, '🎙️ Sedang mendengarkan rekaman suara Anda...');
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
        await this.sendWhatsAppMessage(replyJid, processed.replyText);
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
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
          summaryText += `\n👉 *Balas "Ya" untuk menyetujui pembuatan pos-pos di atas sekaligus! 🎀*`;
        } else {
          summaryText =
            `📋 *Draf Pembuatan Dompet Baru:*\n` +
            `• *Nama Dompet*: ${processed.walletName}\n` +
            `• *Tipe*: ${processed.walletType || 'BANK'}\n` +
            `• *Saldo Awal*: Rp ${(processed.initialBalance || 0).toLocaleString('id-ID')}\n\n` +
            `👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;
        }

        await ApprovalEngine.createPendingAction(
          familyId,
          user.id,
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
          metadata: {
            actionType: 'CREATE_WALLET',
            walletsCount: processed.wallets?.length,
            categoriesCount: processed.categories?.length,
            name: processed.walletName,
          },
        });
        await this.sendWhatsAppMessage(replyJid, summaryText);
        return;
      }

      if (processed.actionType === 'UPDATE_WALLET') {
        const targetWallet = wallets.find((w) => w.id === processed.targetWalletId || w.name.toLowerCase() === (processed.walletName || '').toLowerCase()) || wallets[0];
        const newName = processed.newWalletName || targetWallet?.name;
        const summaryText =
          `📋 *Draf Pembaruan Nama Dompet:*\n` +
          `• *Dompet*: ${targetWallet?.name}\n` +
          `• *Nama Baru*: ${newName}\n\n` +
          `👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;

        await ApprovalEngine.createPendingAction(
          familyId,
          user.id,
          ActionType.UPDATE_WALLET,
          {
            walletId: targetWallet.id,
            newName,
            newType: processed.newWalletType,
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
          metadata: { actionType: 'UPDATE_WALLET', oldName: targetWallet?.name, newName },
        });
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
          summaryText += `\n👉 *Balas "Ya" untuk menyetujui pembuatan pos-pos di atas sekaligus! 🎀*`;
        } else {
          const targetCat = categories.find((c) => c.id === processed.categoryId || c.name.toLowerCase() === (processed.categoryName || '').toLowerCase());
          const catName = targetCat?.name || processed.categoryName || 'Kategori';
          const monthlyBudget = processed.monthlyBudget || 0;

          summaryText =
            `📋 *Draf Pengaturan Anggaran (Budget):*\n` +
            `• *Kategori*: ${catName}\n` +
            `• *Batas Anggaran Bulanan*: Rp ${monthlyBudget.toLocaleString('id-ID')}\n` +
            `• *Peringatan Guardrail*: 80% kuota\n\n` +
            `👉 *Balas "Ya" untuk menyetujui anggaran ini, atau ketik koreksi Anda.*`;
        }

        await ApprovalEngine.createPendingAction(
          familyId,
          user.id,
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
          metadata: {
            actionType: 'SET_BUDGET',
            categoriesCount: processed.categories?.length,
            walletsCount: processed.wallets?.length,
          },
        });
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
        await this.sendWhatsAppMessage(replyJid, summaryText);
        return;
      }

      if (processed.actionType === 'SET_DEFAULT_WALLET') {
        const targetWallet = wallets.find((w) => w.id === processed.targetWalletId || w.name.toLowerCase() === (processed.walletName || '').toLowerCase()) || wallets[0];
        const summaryText =
          `📋 *Draf Pengaturan Dompet Default Pengeluaran:*\n` +
          `• *Dompet*: ${targetWallet?.name}\n\n` +
          `Jika disetujui, setiap pengeluaran baru yang tidak menyebutkan dompet akan otomatis memakai *${targetWallet?.name}*.\n\n` +
          `👉 *Balas "Ya" untuk menyetujui, atau ketik koreksi Anda.*`;

        await ApprovalEngine.createPendingAction(
          familyId,
          user.id,
          ActionType.SET_DEFAULT_WALLET,
          {
            targetWalletId: targetWallet.id,
            walletName: targetWallet.name,
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
          metadata: { actionType: 'SET_DEFAULT_WALLET', walletName: targetWallet.name },
        });
        await this.sendWhatsAppMessage(replyJid, summaryText);
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
        await this.sendWhatsAppMessage(replyJid, clarifyText);
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

      await this.sendWhatsAppMessage(replyJid, summaryText);
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
      await this.sendWhatsAppMessage(replyJid, errReply);
    }
  }

  /**
   * Kirim pesan teks WhatsApp ke nomor tertentu (Direct Session with Smart Fallback & Timeout Protection)
   */
  static async sendWhatsAppMessage(
    jid: string,
    text: string,
    options: { quoted?: proto.IWebMessageInfo } = {}
  ) {
    if (!this.waSock || !this.isWaConnected) {
      console.warn('Tidak dapat mengirim pesan WhatsApp: Baileys socket tidak aktif.');
      return null;
    }

    // Normalisasi JID target dengan aman (menghapus device index jika ada)
    let target = jid.trim();
    if (target.includes('@')) {
      const parts = target.split('@');
      const cleanUser = parts[0].split(':')[0];
      const domain = parts[1]; // 's.whatsapp.net' atau 'lid'
      target = `${cleanUser}@${domain}`;
    } else {
      const cleanUser = target.split(':')[0];
      target = `${cleanUser}@s.whatsapp.net`;
    }

    // Pertahankan target asli tempat pesan datang (baik thread @lid WhatsApp Web maupun @s.whatsapp.net Ponsel)
    // Sediakan altTarget untuk fallback jika pengiriman ke target utama terkendala
    let altTarget: string | null = null;
    if (target.endsWith('@lid')) {
      const rawLid = target.split('@')[0];
      const mappedPn = this.lidToJidMap.get(target) || this.lidToJidMap.get(rawLid);
      if (mappedPn && !mappedPn.endsWith('@lid')) {
        const cleanPn = mappedPn.split('@')[0].split(':')[0];
        altTarget = `${cleanPn}@s.whatsapp.net`;
      }
    } else if (target.endsWith('@s.whatsapp.net')) {
      const rawPn = target.split('@')[0];
      const mappedLid = this.jidToLidMap.get(target) || this.jidToLidMap.get(rawPn);
      if (mappedLid && mappedLid.endsWith('@lid')) {
        const cleanLid = mappedLid.split('@')[0].split(':')[0];
        altTarget = `${cleanLid}@lid`;
      }
    }

    const msgPayload: any = { text };
    const sendOptions: any = {};
    if (options?.quoted) {
      // Sanitasi quoted: pastikan remoteJid pada quoted message sinkron dengan target
      const quoted = { ...options.quoted };
      if (quoted.key) {
        quoted.key = {
          ...quoted.key,
          remoteJid: target,
        };
      }
      sendOptions.quoted = quoted;
    }

    // Helper untuk mengirim pesan dengan batas waktu aman 8 detik dan auto-retry tanpa quoted jika gagal
    const sendWithTimeout = async (toJid: string, useQuoted: boolean = true) => {
      const currentOpts = useQuoted ? sendOptions : {};
      let timer: NodeJS.Timeout;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout 8s mengirim ke ${toJid}`)), 8000);
      });
      try {
        const res = await Promise.race([
          this.waSock!.sendMessage(toJid, msgPayload, currentOpts),
          timeoutPromise,
        ]);
        clearTimeout(timer!);
        return res;
      } catch (e: any) {
        clearTimeout(timer!);
        // Jika gagal karena quoted context mismatch, coba ulang tanpa quoted!
        if (useQuoted && sendOptions.quoted) {
          console.warn(`[WA Gateway] Gagal kirim dengan quoted ke ${toJid} (${e?.message}), mencoba ulang tanpa quoted...`);
          return await this.waSock!.sendMessage(toJid, msgPayload, {});
        }
        throw e;
      }
    };

    // Coba kirim ke target utama
    try {
      console.log(`[WA Gateway] Mengirim pesan ke ${target}...`);
      const sent = await sendWithTimeout(target);
      if (sent?.key?.id) {
        this.sentMessageIds.add(sent.key.id);
        if (sent.message) {
          this.sentMessageStore.set(sent.key.id, sent.message);
          if (this.sentMessageStore.size > 500) {
            const oldest = this.sentMessageStore.keys().next().value;
            if (oldest) this.sentMessageStore.delete(oldest);
          }
        }
      }
      this.lastSendError = null;
      console.log(`[WA Gateway] Pesan berhasil terkirim ke ${target} (id: ${sent?.key?.id})`);
      return sent;
    } catch (err: any) {
      this.lastSendError = err?.message || String(err);
      console.warn(`[WA Gateway] Gagal mengirim pesan ke ${target}:`, err?.message || err);

      // Coba alternate target (fallback LID <-> PN)
      if (altTarget) {
        console.log(`[WA Gateway] Mencoba fallback pengiriman ke alternate target ${altTarget}...`);
        try {
          const fallbackSent = await sendWithTimeout(altTarget);
          if (fallbackSent?.key?.id) {
            this.sentMessageIds.add(fallbackSent.key.id);
            if (fallbackSent.message) {
              this.sentMessageStore.set(fallbackSent.key.id, fallbackSent.message);
            }
          }
          this.lastSendError = null;
          console.log(`[WA Gateway] Pesan berhasil terkirim via fallback ke ${altTarget} (id: ${fallbackSent?.key?.id})`);
          return fallbackSent;
        } catch (fallbackErr: any) {
          this.lastSendError = fallbackErr?.message || String(fallbackErr);
          console.error(`[WA Gateway] Fallback ke ${altTarget} juga gagal:`, fallbackErr?.message || fallbackErr);
        }
      }

      return null;
    }
  }

  /**
   * Jadwalkan backup sinkronisasi berkas auth ke PostgreSQL secara ter-debounce
   */
  private static scheduleDebouncedSyncAuth(authDir: string) {
    if (this.syncAuthTimer) clearTimeout(this.syncAuthTimer);
    this.syncAuthTimer = setTimeout(() => {
      this.syncAuthToDB(authDir);
    }, 5000);
  }

  /**
   * Reset / Hapus sesi kontak tertentu jika terjadi desync enkripsi E2EE ('Menunggu pesan ini')
   */
  public static async resetContactSession(contactRawId: string) {
    const authDir = process.env.BAILEYS_AUTH_DIR || './baileys_auth';
    try {
      // 1. Hapus dari database
      await prisma.botSession.deleteMany({
        where: { key: { contains: contactRawId } },
      });
      // 2. Hapus dari disk lokal
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        for (const file of files) {
          if (file.includes(contactRawId) && !file.includes('creds') && !file.includes('app-state')) {
            try {
              fs.unlinkSync(path.join(authDir, file));
              console.log(`[WA Gateway] Sesi kontak lokal dibersihkan: ${file}`);
            } catch (_) { }
          }
        }
      }
      console.log(`[WA Gateway] Sesi kontak ${contactRawId} berhasil di-reset untuk regenerasi handshake Signal.`);
    } catch (e) {
      console.warn('Gagal mereset sesi kontak:', e);
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
   * Backup cepat creds.json ke PostgreSQL (Sangat cepat < 20ms, tidak membekukan event loop)
   */
  private static async syncCredsToDB(authDir: string) {
    try {
      const credsFile = path.join(authDir, 'creds.json');
      if (fs.existsSync(credsFile)) {
        const content = fs.readFileSync(credsFile, 'utf-8');
        await prisma.botSession.upsert({
          where: { key: 'creds.json' },
          create: { key: 'creds.json', data: content },
          update: { data: content },
        });
      }
    } catch (err) {
      console.warn('Gagal menyinkronkan creds.json ke DB:', err);
    }
  }

  /**
   * Auto-Backup / Sinkronisasi berkas auth Baileys ke PostgreSQL (Non-blocking background)
   */
  private static async syncAuthToDB(authDir: string) {
    try {
      if (!fs.existsSync(authDir)) return;
      const files = fs.readdirSync(authDir).filter((f) => f.endsWith('.json'));
      // Jalankan di background tanpa memblokir socket
      setImmediate(async () => {
        for (const file of files) {
          const filePath = path.join(authDir, file);
          if (fs.existsSync(filePath)) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              await prisma.botSession.upsert({
                where: { key: file },
                create: { key: file, data: content },
                update: { data: content },
              });
            } catch (_) { }
          }
        }
      });
    } catch (err) {
      console.warn('Gagal menyinkronkan sesi ke DB:', err);
    }
  }
}
