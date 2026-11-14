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
  items?: Array<{ name: string; price: number; qty?: number }>;
  summaryMessage: string;
  confidence: number;
}

export interface ProcessedMessageResult {
  intent: 'TRANSACTION_RECORD' | 'FINANCIAL_CONSULTATION';
  amount?: number;
  description?: string;
  type?: 'EXPENSE' | 'INCOME';
  walletId?: string;
  categoryId?: string;
  items?: Array<{ name: string; price: number; qty?: number }>;
  summaryMessage?: string;
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
   * Proses pesan masuk cerdas: Membedakan Pencatatan Transaksi vs Konsultasi / Pertanyaan Keuangan
   */
  static async processMessage(options: LLMPayloadOptions): Promise<ProcessedMessageResult> {
    const config = await this.getConfig(options.familyId);

    const systemPrompt = `Kamu adalah Asisten & Konsultan Keuangan Cerdas Keluarga "Ini Uangku" (Smart Multimodal Family Financial Planner & Agent).

TUGAS UTAMA:
Analisa pesan/media dari pengguna dan tentukan intensi:
1. "TRANSACTION_RECORD":
   - Terpicu saat pengguna ingin MENCATAT transaksi pengeluaran/pemasukan baru, ATAU mengirim foto nota/struk belanjaan, ATAU mengirim foto coretan tangan belanja di kertas, ATAU mengirim rekaman suara (voice note) transaksi.
   - Contoh: "Beli sate 35rb pake Gopay", "Barusan isi bensin 50rb", "Gaji bulan ini masuk 8jt", atau foto struk kasir Indomaret.
   - Ekstrak total nominal uang akhir (integer IDR), deskripsi, tipe (EXPENSE/INCOME), dompet, dan kategori.

2. "FINANCIAL_CONSULTATION":
   - Terpicu saat pengguna BERTANYA, meminta rekap/riwayat pengeluaran/pemasukan, cek saldo dompet, cek sisa budget, minta analisis apakah boros, meminta saran hemat, sapaan santai, atau konsultasi keuangan.
   - Contoh: "pengeluaran ada apa aja?", "hari ini habis berapa ya?", "sisa uang di BCA tinggal berapa?", "bulan ini saya boros nggak?", "pos belanja mana yang paling banyak?", "rekap pengeluaran minggu ini", "halo", "terima kasih".
   - Jawablah dengan sangat cerdas, ramah, dan solutif layaknya Konsultan / Perencana Keuangan Profesional (Financial Planner) keluarga berdasarkan DATA KEUANGAN KELUARGA TERBARU di bawah.
   - Gunakan format markdown tebal, bullet points, dan format mata uang Rupiah yang rapi (contoh: Rp 50.000).

DATA KEUANGAN KELUARGA TERBARU (GUNAKAN DATA INI SECARA AKURAT UNTUK MENJAWAB):
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

FORMAT RESPON WAJIB:
Kembalikan HANYA format JSON valid tanpa tanda markdown (tanpa backticks \`\`\`json):

Jika TRANSACTION_RECORD:
{
  "intent": "TRANSACTION_RECORD",
  "amount": 35000,
  "description": "Beli Sate Ayam",
  "type": "EXPENSE",
  "walletId": "id-dompet-terpilih",
  "categoryId": "id-kategori-terpilih",
  "items": [
    { "name": "Sate Ayam", "price": 35000, "qty": 1 }
  ],
  "summaryMessage": "• Keperluan: Beli Sate Ayam\\n• Total: Rp 35.000\\n• Dompet: BCA\\n• Kategori: Makanan & Minuman"
}

Jika FINANCIAL_CONSULTATION:
{
  "intent": "FINANCIAL_CONSULTATION",
  "replyText": "Teks jawaban lengkap, ramah, dan solutif sebagai konsultan keuangan keluarga (sertakan rincian transaksi jika ditanya, evaluasi anggaran, dan tips praktis)."
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
        userContent.push({ type: 'text', text: 'Tolong bantu konsultasi keuangan.' });
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
        amount: Math.abs(Number(parsed.amount) || 0),
        description: parsed.description || 'Pengeluaran Rumah Tangga',
        type: parsed.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
        walletId: parsed.walletId || defaultWalletId,
        categoryId: parsed.categoryId || defaultCategoryId,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        summaryMessage: parsed.summaryMessage || `Nominal: Rp ${Number(parsed.amount).toLocaleString('id-ID')}`,
      };
    } catch (e) {
      // Jika parsing JSON gagal, perlakukan sebagai respon konsultasi teks
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
