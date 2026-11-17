import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { prisma } from '../db.js';

export interface LLMPayloadOptions {
  familyId: string;
  currentDateIso?: string; // e.g. "2026-11-15"
  currentDateTimeFormatted?: string; // e.g. "Minggu, 15 November 2026 pukul 04:20 WIB"
  imageBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  rawText?: string;
  contextWallets: Array<{ id: string; name: string; type: string; balance?: number | any; isDefaultExpense?: boolean }>;
  contextCategories: Array<{ id: string; name: string; monthlyBudget?: number | any; alertThreshold?: number | any }>;
  recentTransactions?: Array<{
    id?: string;
    description: string;
    amount: number;
    type: string;
    date: string;
    time?: string;
    label?: string;
    walletName: string;
    categoryName?: string;
    userName?: string;
  }>;
  timeAggregations?: {
    todayExpense: number;
    todayIncome: number;
    yesterdayExpense: number;
    yesterdayIncome: number;
    thisMonthExpense: number;
    thisMonthIncome: number;
    lastMonthExpense: number;
    lastMonthIncome: number;
    thisYearExpense: number;
    thisYearIncome: number;
  };
  monthlySummary?: {
    totalExpense: number;
    totalIncome: number;
    netBalance: number;
  };
  sinkingFunds?: Array<{ name: string; currentAmount: number; targetAmount: number }>;
  pendingActions?: Array<{
    id: string;
    userName?: string;
    actionType: string;
    summary: string;
    proposedDate?: string;
    createdAt: string;
  }>;
  recentChatHistory?: Array<{
    sender: string;
    message: string;
    reply?: string;
  }>;
  quotedContent?: {
    text?: string;
    senderName?: string;
  };
  familyMemories?: Array<{
    id: string;
    content: string;
    category?: string;
  }>;
}

export interface ExtractedTransaction {
  amount: number;
  description: string;
  type: 'EXPENSE' | 'INCOME';
  walletId: string;
  categoryId?: string;
  transactionDate?: string;
  items?: Array<{ name: string; price: number; qty?: number; categoryId?: string }>;
  summaryMessage: string;
  confidence: number;
}

export interface ProcessedMessageResult {
  intent: 'TRANSACTION_RECORD' | 'FINANCIAL_CONSULTATION';
  actionType?:
    | 'CREATE_TRANSACTION'
    | 'UPDATE_TRANSACTION'
    | 'DELETE_TRANSACTION'
    | 'CREATE_WALLET'
    | 'TRANSFER_WALLET'
    | 'SET_BUDGET'
    | 'CREATE_SINKING_FUND'
    | 'CREATE_RECURRING_BILL'
    | 'SET_DEFAULT_WALLET'
    | 'UPDATE_WALLET'
    | 'APPROVE_PENDING'
    | 'REJECT_PENDING'
    | 'SAVE_MEMORY'
    | 'FORGET_MEMORY';
  
  // APPROVE_PENDING & REJECT_PENDING:
  targetPendingId?: string;

  // SAVE_MEMORY & FORGET_MEMORY:
  memoryContent?: string;
  memoryCategory?: string;
  memorySearchKeyword?: string;
  targetMemoryId?: string;

  // CREATE_TRANSACTION:
  amount?: number;
  description?: string;
  type?: 'EXPENSE' | 'INCOME';
  walletId?: string;
  categoryId?: string;
  transactionDate?: string;
  items?: Array<{ name: string; price: number; qty?: number; categoryId?: string }>;
  summaryMessage?: string;

  // UPDATE_TRANSACTION:
  targetTransactionId?: string;
  targetDescription?: string;
  newAmount?: number;
  newDescription?: string;
  newDate?: string;
  newWalletId?: string;
  newCategoryId?: string;

  // DELETE_TRANSACTION:
  // uses targetTransactionId, targetDescription

  // CREATE_WALLET & UPDATE_WALLET:
  walletName?: string;
  walletType?: 'BANK' | 'E_WALLET' | 'CASH' | 'INVESTMENT';
  initialBalance?: number;
  newWalletName?: string;
  newWalletType?: 'BANK' | 'E_WALLET' | 'CASH' | 'INVESTMENT';

  // BATCH CREATION (MULTIPLE WALLETS / CATEGORIES):
  wallets?: Array<{
    name: string;
    type?: 'BANK' | 'E_WALLET' | 'CASH' | 'INVESTMENT';
    initialBalance?: number;
  }>;
  categories?: Array<{
    name: string;
    type?: 'EXPENSE' | 'INCOME';
    monthlyBudget?: number;
    alertThreshold?: number;
  }>;

  // TRANSFER_WALLET:
  sourceWalletId?: string;
  targetWalletId?: string;

  // SET_BUDGET:
  categoryName?: string;
  monthlyBudget?: number;
  alertThreshold?: number;

  // CREATE_SINKING_FUND:
  sinkingFundName?: string;
  targetAmount?: number;
  monthlyAlloc?: number;

  // CREATE_RECURRING_BILL:
  billName?: string;
  dueDayOfMonth?: number;

  // FINANCIAL_CONSULTATION:
  replyText?: string;
}

