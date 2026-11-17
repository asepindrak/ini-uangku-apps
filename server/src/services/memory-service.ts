import { prisma } from '../db.js';

export class MemoryService {
  /**
   * Ambil seluruh memori & instruksi aktif keluarga
   */
  static async getMemories(familyId: string) {
    try {
      return await prisma.familyMemory.findMany({
        where: { familyId },
        orderBy: { createdAt: 'asc' },
      });
    } catch (err) {
      console.error('[MemoryService] Gagal mengambil memori keluarga:', err);
      return [];
    }
  }

  /**
   * Simpan memori / instruksi baru dari pengguna
   */
  static async saveMemory(
    familyId: string,
    content: string,
    userId?: string,
    category: string = 'GENERAL'
  ) {
    const trimmed = content.trim();
    if (!trimmed) return null;

    try {
      // Cek apakah instruksi yang sama persis sudah ada
      const existing = await prisma.familyMemory.findFirst({
        where: {
          familyId,
          content: { equals: trimmed, mode: 'insensitive' },
        },
      });

      if (existing) {
        return existing;
      }

      return await prisma.familyMemory.create({
        data: {
          familyId,
          userId,
          category,
          content: trimmed,
        },
      });
    } catch (err) {
      console.error('[MemoryService] Gagal menyimpan memori keluarga:', err);
      return null;
    }
  }

  /**
   * Hapus / lupakan memori berdasarkan kata kunci atau ID
   */
  static async forgetMemory(
    familyId: string,
    searchKeyword?: string,
    memoryId?: string
  ): Promise<number> {
    try {
      if (memoryId) {
        const res = await prisma.familyMemory.deleteMany({
          where: { id: memoryId, familyId },
        });
        return res.count;
      }

      if (!searchKeyword || !searchKeyword.trim()) return 0;

      const res = await prisma.familyMemory.deleteMany({
        where: {
          familyId,
          content: { contains: searchKeyword.trim(), mode: 'insensitive' },
        },
      });
      return res.count;
    } catch (err) {
      console.error('[MemoryService] Gagal menghapus memori keluarga:', err);
      return 0;
    }
  }
}
