# 🎀 Ini Uangku: Smart Family Finance Multiplatform

Aplikasi keuangan keluarga pintar multiplatform (**Windows, macOS, Linux, Android, iOS**) berbasis **Tauri v2 + Rust**, **Backend Node.js/TypeScript (Prisma ORM)**, **PostgreSQL Server**, **Multi-LLM Agent (Multimodal Vision & Voice Note)** dengan **Human-in-the-Loop Approval Workflow**, **WhatsApp Bot (Baileys)**, dan **Telegram Bot** yang siap dideploy di **Dokploy + Traefik**.

---

## 🎨 Identitas, Aset & Palet Warna Brand (Sesuai `logo.png`)

- **Nama Resmi**: `Ini Uangku` (App ID: `com.iniuangku.app`).
- **Icon Android**: Folder `easyappicon-icons/android` (`mipmap-hdpi`, `mipmap-mdpi`, `mipmap-xhdpi`, `mipmap-xxhdpi`, `mipmap-xxxhdpi`, `mipmap-anydpi-v26`).
- **Icon iOS**: Folder `easyappicon-icons/ios` (`AppIcon.appiconset`).
- **Icon Desktop (Windows, macOS, Linux)**: `logo.png` (di-generate menjadi `.ico`, `.icns`, dan paket multi-resolusi Tauri).

### 🌸 Palet Warna Brand Terkalibrasi (Ekstraksi Presisi dari `logo.png`):
| Token Warna | Hex Code | Elemen UI |
|---|---|---|
| **Soft Sky Blue** | `#C1ECFD` / `#BCE4FA` | Aksen tombol aktif, kartu tabungan, background glow, saldo bank |
| **Butter Cream / Gold** | `#FDEEAD` / `#F7EFBC` | Aksen koin, kartu investasi & sinking funds, badge highlight |
| **Warm Blush Peach** | `#FFC1B6` / `#FBCEC8` | Kartu pengeluaran, badge kategori belanja harian, aksen feminin |
| **Deep Indigo Plum** | `#443D66` / `#29243C` | Warna teks utama, header, dan border halus (lebih soft & elegan dari hitam kaku) |
| **Frosted Glass White** | `rgba(255, 255, 255, 0.75)` | Background kartu dengan `backdrop-blur-xl` dan border `rgba(255, 255, 255, 0.6)` |

---

## 🔐 Sistem Auth Manager & Undangan Keluarga (Family Onboarding)

1. **Register & Login Manager (Kepala Keluarga)**:
   - Manager dapat membuat akun, mengelola seluruh dompet, anggaran, dan konfigurasi AI.
2. **CRUD Anggota Keluarga (Family Multi-Tenant)**:
   - **Invite via QR Code & Link URL**: Manager dapat membagikan QR Code dan tautan invite ke grup WhatsApp atau media sosial keluarga.
   - **Direct Add Member**: Manager dapat menambahkan nama anggota keluarga, nomor WhatsApp (dengan *Country Code Selector* default `+62` Indonesia / custom), dan Telegram Chat ID (opsional). Anggota langsung terdaftar di whitelist bot.

---

## 🤖 Bot AI Agent: Full CRUD dengan Human-in-the-Loop (Approval Workflow)

> **"Semua aksi input, modifikasi, dan alokasi keuangan dilakukan oleh Bot AI Agent dan WAJIB atas persetujuan user."**

- **Setiap aksi Create, Edit, Delete, atau Alokasi Dana**:
  1. Bot menganalisis pesan, foto struk, kotretan kertas, atau voice note.
  2. Bot membuat draft aksi (*Pending Action*) dan mengirimkan **rincian lengkap** ke WhatsApp / Telegram pengirim.
  3. Pengguna cukup membalas **"Ya"** / **"Setuju"** untuk memasukkan ke database, atau mengetik **koreksi** untuk revisi draf.
  4. Pengeluaran rutin (WiFi, listrik) dan alokasi sinking fund bulanan (pajak mobil) juga mengirimkan notifikasi persetujuan terlebih dahulu sebelum uang terjurnal.

---

## 💎 5 Fitur Utama Rekomendasi (Resmi Masuk Core Plan)

1. **Multi-Wallet per Anggota Keluarga**:
   - Pemisahan dompet: *Dompet Pribadi Ayah*, *Dompet Pribadi Ibu*, *Rekening Bersama*, *Tabungan Anak*, dan *Kas Tunai*.
2. **Budget Guardrails & Alert Otomatis (Threshold 80% & 100%)**:
   - Peringatan dini otomatis via WhatsApp/Telegram jika pengeluaran pada kategori tertentu sudah menyentuh 80% kuota anggaran bulanan.
3. **Voice Note (VN) Transaction**:
   - Anggota keluarga yang sedang menyetir cukup kirim VN suara di WhatsApp/Telegram (*"Catat barusan beli bensin 150rb bayar pake debit BCA Ayah"*), langsung diproses menjadi draf transaksi oleh AI untuk persetujuan.
4. **Pencatatan Aset & Cicilan (Net Worth Tracker)**:
   - Tracking aset keluarga (emas, reksadana, tanah/rumah) serta liabilitas/cicilan (KPR, mobil) dengan grafik Net Worth otomatis.
5. **Mode Privasi Saldo (Privacy Blur Toggle)**:
   - Satu tombol mata di pojok atas aplikasi untuk mem-blur seluruh angka nominal saldo dan transaksi saat dibuka di tempat umum.

---

## 🌐 Domain & Arsitektur Deployment (Dokploy + Traefik)

- **Landing Page Resmi (Monee AI)**: [`https://monee.raydrop.web.id`](https://monee.raydrop.web.id)
  - Arsitektur: Nginx Alpine mandiri (`landing/Dockerfile`), HTML statis performa tinggi, bilingual (ID / EN), integrasi dinamis GitHub Releases API untuk download otomatis installer (.msi, .exe, .dmg, .deb, .AppImage, .apk) sesuai OS pengunjung.
- **Web App & Backend API**: [`https://iniuangku.raydrop.web.id`](https://iniuangku.raydrop.web.id)
- **Deployment**: `docker-compose.yml` siap deploy di VPS dengan Traefik Let's Encrypt SSL otomatis.

---

## 🗺️ Roadmap Fase Pengerjaan

1. **Fase 1: Backend Server, PostgreSQL & Prisma ORM** (Skema tabel Family, User, Wallet, PendingAction, migrasi database, dan Dockerfile Dokploy).
2. **Fase 2: Gateway Baileys WA & Telegram + Human-in-the-Loop Approval Engine**.
3. **Fase 3: Multi-LLM Provider Engine** (Vision OCR nota/kertas, Voice Note audio, auto-kategori).
4. **Fase 4: Otomasi Tagihan, Sinking Funds & Budget Alert 80%** (Cron approval notification).
5. **Fase 5: Tauri v2 Pastel Glassmorphism Client** (Auth, Modal Invite QR/Link, Multi-wallet, Net Worth, Privacy Blur, dan UpdateModal Raydrop).
6. **Fase 6: GitHub Actions CI/CD & Multiplatform Release**.
