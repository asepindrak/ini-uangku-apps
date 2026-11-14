import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { prisma } from '../db.js';

export interface LLMPayloadOptions {
  familyId: string;
  imageBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  rawText?: string;
  contextWallets: Array<{ id: string; name: string; type: string; balance?: number | any }>;
  contextCategories: Array<{ id: string; name: string; monthlyBudget?: number | any; alertThreshold?: number | any }>;
  recentTransactions?: Array<{
    description: string;
    amount: number;
    type: string;
    date: string;
    walletName: string;
    categoryName?: string;
    userName?: string;
  }>;
  monthlySummary?: {
    totalExpense: number;
    totalIncome: number;
    netBalance: number;
  };
  sinkingFunds?: Array<{ name: string; currentAmount: number; targetAmount: number }>;
}

export interface ExtractedTransaction {
  amount: number;
  description: string;
  type: 'EXPENSE' | 'INCOME';
  walletId: string;
  categoryId?: string;
  items?: Array<{ name: string; price: number; qty?: number; categoryId?: string }>;
  summaryMessage: string;
  confidence: number;
}

export interface ProcessedMessageResult {
  intent: 'TRANSACTION_RECORD' | 'FINANCIAL_CONSULTATION';
  actionType?:
    | 'CREATE_TRANSACTION'
    | 'CREATE_WALLET'
    | 'TRANSFER_WALLET'
    | 'SET_BUDGET'
    | 'CREATE_SINKING_FUND'
    | 'CREATE_RECURRING_BILL';
  // CREATE_TRANSACTION:
  amount?: number;
  description?: string;
  type?: 'EXPENSE' | 'INCOME';
  walletId?: string;
  categoryId?: string;
  items?: Array<{ name: string; price: number; qty?: number; categoryId?: string }>;
  summaryMessage?: string;
  // CREATE_WALLET:
  walletName?: string;
  walletType?: 'BANK' | 'E_WALLET' | 'CASH' | 'INVESTMENT';
  initialBalance?: number;
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
   * Test koneksi ke LLM Provider (mengukur latency dan memvalidasi credentials)
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
   * Proses pesan masuk cerdas: Full Keuangan Management + Itemized Journal + Konsultasi
   */
  static async processMessage(options: LLMPayloadOptions): Promise<ProcessedMessageResult> {
    const config = await this.getConfig(options.familyId);

    const systemPrompt = `Kamu adalah Asisten & Konsultan Keuangan Cerdas Keluarga "Ini Uangku" (Smart Multimodal Family Financial Planner & Agent).

TUGAS UTAMA:
Analisa pesan/media dari pengguna dan tentukan intensi:
1. "TRANSACTION_RECORD":
   Pengguna ingin melakukan aksi perubahan data keuangan keluarga (mutasi). Tentukan actionType yang tepat:
   a. "CREATE_TRANSACTION":
      - Mencatat pengeluaran atau pemasukan baru, foto struk, catatan kertas, atau voice note.
      - PENTING ATURAN RINCIAN ITEM: Jika pengguna merinci beberapa barang dengan harganya masing-masing (misal: "Beli beras 70rb, telur 25rb, minyak 35rb pake BCA", atau foto struk kasir):
        Kamu WAJIB mencantumkan setiap item ke array "items": [{"name": "Beras 5kg", "price": 70000, "qty": 1}, {"name": "Telur 1kg", "price": 25000, "qty": 1}, ...].
        Sistem Ini Uangku akan mencatat tiap item sebagai baris jurnal terpisah di database!
   b. "CREATE_WALLET":
      - Perintah membuat/menambah dompet baru.
      - Contoh: "bikin dompet baru Bank Jago saldo awal 500rb", "tambah dompet Tabungan Haji 10jt", "buat dompet cash kecil 100rb".
   c. "TRANSFER_WALLET":
      - Perintah memindahkan dana / transfer antar dompet keluarga.
      - Contoh: "transfer dari BCA ke Gopay 200rb", "pindahin uang dari Mandiri ke Tunai 500rb".
   d. "SET_BUDGET":
      - Perintah mengatur atau memperbarui batas anggaran kategori.
      - Contoh: "atur budget makan 2 juta sebulan", "set budget bensin 400rb".
   e. "CREATE_SINKING_FUND":
      - Perintah membuat pos tabungan target / dana siaga baru.
      - Contoh: "buat sinking fund Renovasi Rumah target 15 juta alokasi 1 juta per bulan dari BCA".
   f. "CREATE_RECURRING_BILL":
      - Perintah menjadwalkan tagihan rutin bulanan baru.
      - Contoh: "jadwalkan tagihan wifi 350rb tiap tanggal 10 dari Mandiri".

2. "FINANCIAL_CONSULTATION":
   - Terpicu saat pengguna BERTANYA, meminta rekap/riwayat pengeluaran/pemasukan, cek saldo dompet, cek sisa budget, minta analisis apakah boros, meminta saran hemat, sapaan santai, atau konsultasi keuangan.
   - Contoh: "pengeluaran ada apa aja?", "hari ini habis berapa ya?", "sisa uang di BCA tinggal berapa?", "bulan ini saya boros nggak?", "pos belanja mana yang paling banyak?", "rekap pengeluaran minggu ini", "halo", "terima kasih".
   - Jawablah dengan sangat cerdas, ramah, dan solutif layaknya Konsultan / Perencana Keuangan Profesional (Financial Planner) keluarga berdasarkan DATA KEUANGAN KELUARGA TERBARU di bawah.
   - Gunakan format markdown tebal, bullet points, dan format mata uang Rupiah yang rapi (contoh: Rp 50.000).

DATA KEUANGAN KELUARGA TERBARU:
- Daftar Dompet & Saldo:
${JSON.stringify(options.contextWallets, null, 2)}

- Daftar Kategori & Budget Bulanan:
${JSON.stringify(options.contextCategories, null, 2)}

- Ringkasan Finansial Bulan Ini:
${JSON.stringify(options.monthlySummary || { totalExpense: 0, totalIncome: 0, netBalance: 0 }, null, 2)}

- Transaksi Terkini Keluarga:
${JSON.stringify(options.recentTransactions || [], null, 2)}

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
  "items": [
    { "name": "Beras 5kg", "price": 70000, "qty": 1 },
    { "name": "Telur 1kg", "price": 25000, "qty": 1 },
    { "name": "Minyak Goreng 2L", "price": 35000, "qty": 1 }
  ],
  "summaryMessage": "• Beras 5kg (Rp 70.000)\\n• Telur 1kg (Rp 25.000)\\n• Minyak Goreng 2L (Rp 35.000)"
}

Jika CREATE_WALLET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_WALLET",
  "walletName": "Bank Jago",
  "walletType": "BANK",
  "initialBalance": 500000,
  "summaryMessage": "• Nama Dompet: Bank Jago\\n• Tipe: BANK\\n• Saldo Awal: Rp 500.000"
}

Jika TRANSFER_WALLET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "TRANSFER_WALLET",
  "sourceWalletId": "id-dompet-asal",
  "targetWalletId": "id-dompet-tujuan",
  "amount": 200000,
  "description": "Transfer Dana",
  "summaryMessage": "• Dari Dompet: BCA\\n• Ke Dompet: Gopay\\n• Nominal: Rp 200.000"
}

Jika SET_BUDGET:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "SET_BUDGET",
  "categoryId": "id-kategori-jika-ada",
  "categoryName": "Makanan",
  "monthlyBudget": 2000000,
  "summaryMessage": "• Kategori: Makanan\\n• Batas Anggaran Bulanan: Rp 2.000.000"
}

Jika CREATE_SINKING_FUND:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_SINKING_FUND",
  "sinkingFundName": "Tabungan Qurban",
  "targetAmount": 4000000,
  "monthlyAlloc": 400000,
  "sourceWalletId": "id-dompet-sumber",
  "summaryMessage": "• Pos Dana: Tabungan Qurban\\n• Target: Rp 4.000.000\\n• Alokasi Tiap Bulan: Rp 400.000"
}

Jika CREATE_RECURRING_BILL:
{
  "intent": "TRANSACTION_RECORD",
  "actionType": "CREATE_RECURRING_BILL",
  "billName": "Tagihan Wifi Indihome",
  "amount": 350000,
  "dueDayOfMonth": 15,
  "walletId": "id-dompet",
  "summaryMessage": "• Tagihan: Wifi Indihome\\n• Nominal: Rp 350.000\\n• Jatuh Tempo: Tanggal 15"
}

Jika FINANCIAL_CONSULTATION:
{
  "intent": "FINANCIAL_CONSULTATION",
  "replyText": "Teks jawaban lengkap, ramah, dan solutif sebagai konsultan keuangan keluarga."
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
        replyText: `Maaf, terjadi kendala saat menganalisa dengan AI: ${error?.message || error}`,
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
        replyText: `Maaf, terjadi kesalahan pada layanan AI: ${error?.message || error}`,
      };
    }
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
          replyText: parsed.replyText || 'Ada yang bisa saya bantu terkait keuangan keluarga Anda hari ini?',
        };
      }

      const defaultWalletId = options.contextWallets[0]?.id || '';
      const defaultCategoryId = options.contextCategories[0]?.id;

      return {
        intent: 'TRANSACTION_RECORD',
        actionType: parsed.actionType || 'CREATE_TRANSACTION',
        amount: Math.abs(Number(parsed.amount) || 0),
        description: parsed.description || 'Transaksi Keuangan',
        type: parsed.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
        walletId: parsed.walletId || defaultWalletId,
        categoryId: parsed.categoryId || defaultCategoryId,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        summaryMessage: parsed.summaryMessage,
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
      };
    } catch (e) {
      return {
        intent: 'FINANCIAL_CONSULTATION',
        replyText: rawText.replace(/```[a-z]*|```/gi, '').trim(),
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
      items: res.items || [],
      summaryMessage: res.summaryMessage || '',
      confidence: 0.9,
    };
  }
}