export class LLMProviderService {
  /**
   * Mengambil konfigurasi LLM aktif untuk keluarga
   */
  static async getConfig(familyId: string) {
    const config = await prisma.llmConfig.findUnique({
      where: { familyId },
    });

    return {
      provider: config?.activeProvider || 'gemini',
      apiKey: config?.apiKey || process.env.GEMINI_API_KEY || '',
      baseUrl: config?.baseUrl || undefined,
      modelName: config?.modelName || 'gemini-2.0-flash',
      temperature: config?.temperature ?? 0.2,
    };
  }

  /**
   * Test koneksi ke LLM Provider
   */
  static async testConnection(params: {
    provider: string;
    apiKey?: string;
    baseUrl?: string;
    modelName: string;
    familyId?: string;
  }): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const startTime = Date.now();
    let effectiveApiKey = params.apiKey;

    if (!effectiveApiKey || effectiveApiKey.startsWith('••••••••')) {
      if (params.familyId) {
        const saved = await prisma.llmConfig.findUnique({ where: { familyId: params.familyId } });
        effectiveApiKey = saved?.apiKey || (params.provider === 'gemini' ? process.env.GEMINI_API_KEY : '');
      } else {
        effectiveApiKey = params.provider === 'gemini' ? process.env.GEMINI_API_KEY : '';
      }
    }

    if (!effectiveApiKey && params.provider !== 'custom') {
      return {
        success: false,
        latencyMs: 0,
        message: 'API Key belum diisi. Masukkan API Key terlebih dahulu.',
      };
    }

    const testPrompt = 'Tes koneksi sistem finansial Ini Uangku. Balas singkat dalam 3 kata: "Koneksi Berhasil".';

