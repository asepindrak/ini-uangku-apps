/**
 * Normalisasi nomor WhatsApp keluarga secara konsisten
 * Menangani semua format input:
 * - 08123456789
 * - 8123456789
 * - 628123456789
 * - +628123456789
 * - 0812-3456-789
 * - +62 812 3456 789
 */
export function normalizePhone(rawNumber?: string | null, countryCode: string = '+62'): {
  countryCode: string;
  cleanDigits: string;
  fullNumber: string;
  whatsappJid: string;
} {
  if (!rawNumber) {
    return {
      countryCode: countryCode || '+62',
      cleanDigits: '',
      fullNumber: '',
      whatsappJid: '',
    };
  }

  let digits = rawNumber.trim().replace(/[^0-9]/g, '');
  const ccDigits = (countryCode || '+62').replace(/[^0-9]/g, '') || '62';

  // Jika diawali country code (misal 628123456789), buang prefix country code
  if (digits.startsWith(ccDigits)) {
    digits = digits.slice(ccDigits.length);
  }

  // Bersihkan angka 0 di depan (misal 08123456789 -> 8123456789)
  digits = digits.replace(/^0+/, '');

  if (!digits) {
    return {
      countryCode: `+${ccDigits}`,
      cleanDigits: '',
      fullNumber: '',
      whatsappJid: '',
    };
  }

  const fullNumber = `${ccDigits}${digits}`;
  const whatsappJid = `${fullNumber}@s.whatsapp.net`;

  return {
    countryCode: `+${ccDigits}`,
    cleanDigits: digits,
    fullNumber,
    whatsappJid,
  };
}

/**
 * Normalisasi JID / pengirim dari Baileys
 * Membersihkan device index :0, :1, :12 dsb
 */
export function normalizeBaileysSender(jid: string): {
  cleanJid: string;
  phoneNumber: string;
  isLid: boolean;
} {
  if (!jid) return { cleanJid: '', phoneNumber: '', isLid: false };

  const isLid = jid.includes('@lid');
  const [userPart, serverPart = 's.whatsapp.net'] = jid.split('@');
  const cleanUser = userPart.split(':')[0]; // Hapus device :0, :1, dll
  const cleanJid = `${cleanUser}@${serverPart}`;
  const phoneNumber = cleanUser.replace(/[^0-9]/g, '');

  return {
    cleanJid,
    phoneNumber,
    isLid,
  };
}
