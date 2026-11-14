import { prisma } from '../db.js';

export interface TimezoneBounds {
  todayIso: string;
  startOfToday: Date;
  endOfToday: Date;
  startOfYesterday: Date;
  endOfYesterday: Date;
  startOfThisMonth: Date;
  startOfLastMonth: Date;
  endOfLastMonth: Date;
  startOfThisYear: Date;
  nowFormatted: string;
  tzAbbreviation: string;
}

export class TimezoneService {
  public static readonly DEFAULT_TIMEZONE = 'Asia/Jakarta';

  /**
   * Mengambil timezone resmi keluarga dari DB, atau fallback ke env/default
   */
  static async getFamilyTimezone(familyId?: string | null): Promise<string> {
    if (!familyId) {
      return process.env.TZ || process.env.DEFAULT_TIMEZONE || this.DEFAULT_TIMEZONE;
    }

    try {
      const family = await prisma.family.findUnique({
        where: { id: familyId },
        select: { timezone: true },
      });
      return family?.timezone || process.env.TZ || process.env.DEFAULT_TIMEZONE || this.DEFAULT_TIMEZONE;
    } catch {
      return this.DEFAULT_TIMEZONE;
    }
  }

  /**
   * Menghitung singkatan zona waktu (WIB, WITA, WIT, atau UTC offset)
   */
  static getTimezoneAbbreviation(tz: string): string {
    if (tz === 'Asia/Jakarta' || tz === 'Asia/Pontianak') return 'WIB';
    if (tz === 'Asia/Makassar' || tz === 'Asia/Ujung_Pandang' || tz === 'Asia/Bali') return 'WITA';
    if (tz === 'Asia/Jayapura') return 'WIT';

    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      }).formatToParts(new Date());
      const zonePart = parts.find((p) => p.type === 'timeZoneName')?.value;
      return zonePart || tz;
    } catch {
      return tz;
    }
  }

  /**
   * Menghitung batas-batas waktu (UTC Date) untuk hari ini, kemarin, bulan ini, dll.
   * berdasarkan zona waktu lokal yang ditentukan.
   */
  static getTimezoneBounds(tz: string = this.DEFAULT_TIMEZONE): TimezoneBounds {
    const now = new Date();

    const getTzParts = (d: Date) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
      }).formatToParts(d);

      const getVal = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
      return {
        year: getVal('year'),
        month: getVal('month'),
        day: getVal('day'),
        hour: getVal('hour'),
        minute: getVal('minute'),
        second: getVal('second'),
      };
    };

    const currentParts = getTzParts(now);

    const makeUtcFromTz = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => {
      const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
      const utcDate = new Date(utcGuess.toLocaleString('en-US', { timeZone: 'UTC' }));
      const tzDate = new Date(utcGuess.toLocaleString('en-US', { timeZone: tz }));
      const offsetMs = tzDate.getTime() - utcDate.getTime();
      return new Date(utcGuess.getTime() - offsetMs);
    };

    const startOfToday = makeUtcFromTz(currentParts.year, currentParts.month, currentParts.day, 0, 0, 0);
    const endOfToday = makeUtcFromTz(currentParts.year, currentParts.month, currentParts.day, 23, 59, 59);

    const yesterdayDate = new Date(startOfToday.getTime() - 12 * 3600 * 1000);
    const yesterdayParts = getTzParts(yesterdayDate);
    const startOfYesterday = makeUtcFromTz(yesterdayParts.year, yesterdayParts.month, yesterdayParts.day, 0, 0, 0);
    const endOfYesterday = new Date(startOfToday.getTime() - 1);

    const startOfThisMonth = makeUtcFromTz(currentParts.year, currentParts.month, 1, 0, 0, 0);

    const lastMonthYear = currentParts.month === 1 ? currentParts.year - 1 : currentParts.year;
    const lastMonthNum = currentParts.month === 1 ? 12 : currentParts.month - 1;
    const startOfLastMonth = makeUtcFromTz(lastMonthYear, lastMonthNum, 1, 0, 0, 0);
    const endOfLastMonth = new Date(startOfThisMonth.getTime() - 1);

    const startOfThisYear = makeUtcFromTz(currentParts.year, 1, 1, 0, 0, 0);

    const todayIso = `${currentParts.year}-${String(currentParts.month).padStart(2, '0')}-${String(currentParts.day).padStart(2, '0')}`;
    const tzAbbr = this.getTimezoneAbbreviation(tz);

    const nowFormatted =
      now.toLocaleDateString('id-ID', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }) + ` ${tzAbbr}`;

    return {
      todayIso,
      startOfToday,
      endOfToday,
      startOfYesterday,
      endOfYesterday,
      startOfThisMonth,
      startOfLastMonth,
      endOfLastMonth,
      startOfThisYear,
      nowFormatted,
      tzAbbreviation: tzAbbr,
    };
  }

  /**
   * Format jam dan menit (e.g. 04.21 atau 15.30) sesuai timezone
   */
  static formatTime(date: Date | string, tz: string = this.DEFAULT_TIMEZONE): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('id-ID', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Format tanggal lengkap (e.g. Minggu, 15 November 2026) sesuai timezone
   */
  static formatDate(
    date: Date | string,
    tz: string = this.DEFAULT_TIMEZONE,
    options?: Intl.DateTimeFormatOptions
  ): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('id-ID', {
      timeZone: tz,
      ...(options || { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    });
  }
}
