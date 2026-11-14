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
  contextWallets: Array<{ id: string; name: string; type: string }>;
  contextCategories: Array<{ id: string; name: string }>;
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
   * Ekstraksi transaksi dari foto struk, tulisan tangan kertas, voice note, atau pesan teks
   */
  static async extractTransaction(options: LLMPayloadOptions): Promise<ExtractedTransaction> {
    const config = await this.getConfig(options.familyId);

    const systemPrompt = `Kamu adalah Asisten Finansial Pintar Keluarga "Ini Uangku".
Tugasmu adalah menganalisa bukti transaksi keuangan berupa:
1. Foto nota / struk belanja resmi (Indomaret, Alfamart, restoran, pom bensin, toko, dll).
2. Foto kotretan / catatan tulisan tangan di kertas (misal belanja sayur di pasar).
3. Transkripsi pesan suara / voice note (rekaman anggota keluarga sambil menyetir atau belanja).
4. Pesan teks bebas dari WhatsApp atau Telegram.

Daftar Dompet Tersedia:
${JSON.stringify(options.contextWallets, null, 2)}

Daftar Kategori Tersedia:
${JSON.stringify(options.contextCategories, null, 2)}

Aturan Penting:
- Pilih dompet yang paling cocok dari daftar dompet di atas (gunakan id dompet). Jika tidak jelas, gunakan dompet pertama sebagai default.
- Pilih kategori yang paling cocok dari daftar kategori di atas (gunakan id kategori).
- Jika ada banyak item dalam struk/kertas belanja, tulis rincian item (nama barang, perkiraan harga satuan, kuantitas).
- Ekstrak total nominal uang akhir (dalam integer IDR tanpa desimal).
- Buat kalimat ringkasan yang santun, jelas, dan ramah dalam bahasa Indonesia untuk diajukan kepada pengguna sebelum dicatat.

Kamu WAJIB mengembalikan respon HANYA dalam format JSON valid tanpa format markdown (jangan pakai backticks \`\`\`json):
{
  "amount": 145000,
  "description": "Belanja Kebutuhan Dapur di Indomaret",
  "type": "EXPENSE",
  "walletId": "id-dompet-terpilih",
  "categoryId": "id-kategori-terpilih",
  "items": [
    { "name": "Minyak Goreng 2L", "price": 35000, "qty": 1 },
    { "name": "Susu UHT", "price": 65000, "qty": 1 }
  ],
  "summaryMessage": "• Toko: Indomaret\\n• Total: Rp 145.000\\n• Rincian: Minyak Goreng, Susu UHT\\n• Dompet: BCA Ayah\\n• Kategori: Kebutuhan Dapur",
  "confidence": 0.95
}`;

    if (config.provider === 'gemini') {
      return this.callGemini(config, systemPrompt, options);
    } else {
      // OpenAI atau Custom OpenAI-Compatible (Ollama, DeepSeek, Groq, OpenRouter)
      return this.callOpenAICompatible(config, systemPrompt, options);
    }
  }

  /**
   * Pemanggilan ke Google Gemini API (Multimodal)
   */
  private static async callGemini(config: any, systemPrompt: string, options: LLMPayloadOptions): Promise<ExtractedTransaction> {
    const apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return this.createFallbackTransaction(options, 'Kunci API Gemini belum diatur di menu pengaturan.');
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
        contents.push({ text: 'Tolong baca dan analisa foto struk / kertas tulisan tangan di atas.' });
      }

      if (options.audioBase64) {
        contents.push({
          inlineData: {
            mimeType: options.audioMimeType || 'audio/ogg',
            data: options.audioBase64,
          },
        });
        contents.push({ text: 'Tolong dengarkan dan transkripsikan rekaman voice note transaksi keuangan di atas.' });
      }

      const response = await model.generateContent(contents);
      const responseText = response.response.text();
      return this.parseJSONResponse(responseText, options);
    } catch (error: any) {
      console.error('Error calling Gemini API:', error);
      return this.createFallbackTransaction(options, `Gagal memproses dengan Gemini: ${error?.message || error}`);
    }
  }

  /**
   * Pemanggilan ke OpenAI & Custom OpenAI-Compatible Endpoint
   */
  private static async callOpenAICompatible(config: any, systemPrompt: string, options: LLMPayloadOptions): Promise<ExtractedTransaction> {
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
          image_url: {
            url: `data:${mime};base64,${options.imageBase64}`,
          },
        });
        userContent.push({ type: 'text', text: 'Tolong baca struk/kertas tulisan tangan ini.' });
      }

      if (userContent.length === 0) {
        userContent.push({ type: 'text', text: 'Tolong ekstrak transaksi keuangan.' });
      }

      messages.push({ role: 'user', content: userContent });

      const response = await openai.chat.completions.create({
        model: config.modelName || 'gpt-4o-mini',
        messages,
        temperature: config.temperature,
      });

      const text = response.choices[0]?.message?.content || '{}';
      return this.parseJSONResponse(text, options);
    } catch (error: any) {
      console.error('Error calling OpenAI Compatible API:', error);
      return this.createFallbackTransaction(options, `Gagal memproses LLM: ${error?.message || error}`);
    }
  }

  /**
   * Parser JSON dari output LLM
   */
  private static parseJSONResponse(rawText: string, options: LLMPayloadOptions): ExtractedTransaction {
    try {
      // Bersihkan kemungkinan format markdown ```json
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const defaultWalletId = options.contextWallets[0]?.id || '';
      const defaultCategoryId = options.contextCategories[0]?.id;

      return {
        amount: Math.abs(Number(parsed.amount) || 0),
        description: parsed.description || 'Pengeluaran Rumah Tangga',
        type: parsed.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
        walletId: parsed.walletId || defaultWalletId,
        categoryId: parsed.categoryId || defaultCategoryId,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        summaryMessage: parsed.summaryMessage || `Nominal: Rp ${Number(parsed.amount).toLocaleString('id-ID')}`,
        confidence: Number(parsed.confidence) || 0.85,
      };
    } catch (e) {
      console.warn('Gagal mem-parsing JSON dari respon LLM, membuat fallback:', rawText);
      return this.createFallbackTransaction(options, rawText);
    }
  }

  /**
   * Fallback aman jika LLM gagal membaca
   */
  private static createFallbackTransaction(options: LLMPayloadOptions, fallbackNote: string): ExtractedTransaction {
    const defaultWallet = options.contextWallets[0];
    const defaultCategory = options.contextCategories[0];

    return {
      amount: 0,
      description: options.rawText ? `Transaksi: ${options.rawText.substring(0, 40)}` : 'Pengeluaran (Perlu konfirmasi manual)',
      type: 'EXPENSE',
      walletId: defaultWallet?.id || '',
      categoryId: defaultCategory?.id,
      items: [],
      summaryMessage: `⚠️ AI belum dapat membaca nominal dengan pasti (${fallbackNote}).`,
      confidence: 0.2,
    };
  }
}