    try {
      if (params.provider === 'gemini') {
        const genAI = new GoogleGenerativeAI(effectiveApiKey || '');
        const model = genAI.getGenerativeModel({ model: params.modelName || 'gemini-2.0-flash' });
        const res = await model.generateContent(testPrompt);
        const reply = res.response.text().trim();
        const latencyMs = Date.now() - startTime;
        return {
          success: true,
          latencyMs,
          message: reply || 'Koneksi Berhasil',
        };
      } else {
        const openai = new OpenAI({
          apiKey: effectiveApiKey || 'dummy-key',
          baseURL: params.baseUrl || undefined,
        });

        const res = await openai.chat.completions.create({
          model: params.modelName || 'gpt-4o-mini',
          messages: [{ role: 'user', content: testPrompt }],
          max_tokens: 30,
        });

        const reply = res.choices[0]?.message?.content?.trim() || 'Koneksi Berhasil';
        const latencyMs = Date.now() - startTime;
        return {
          success: true,
          latencyMs,
          message: reply,
        };
      }
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err?.message || String(err);
      return {
        success: false,
        latencyMs,
        message: errorMsg,
      };
    }
  }

  /**
   * Proses pesan masuk cerdas: Penuh Kesadaran Waktu (Temporal Aware) & Full Keuangan Management
   */
  static async processMessage(options: LLMPayloadOptions): Promise<ProcessedMessageResult> {
    const config = await this.getConfig(options.familyId);

    const now = new Date();
    const currentFormatted = options.currentDateTimeFormatted || now.toLocaleDateString('id-ID', {
      timeZone: 'Asia/Jakarta',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const currentIso = options.currentDateIso || now.toISOString().split('T')[0];

    const systemPrompt = `Kamu adalah Monee 🎀, Asisten & Konsultan Keuangan Cerdas Keluarga "Ini Uangku" (Smart Multimodal Family Financial Planner & Agent).

IDENTITAS & PERSONA (SANGAT PENTING):
- NAMA KAMU: "Monee" 🎀. Kamu selalu ingat dan tahu bahwa namamu adalah Monee.
- PANGGILAN UNTUK DIRIMU SENDIRI: Selalu sebut dirimu sebagai "Monee" (contoh: "Menurut Monee, keuangan kakak bulan ini bagus banget!", "Monee sudah hitungkan ya kak", "Monee bantu catat...", "Monee sarankan..."). JANGAN PERNAH gunakan kata kaku seperti "saya", "aku", "bot", atau "asisten AI".
- PANGGILAN UNTUK PENGGUNA: Selalu panggil pengguna dengan sebutan akrab dan hangat "kakak" atau "kak" (contoh: "Halo Kak!", "Keuangan kakak bulan ini terkontrol dengan baik", "Ada lagi yang mau Monee bantu, Kak?").
- NADA BICARA: Ramah, hangat, cerdas, solutif, dan mengayomi layaknya konsultan keuangan pribadi keluarga kesayangan yang selalu setia mendampingi.

KONTEKS WAKTU & TANGGAL SAAT INI (SANGAT PENTING):
- Waktu saat ini: ${currentFormatted} WIB
- Tanggal hari ini (ISO): ${currentIso}
Pedomani konteks waktu di atas untuk menyelesaikan semua acuan waktu relatif:
* "hari ini" / "tadi" / "barusan" -> Tanggal ${currentIso}
* "kemarin" -> Tanggal H-1 dari hari ini
* "kemarin lusa" -> Tanggal H-2 dari hari ini
* "tanggal X" / "tgl X" -> Tanggal X pada bulan berjalan (atau bulan lalu jika tanggal X > tanggal hari ini)
* "bulan lalu" / "tahun ini" -> Sesuai rekap aggregasi periode waktu.

TUGAS UTAMA:
Analisa pesan/media dari pengguna dan tentukan intensi:
1. "TRANSACTION_RECORD":
   Pengguna ingin melakukan aksi perubahan data keuangan keluarga (CRUD):
   a. "CREATE_TRANSACTION" (Input Transaksi):
      - Mencatat pengeluaran atau pemasukan baru, foto struk, catatan kertas, atau voice note.
      - Resolusikan tanggal transaksi jika pengguna menyebutkan waktu (misal: "kemarin beli bensin 50rb" -> transactionDate diisi tanggal kemarin format ISO YYYY-MM-DD). Jika tidak menyebutkan waktu, gunakan tanggal hari ini (${currentIso}).
      - PENTING ATURAN RINCIAN ITEM: Jika pengguna merinci beberapa barang dengan harganya masing-masing (misal: "Beli beras 70rb, telur 25rb, minyak 35rb pake BCA", atau foto struk kasir):
        Cantumkan setiap item ke array "items": [{"name": "Beras 5kg", "price": 70000, "qty": 1}, {"name": "Telur 1kg", "price": 25000, "qty": 1}, ...].
      - ATURAN PEMILIHAN DOMPET UNTUK PENGELUARAN (SANGAT PENTING):
        1) Jika pengguna secara eksplisit menyebutkan nama dompet (misal: "beli bensin 20rb pakai BCA", "makan siang 30rb dompet kas tunai"):
           Gunakan dompet tersebut (cocokkan id dompet dari "Daftar Dompet & Saldo").
        2) Jika pengguna TIDAK menyebutkan dompet:
           - Cek apakah ada dompet di "Daftar Dompet & Saldo" yang memiliki "isDefaultExpense": true.
           - Jika ADA dompet dengan "isDefaultExpense": true:
             Gunakan dompet default tersebut secara otomatis! Cantumkan di summaryMessage: "• Dompet: [Nama Dompet] (Default)".
           - Jika TIDAK ADA dompet dengan "isDefaultExpense": true (belum pernah di-set):
             * Jika dompet keluarga hanya ada 1 dompet: langsung gunakan 1 dompet tersebut.
             * Jika dompet keluarga ada LEBIH DARI 1 (misal ada BCA, Kas Tunai, Rekening Bersama, dll):
               JANGAN menebak dompet secara sembarangan! Kembalikan intent: "FINANCIAL_CONSULTATION" untuk menanyakan kepada pengguna dompet mana yang ingin digunakan, dengan sapaan khas Monee:
               "Halo Kak! 🎀 Monee siap bantu catatkan pengeluaran *[Deskripsi]* sebesar *Rp [Nominal]*, tapi Kakak belum menentukan mau dipotong dari dompet yang mana nih.\n\nPilihan dompet Kakak saat ini:\n• [Nama Dompet 1] (Saldo: Rp ...)\n• [Nama Dompet 2] (Saldo: Rp ...)\n\nMau dipotong dari dompet yang mana ya Kak?\n💡 *Tips Monee:* Kakak juga bisa ketik misalnya *'Jadikan Kas Tunai dompet default'* agar pengeluaran berikutnya langsung otomatis terpotong tanpa perlu ditanya lagi! 🥰"
   b. "UPDATE_TRANSACTION" (Edit Transaksi):
      - Mengubah/mengedit transaksi yang sudah pernah dicatat.
      - Contoh: "ubah pengeluaran bensin kemarin yang 50rb jadi 60rb", "ganti tanggal transaksi beli beras jadi tanggal 12".
      - Cocokkan id/deskripsi transaksi dari daftar "Transaksi Terkini Keluarga" di bawah.
   c. "DELETE_TRANSACTION" (Hapus Transaksi):
      - Menghapus transaksi yang salah catat.
      - Contoh: "hapus transaksi bensin kemarin", "batalkan pengeluaran makan siang tanggal 14".
      - Cocokkan id/deskripsi transaksi dari daftar "Transaksi Terkini Keluarga" di bawah.
   d. "CREATE_WALLET":
      - Perintah membuat dompet baru, BAIK 1 DOMPET MAUPUN BANYAK SEKALIGUS (Batch Create Wallets).
      - Contoh 1 dompet: "bikin dompet Bank Jago saldo awal 500rb".
      - Contoh banyak dompet sekaligus: "tambahkan dompet baru ini: 1. Kas Pajak Mobil, 2. Kas Pajak Beat, 3. Kas Bekel..."
      - SANGAT PENTING: Jika pengguna memberikan daftar banyak dompet sekaligus:
        * JANGAN menolak atau meminta pengguna melakukannya satu per satu! Monee BISA menambahkan semuanya sekaligus!
        * Isi array "wallets": [ { "name": "Kas Pajak Mobil", "type": "CASH", "initialBalance": 0 }, ... ]. Tentukan tipenya ("CASH" jika ada kata kas/tunai/bekel/ubi/renov/kurban/pajak/dapur, "BANK" jika bank/bca/mandiri, atau default "CASH").
        * Jika dalam pesan yang sama pengguna JUGA menyertakan daftar kategori pengeluaran/pemasukan baru, isi juga array "categories": [ { "name": "Makan", "type": "EXPENSE" }, { "name": "Listrik", "type": "EXPENSE" }, ... ]!
   e. "TRANSFER_WALLET":
      - Perintah memindahkan dana / transfer antar dompet (misal: "transfer dari BCA ke Gopay 200rb").
   f. "SET_BUDGET":
      - Mengatur batas anggaran bulanan kategori atau membuat kategori baru, BAIK 1 KATEGORI MAUPUN BANYAK SEKALIGUS (Batch Create Categories).
      - Contoh 1 kategori: "atur budget makan 2 juta sebulan", "buat kategori skincare 500rb".
      - Contoh banyak kategori sekaligus: "tambahkan kategori pengeluaran ini: 1. Makan, 2. Listrik, 3. Air, 4. Bensin, 5. BPJS...".
      - SANGAT PENTING: Jika pengguna memberikan daftar banyak kategori sekaligus:
        * JANGAN menolak atau meminta pengguna memasukkannya satu per satu! Monee BISA menambahkan semuanya sekaligus!
        * Isi array "categories": [ { "name": "Makan", "type": "EXPENSE" }, { "name": "Listrik", "type": "EXPENSE" }, ... ].
        * Jika dalam pesan yang sama pengguna JUGA menyertakan daftar dompet baru, isi juga array "wallets" nya!
   g. "CREATE_SINKING_FUND":
      - Membuat pos tabungan dana siaga baru (misal: "bikin sinking fund Qurban target 4 juta alokasi 400rb tiap bulan").
   h. "CREATE_RECURRING_BILL":
      - Menjadwalkan tagihan rutin bulanan (misal: "jadwalkan tagihan wifi 350rb tiap tgl 15 dari Mandiri").
   i. "SET_DEFAULT_WALLET":
      - Mengatur dompet default pengeluaran keluarga.
      - Contoh: "jadikan Kas Tunai dompet default", "set default dompet bca", "atur dompet mandiri jadi default pengeluaran".
      - Cocokkan nama dompet dari "Daftar Dompet & Saldo" di bawah.
   j. "UPDATE_WALLET":
      - Mengubah / mengganti nama atau tipe dompet yang sudah ada.
      - Contoh: "ganti nama dompet BCA Utama jadi BCA Pribadi", "ubah nama dompet Kas Tunai jadi Uang Saku", "ganti dompet BCA jadi Bank Mandiri".
      - Cocokkan nama dompet dari "Daftar Dompet & Saldo" di bawah.
   k. "APPROVE_PENDING":
      - Menyetujui atau mengeksekusi draf transaksi / aksi yang sedang menunggu persetujuan (Pending Approval).
      - Terpicu saat pengguna mengirim pesan konfirmasi persetujuan dalam kalimat alami, bahasa santai, maupun kalimat panjang/deskriptif.
      - Contoh: "ya setujui", "iya setujui aja", "setujui", "acc ya monee", "tolong simpan ya draf tadi", "eksekusi draf belanja chibi kemarin", "sudah benar simpan aja", "draf gas elpiji setujui ya", "ya setujui drafnya".
      - Cocokkan "targetPendingId" dengan ID dari daftar "Draf Transaksi Menunggu Persetujuan Keluarga" (pilih draf yang sesuai konteks, atau draf paling atas/terbaru jika tidak disebutkan spesifik).
   l. "REJECT_PENDING":
      - Menolak atau membatalkan draf transaksi yang sedang menunggu persetujuan.
      - Terpicu saat pengguna mengirim pesan penolakan atau pembatalan dalam bahasa alami, kalimat santai, maupun penjelasan panjang.
      - Contoh: "tolak aja", "batalin ya draf tadi", "gak jadi beli tabung gas tolak aja monee", "batalkan drafnya", "jangan dicatat ya", "draf kemarin cancel", "tolak draf belanjaan chibi".
      - Cocokkan "targetPendingId" dengan ID dari daftar "Draf Transaksi Menunggu Persetujuan Keluarga".
   m. "SAVE_MEMORY":
      - Terpicu saat pengguna meminta Monee MENGINGAT instruksi, aturan, preferensi dompet/kategori, nama panggilan keluarga, atau catatan penting keluarga.
      - Contoh: "Monee ingat ya kalau beli bensin selalu pakai BCA", "Monee tolong ingat jatah jajan anak 20rb sehari", "ingat ya nama istriku Chibi", "catat di ingatanmu: nomor meteran listrik 142857".
      - Isi "memoryContent": ringkasan padat dan jelas dari instruksi yang harus diingat.
      - Isi "memoryCategory": "PREFERENCE" (jika preferensi dompet/kategori), "RULE" (jika aturan/batas belanja), "IDENTITY" (jika panggilan/nama), atau "NOTE" (jika catatan umum).
   n. "FORGET_MEMORY":
      - Terpicu saat pengguna meminta Monee MELUPAKAN / MENGHAPUS instruksi atau ingatan yang pernah disimpan sebelumnya.
      - Contoh: "Monee lupakan instruksi bensin tadi", "hapus memori tentang jajan anak", "jangan ingat lagi aturan kemarin".
      - Isi "memorySearchKeyword": kata kunci topik memori yang ingin dihapus.

2. "FINANCIAL_CONSULTATION" (Read / Analisis / Konsultasi Waktu):
   - Terpicu saat pengguna BERTANYA, meminta saran, atau bertanya riwayat transaksi ("hari ini apa aja?", "kemarin habis berapa?", "pengeluaran bulan lalu", "pengeluaran tanggal 15", "tahun ini", "apakah saya boros?", "keuangan aku gimana?").
   - Jawablah dengan gaya khas Monee: selalu sebut dirimu "Monee" dan sapa pengguna dengan "kakak" atau "kak" (contoh: "Menurut Monee, keuangan kakak bulan ini bagus banget!", "Monee lihat kemarin kakak ada pengeluaran...", "Saran Monee untuk kakak...").
   - Bersikap sangat cerdas, ramah, dan solutif layaknya Konsultan & Perencana Keuangan Keluarga Profesional berdasarkan DATA KEUANGAN KELUARGA TERBARU di bawah.
   - Gunakan format markdown tebal, bullet points, dan format mata uang Rupiah yang rapi (contoh: Rp 50.000).

DATA KEUANGAN KELUARGA TERBARU:
${options.quotedContent?.text ? `
- Pesan yang Sedang Dikutip / Di-Reply oleh Pengguna (Quoted / Replied Message):
  "${options.quotedContent.text}"
  ${options.quotedContent.senderName ? `(Pengirim pesan yang dikutip: Kak ${options.quotedContent.senderName})` : ''}
PENTING TENTANG PESAN YANG DI-REPLY:
Pengguna sedang me-reply pesan di atas! Jika pesan pengguna saat ini sangat singkat atau berupa konfirmasi/perintah seperti "ini", "ini chat nya", "catat ini", "yang ini ya", "ya ini", "catat ya", atau sejenisnya:
PAHAMI BAHWA MAKSUD DAN DETAIL TRANSAKSI / PERCAKAPAN MERUJUK PADA PESAN YANG DIKUTIP DI ATAS!
Gunakan nominal, rincian barang, tanggal, atau keperluan dari pesan yang dikutip tersebut untuk mencatat transaksi atau merespon pengguna!
` : ''}
- Memori Jangka Panjang & Instruksi Khusus Keluarga (Family Memories):
${(options.familyMemories && options.familyMemories.length > 0)
  ? options.familyMemories.map((m, idx) => `  ${idx + 1}. [${m.category || 'NOTE'}] ${m.content}`).join('\n')
  : '  Belum ada memori atau instruksi khusus yang tersimpan.'}
PENTING TENTANG MEMORI KELUARGA:
1. Selalu patuhi preferensi dan aturan di atas saat mencatat transaksi atau memberi saran (misal: preferensi dompet untuk bensin, batas jajan harian, nama panggilan keluarga, dll).
2. Jika pengguna bertanya apa saja yang diingat Monee (contoh: "kamu ingat apa aja?", "coba sebutkan instruksi yang pernah aku kasih"), rangkum seluruh memori di atas dengan ramah layaknya konsultan keluarga pada FINANCIAL_CONSULTATION!

- Draf Transaksi Menunggu Persetujuan Keluarga (Belum Resmi Dibukukan / Pending Approval):
${JSON.stringify(options.pendingActions || [], null, 2)}
PENTING TENTANG PENDING ACTIONS:
Jika ada draf transaksi di atas, ketika pengguna bertanya tentang transaksi/pengeluaran (hari ini, kemarin, atau periode apapun), Monee WAJIB menjelaskan status transaksi resmi, DAN JUGA secara proaktif mengingatkan jika ada draf yang masih berstatus menunggu persetujuan approval (sebutkan pengaju, tanggal, nominal, dan keperluannya). Tanyakan dengan hangat apakah Kakak ingin menyetujuinya sekarang!

- Riwayat Percakapan Terakhir (Gunakan untuk memahami konteks kelanjutan chat sebelumnya):
${(options.recentChatHistory || []).map((c) => `* ${c.sender}: "${c.message}"\n  Monee: "${c.reply || ''}"`).join('\n') || 'Belum ada percakapan sebelumnya.'}

- Ringkasan Berdasarkan Periode Waktu:
${JSON.stringify(options.timeAggregations || {}, null, 2)}

- Transaksi Terkini Keluarga (Lengkap dengan ID & Tanggal):
${JSON.stringify(options.recentTransactions || [], null, 2)}

- Daftar Dompet & Saldo:
${JSON.stringify(options.contextWallets, null, 2)}

- Daftar Kategori & Budget Bulanan:
${JSON.stringify(options.contextCategories, null, 2)}

- Pos Dana Siaga (Sinking Funds):
${JSON.stringify(options.sinkingFunds || [], null, 2)}

FORMAT RESPON WAJIB (JSON Valid murni tanpa backticks \`\`\`json):

Jika CREATE_TRANSACTION:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_TRANSACTION",
  "amount": 130000,
  "description": "Belanja Kebutuhan Dapur",
  "type": "EXPENSE",
  "walletId": "id-dompet-terpilih",
  "categoryId": "id-kategori-terpilih",
  "transactionDate": "${currentIso}",
  "items": [
    { "name": "Beras 5kg", "price": 70000, "qty": 1 },
    { "name": "Telur 1kg", "price": 25000, "qty": 1 },
    { "name": "Minyak Goreng 2L", "price": 35000, "qty": 1 }
  ],
  "summaryMessage": "• Beras 5kg (Rp 70.000)\\n• Telur 1kg (Rp 25.000)\\n• Minyak Goreng 2L (Rp 35.000)\\n• Tanggal: ${currentIso}"
}

Jika UPDATE_TRANSACTION:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "UPDATE_TRANSACTION",
  "targetTransactionId": "id-transaksi-cocok",
  "targetDescription": "Bensin",
  "newAmount": 60000,
  "newDescription": "Bensin Pertamax",
  "newDate": "YYYY-MM-DD",
  "newWalletId": "id-dompet-jika-diubah",
  "summaryMessage": "• Ubah Transaksi: Bensin\\n• Nominal Baru: Rp 60.000"
}

Jika DELETE_TRANSACTION:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "DELETE_TRANSACTION",
  "targetTransactionId": "id-transaksi-cocok",
  "targetDescription": "Bensin",
  "summaryMessage": "• Hapus Transaksi: Bensin (Kemarin)\\n• Saldo dompet akan dipulihkan"
}

Jika CREATE_WALLET (Bisa Tunggal atau Banyak Sekaligus):
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_WALLET",
  "walletName": "Kas Pajak Mobil",
  "walletType": "CASH",
  "initialBalance": 0,
  "wallets": [
    { "name": "Kas Pajak Mobil", "type": "CASH", "initialBalance": 0 },
    { "name": "Kas Pajak Beat", "type": "CASH", "initialBalance": 0 }
  ],
  "categories": [
    { "name": "Makan", "type": "EXPENSE" },
    { "name": "Listrik", "type": "EXPENSE" }
  ],
  "summaryMessage": "• 11 Dompet Baru: Kas Pajak Mobil, Kas Pajak Beat, dll\\n• 26 Kategori Pengeluaran: Makan, Listrik, dll"
}

Jika TRANSFER_WALLET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "TRANSFER_WALLET",
  "sourceWalletId": "id-dompet-asal",
  "targetWalletId": "id-dompet-tujuan",
  "amount": 200000,
  "description": "Transfer Dana",
  "summaryMessage": "• Dari: BCA\\n• Ke: Gopay\\n• Nominal: Rp 200.000"
}

Jika SET_BUDGET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "SET_BUDGET",
  "categoryName": "Makanan",
  "monthlyBudget": 2000000,
  "summaryMessage": "• Kategori: Makanan\\n• Batas Anggaran: Rp 2.000.000"
}

Jika CREATE_SINKING_FUND:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_SINKING_FUND",
  "sinkingFundName": "Tabungan Qurban",
  "targetAmount": 4000000,
  "monthlyAlloc": 400000,
  "sourceWalletId": "id-dompet-sumber",
  "summaryMessage": "• Pos: Tabungan Qurban\\n• Target: Rp 4.000.000\\n• Alokasi: Rp 400.000"
}

Jika CREATE_RECURRING_BILL:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_RECURRING_BILL",
  "billName": "Tagihan Wifi",
  "amount": 350000,
  "dueDayOfMonth": 15,
  "summaryMessage": "• Tagihan: Tagihan Wifi\\n• Nominal: Rp 350.000\\n• Jatuh Tempo: Tanggal 15"
}

Jika SET_DEFAULT_WALLET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "SET_DEFAULT_WALLET",
  "targetWalletId": "id-dompet-terpilih",
  "walletName": "Kas Tunai",
  "summaryMessage": "• Jadikan Dompet Default Pengeluaran: Kas Tunai"
}

Jika UPDATE_WALLET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "UPDATE_WALLET",
  "targetWalletId": "id-dompet-lama",
  "walletName": "BCA Utama",
  "newWalletName": "BCA Pribadi",
  "summaryMessage": "• Ubah Nama Dompet: BCA Utama -> BCA Pribadi"
}

Jika APPROVE_PENDING:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "APPROVE_PENDING",
  "targetPendingId": "id-draf-terkait",
  "summaryMessage": "Siap Kak! Draf transaksi berhasil disetujui dan dicatat ke pembukuan. 🎀"
}

Jika REJECT_PENDING:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "REJECT_PENDING",
  "targetPendingId": "id-draf-terkait",
  "summaryMessage": "Siap Kak, draf transaksi berhasil dibatalkan dan tidak dicatat ke pembukuan. 🎀"
}

Jika SAVE_MEMORY:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "SAVE_MEMORY",
  "memoryContent": "Kalau beli bensin selalu pakai dompet Kas Tunai",
  "memoryCategory": "PREFERENCE",
  "summaryMessage": "🧠 Siap Kak! Monee sudah simpan ke ingatan permanen Monee:\n\"Kalau beli bensin selalu pakai dompet Kas Tunai\"\n\nMonee akan selalu mengingat instruksi ini ke depannya! 🎀"
}

Jika FORGET_MEMORY:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "FORGET_MEMORY",
  "memorySearchKeyword": "bensin",
  "summaryMessage": "🗑️ Siap Kak, Monee sudah melupakan instruksi tersebut dari ingatan Monee. 🎀"
}

Jika FINANCIAL_CONSULTATION:
{
  "intent": "FINANCIAL_CONSULTATION",
  "replyText": "Teks jawaban ramah dan cerdas konsultan keuangan berdasarkan data waktu yang ditanyakan."
}`;

    if (config.provider === 'gemini') {
      return this.callGeminiProcess(config, systemPrompt, options);
    } else {
      return this.callOpenAIProcess(config, systemPrompt, options);
    }
  }

  /**
   * Pemanggilan ke Google Gemini API untuk Process Message
   */
  private static async callGeminiProcess(config: any, systemPrompt: string, options: LLMPayloadOptions): Promise<ProcessedMessageResult> {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return {
        intent: 'FINANCIAL_CONSULTATION',
        replyText: 'Kunci API Gemini belum diatur di menu pengaturan aplikasi.',
      };
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: config.modelName || 'gemini-2.0-flash' });

      const contents: any[] = [{ text: systemPrompt }];

      if (options.rawText) {
        contents.push({ text: `Pesan teks pengguna: "${options.rawText}"` });
      }

      if (options.imageBase64) {
        contents.push({
          inlineData: {
            mimeType: options.imageMimeType || 'image/jpeg',
            data: options.imageBase64,
          },
        });
        contents.push({ text: 'Tolong baca dan analisa foto struk / nota / coretan kertas tulisan tangan di atas.' });
      }

      if (options.audioBase64) {
        contents.push({
          inlineData: {
            mimeType: options.audioMimeType || 'audio/ogg',
            data: options.audioBase64,
          },
        });
        contents.push({ text: 'Tolong dengarkan dan proses rekaman suara (voice note) di atas.' });
      }

      const response = await model.generateContent(contents);
      const responseText = response.response.text();
      return this.parseProcessedJSON(responseText, options);
    } catch (error: any) {
      console.error('Error calling Gemini Process:', error);
      return {
        intent: 'FINANCIAL_CONSULTATION',
        replyText: this.sanitizeReply(`Maaf, terjadi kendala saat menganalisa dengan AI: ${error?.message || error}`, options),
      };
    }
  }

  /**
   * Pemanggilan ke OpenAI / Custom OpenAI-Compatible
   */
  private static async callOpenAIProcess(config: any, systemPrompt: string, options: LLMPayloadOptions): Promise<ProcessedMessageResult> {
    try {
      const openai = new OpenAI({
        apiKey: config.apiKey || process.env.OPENAI_API_KEY || 'dummy',
        baseURL: config.baseUrl || undefined,
      });

      const messages: any[] = [
        { role: 'system', content: systemPrompt },
      ];

      // Sisipkan riwayat obrolan sebelumnya untuk konteks multi-turn yang akurat
      if (options.recentChatHistory && options.recentChatHistory.length > 0) {
        const recentSubset = options.recentChatHistory.slice(-3);
        for (const chat of recentSubset) {
          if (chat.message) {
            messages.push({ role: 'user', content: chat.message });
          }
          if (chat.reply) {
            messages.push({ role: 'assistant', content: chat.reply });
          }
        }
      }

      const userContent: any[] = [];
      if (options.rawText) {
        userContent.push({ type: 'text', text: `Pesan pengguna: "${options.rawText}"` });
      }

      if (options.imageBase64) {
        const mime = options.imageMimeType || 'image/jpeg';
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${options.imageBase64}` },
        });
        userContent.push({ type: 'text', text: 'Tolong baca foto struk / coretan kertas ini.' });
      }

      if (userContent.length === 0) {
        userContent.push({ type: 'text', text: 'Tolong bantu kelola keuangan keluarga.' });
      }

      messages.push({ role: 'user', content: userContent });

      const response = await openai.chat.completions.create({
        model: config.modelName || 'gpt-4o-mini',
        messages,
        temperature: config.temperature,
      });

      const text = response.choices[0]?.message?.content || '{}';
      return this.parseProcessedJSON(text, options);
    } catch (error: any) {
      console.error('Error calling OpenAI Compatible API:', error);
      return {
        intent: 'FINANCIAL_CONSULTATION',
        replyText: this.sanitizeReply(`Maaf, terjadi kesalahan pada layanan AI: ${error?.message || error}`, options),
      };
    }
  }

  /**
   * Helper pembersih respons agar tidak membocorkan exception internal, CLI, prompt sistem, atau base64
   */
  private static sanitizeReply(text: string, options: LLMPayloadOptions): string {
    if (!text) return 'Ada yang bisa Monee bantu terkait keuangan keluarga Anda hari ini? 🎀';

    const isLeakedOrError =
      text.includes('[Server Exception') ||
      text.includes('Exception executing') ||
      text.includes('Command [') ||
      text.includes('base64') ||
      text.includes('data:image') ||
      text.includes('SYSTEM:') ||
      text.includes('IDENTITAS & PERSONA') ||
      text.includes('TUGAS UTAMA:') ||
      text.includes('--dangerously-skip-permissions') ||
      text.includes('timed out after') ||
      text.length > 2000;

    if (isLeakedOrError) {
      console.error('❌ [LLM Error Shield] Blocked leak to chat:', text.substring(0, 300));
      if (options.imageBase64) {
        return 'Mohon maaf Kak, foto struk/nota belanja yang dikirimkan belum dapat dibaca oleh AI saat ini. Boleh tolong fotokan lebih dekat dan terang, atau langsung ketikkan nama barang dan nominalnya ya Kak? Monee siap bantu catatkan! 🎀';
      }
      if (options.audioBase64) {
        return 'Mohon maaf Kak, rekaman suara belum dapat terdengar dengan jelas oleh AI saat ini. Boleh tolong ketikkan nominal dan keperluannya ya Kak? Monee langsung bantu catat! 🎀';
      }
      return 'Mohon maaf Kak, Monee mengalami sedikit kendala teknis saat memproses pesan tersebut. Boleh coba ketikkan kembali secara singkat ya Kak? 🎀';
    }

    return text.replace(/```[a-z]*|```/gi, '').trim();
  }

  /**
   * Parser JSON dari output LLM
   */
  private static parseProcessedJSON(rawText: string, options: LLMPayloadOptions): ProcessedMessageResult {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      if (parsed.intent === 'FINANCIAL_CONSULTATION' || parsed.replyText) {
        return {
          intent: 'FINANCIAL_CONSULTATION',
          replyText: this.sanitizeReply(parsed.replyText, options),
        };
      }

      if (parsed.actionType === 'SET_DEFAULT_WALLET') {
        const targetW = options.contextWallets.find((w) =>
          w.id === parsed.targetWalletId ||
          w.name.toLowerCase() === (parsed.walletName || '').toLowerCase()
        ) || options.contextWallets[0];

        return {
          intent: 'TRANSACTION_RECORD',
          actionType: 'SET_DEFAULT_WALLET',
          targetWalletId: targetW?.id,
          walletName: targetW?.name || parsed.walletName,
          summaryMessage: parsed.summaryMessage || `• Jadikan ${targetW?.name || 'Dompet'} sebagai dompet default pengeluaran`,
        };
      }

      if (parsed.actionType === 'UPDATE_WALLET') {
        const targetW = options.contextWallets.find((w) =>
          w.id === parsed.targetWalletId ||
          w.name.toLowerCase() === (parsed.walletName || '').toLowerCase()
        ) || options.contextWallets[0];

        return {
          intent: 'TRANSACTION_RECORD',
          actionType: 'UPDATE_WALLET',
          targetWalletId: targetW?.id,
          walletName: targetW?.name || parsed.walletName,
          newWalletName: parsed.newWalletName || parsed.newName,
          newWalletType: parsed.newWalletType || parsed.newType,
          summaryMessage: parsed.summaryMessage || `• Ubah Dompet ${targetW?.name || ''} menjadi ${parsed.newWalletName || ''}`,
        };
      }

      if (parsed.actionType === 'APPROVE_PENDING' || parsed.actionType === 'REJECT_PENDING') {
        return {
          intent: 'TRANSACTION_RECORD',
          actionType: parsed.actionType,
          targetPendingId: parsed.targetPendingId,
          summaryMessage: parsed.summaryMessage,
          replyText: parsed.replyText,
        };
      }

      if (parsed.actionType === 'SAVE_MEMORY' || parsed.actionType === 'FORGET_MEMORY') {
        return {
          intent: 'TRANSACTION_RECORD',
          actionType: parsed.actionType,
          memoryContent: parsed.memoryContent || parsed.content,
          memoryCategory: parsed.memoryCategory || parsed.category || 'GENERAL',
          memorySearchKeyword: parsed.memorySearchKeyword || parsed.keyword || parsed.search,
          targetMemoryId: parsed.targetMemoryId,
          summaryMessage: parsed.summaryMessage,
          replyText: parsed.replyText,
        };
      }

      const defaultExpenseWallet = options.contextWallets.find((w) => w.isDefaultExpense);
      const defaultWalletId = defaultExpenseWallet?.id || options.contextWallets[0]?.id || '';
      const defaultCategoryId = options.contextCategories[0]?.id;

      return {
        intent: 'TRANSACTION_RECORD',
        actionType: parsed.actionType || 'CREATE_TRANSACTION',
        amount: Math.abs(Number(parsed.amount) || 0),
        description: parsed.description || 'Transaksi Keuangan',
        type: parsed.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
        walletId: parsed.walletId || defaultWalletId,
        categoryId: parsed.categoryId || defaultCategoryId,
        transactionDate: parsed.transactionDate,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        summaryMessage: parsed.summaryMessage,
        // Update & Delete:
        targetTransactionId: parsed.targetTransactionId,
        targetDescription: parsed.targetDescription,
        newAmount: parsed.newAmount ? Math.abs(Number(parsed.newAmount)) : undefined,
        newDescription: parsed.newDescription,
        newDate: parsed.newDate,
        newWalletId: parsed.newWalletId,
        newCategoryId: parsed.newCategoryId,
        // Properties untuk action lainnya:
        walletName: parsed.walletName,
        walletType: parsed.walletType,
        initialBalance: Number(parsed.initialBalance) || 0,
        sourceWalletId: parsed.sourceWalletId,
        targetWalletId: parsed.targetWalletId,
        categoryName: parsed.categoryName,
        monthlyBudget: Number(parsed.monthlyBudget) || 0,
        alertThreshold: Number(parsed.alertThreshold) || 80,
        sinkingFundName: parsed.sinkingFundName,
        targetAmount: Number(parsed.targetAmount) || 0,
        monthlyAlloc: Number(parsed.monthlyAlloc) || 0,
        billName: parsed.billName,
        dueDayOfMonth: Number(parsed.dueDayOfMonth) || 1,
        wallets: Array.isArray(parsed.wallets) ? parsed.wallets : undefined,
        categories: Array.isArray(parsed.categories) ? parsed.categories : undefined,
      };
    } catch (e) {
      return {
        intent: 'FINANCIAL_CONSULTATION',
        replyText: this.sanitizeReply(rawText, options),
      };
    }
  }

  /**
   * Backward compatibility
   */
  static async extractTransaction(options: LLMPayloadOptions): Promise<ExtractedTransaction> {
    const res = await this.processMessage(options);
    const defaultWalletId = options.contextWallets[0]?.id || '';
    const defaultCategoryId = options.contextCategories[0]?.id;

    return {
      amount: res.amount || 0,
      description: res.description || 'Pengeluaran',
      type: res.type || 'EXPENSE',
      walletId: res.walletId || defaultWalletId,
      categoryId: res.categoryId || defaultCategoryId,
      transactionDate: res.transactionDate,
      items: res.items || [],
      summaryMessage: res.summaryMessage || '',
      confidence: 0.9,
    };
  }
}
