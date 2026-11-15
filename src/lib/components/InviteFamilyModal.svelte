<script lang="ts">
  import { onMount } from 'svelte';
  import qrcode from 'qrcode';
  import { api } from '../api';
  import { auth } from '../stores/auth';
  import { X, Copy, Check, Share2, QrCode, UserPlus, Phone, Send, Clock, Globe, Sparkles, Users, Trash2 } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;
  export let onMemberAdded: () => void;

  let activeTab: 'members' | 'invite' | 'direct' | 'timezone' = 'members';
  let members: any[] = [];
  let loadingMembers = false;
  let inviteCode = '';
  let inviteUrl = '';
  let familyName = '';
  let qrCodeDataUrl = '';
  let copied = false;

  // Timezone state
  let currentTimezone = 'Asia/Jakarta';
  let selectedTimezone = 'Asia/Jakarta';
  let savingTz = false;
  let tzSuccessMsg = '';
  let tzErrorMsg = '';

  const timezoneOptions = [
    { value: 'Asia/Jakarta', label: '🇮🇩 WIB - Jakarta, Bandung, Medan, Surabaya (UTC+7)' },
    { value: 'Asia/Pontianak', label: '🇮🇩 WIB - Pontianak (UTC+7)' },
    { value: 'Asia/Makassar', label: '🇮🇩 WITA - Makassar, Bali, Banjarmasin, Manado (UTC+8)' },
    { value: 'Asia/Jayapura', label: '🇮🇩 WIT - Jayapura, Ambon, Papua (UTC+9)' },
    { value: 'Asia/Singapore', label: '🇸🇬 Singapura (UTC+8)' },
    { value: 'Asia/Kuala_Lumpur', label: '🇲🇾 Malaysia (UTC+8)' },
    { value: 'Asia/Tokyo', label: '🇯🇵 Tokyo / Jepang (UTC+9)' },
    { value: 'Asia/Riyadh', label: '🇸🇦 Arab Saudi / Mekkah (UTC+3)' },
    { value: 'Europe/London', label: '🇬🇧 London / GMT (UTC+0/+1)' },
    { value: 'America/New_York', label: '🇺🇸 New York / EST (UTC-5/-4)' },
    { value: 'Australia/Sydney', label: '🇦🇺 Sydney (UTC+10/+11)' },
  ];

  // Direct add form state
  let memberName = '';
  let countryCode = '+62';
  let whatsappNumber = '';
  let telegramChatId = '';
  let memberEmail = '';
  let memberPassword = '';
  let role = 'MEMBER';
  let loading = false;
  let errorMsg = '';
  let successMsg = '';

  const countryCodes = [
    { code: '+62', label: '🇮🇩 Indonesia (+62)' },
    { code: '+60', label: '🇲🇾 Malaysia (+60)' },
    { code: '+65', label: '🇸🇬 Singapura (+65)' },
    { code: '+1', label: '🇺🇸 Amerika / Kanada (+1)' },
    { code: '+44', label: '🇬🇧 Inggris (+44)' },
    { code: '+81', label: '🇯🇵 Jepang (+81)' },
    { code: '+61', label: '🇦🇺 Australia (+61)' },
    { code: '+966', label: '🇸🇦 Arab Saudi (+966)' },
  ];

  onMount(async () => {
    await Promise.all([loadInvite(), loadMembers()]);
  });

  $: if (isOpen) {
    loadInvite();
    loadMembers();
  }

  async function loadMembers() {
    loadingMembers = true;
    try {
      members = await api.getMembers();
    } catch (e) {
      console.error('Failed to load family members:', e);
    } finally {
      loadingMembers = false;
    }
  }

  async function handleDeleteMember(member: any) {
    if (!confirm(`Hapus ${member.name} dari keluarga? Anggota ini tidak akan bisa lagi mengakses data atau mencatat via bot.`)) {
      return;
    }

    try {
      await api.deleteMember(member.id);
      await loadMembers();
      onMemberAdded();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus anggota.');
    }
  }

  async function loadInvite() {
    try {
      const [data, profile] = await Promise.all([
        api.getInvite(),
        api.getFamilyProfile().catch(() => null),
      ]);
      inviteCode = data.inviteCode;
      inviteUrl = data.inviteUrl;
      familyName = data.familyName;
      if (profile && profile.timezone) {
        currentTimezone = profile.timezone;
        selectedTimezone = profile.timezone;
      }
      qrCodeDataUrl = await qrcode.toDataURL(inviteUrl, {
        width: 260,
        margin: 2,
        color: {
          dark: '#443D66',
          light: '#FFFFFF',
        },
      });
    } catch (e) {
      console.error('Failed to load invite or profile:', e);
    }
  }

  function detectDeviceTimezone() {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected) {
        selectedTimezone = detected;
        tzSuccessMsg = `Terdeteksi zona waktu perangkat: ${detected}`;
        setTimeout(() => (tzSuccessMsg = ''), 3000);
      }
    } catch (e: any) {
      tzErrorMsg = 'Gagal mendeteksi timezone perangkat.';
    }
  }

  async function handleSaveTimezone() {
    savingTz = true;
    tzErrorMsg = '';
    tzSuccessMsg = '';
    try {
      const res = await api.updateFamilyTimezone(selectedTimezone);
      currentTimezone = res.timezone;
      tzSuccessMsg = `Zona waktu keluarga berhasil diperbarui ke ${res.timezone}!`;
      setTimeout(() => (tzSuccessMsg = ''), 4000);
    } catch (err: any) {
      tzErrorMsg = err.message || 'Gagal memperbarui zona waktu.';
    } finally {
      savingTz = false;
    }
  }

  function getPreviewTime(tz: string): string {
    try {
      return new Intl.DateTimeFormat('id-ID', {
        timeZone: tz,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date());
    } catch {
      return '-';
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    copied = true;
    setTimeout(() => (copied = false), 2500);
  }

  function handleShareWhatsApp() {
    const text = `Halo! Yuk gabung ke pembukuan keuangan keluarga kita "${familyName}" di aplikasi Ini Uangku.\n\nKlik link ini untuk bergabung:\n${inviteUrl}\n\nAtau masukkan Kode Undangan: *${inviteCode}*`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  }

  async function handleDirectAdd() {
    if (!memberName) {
      errorMsg = 'Nama anggota keluarga wajib diisi.';
      return;
    }
    loading = true;
    errorMsg = '';
    successMsg = '';

    try {
      await api.addMember({
        name: memberName,
        countryCode,
        whatsappNumber,
        telegramChatId,
        role,
        email: memberEmail.trim() || undefined,
        password: memberPassword || undefined,
      });

      successMsg = `Berhasil menambahkan ${memberName} ke keluarga!`;
      memberName = '';
      whatsappNumber = '';
      telegramChatId = '';
      memberEmail = '';
      memberPassword = '';
      await loadMembers();
      onMemberAdded();
      setTimeout(() => (successMsg = ''), 3000);
    } catch (err: any) {
      errorMsg = err.message || 'Gagal menambahkan anggota keluarga.';
    } finally {
      loading = false;
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <!-- Header -->
      <div class="p-6 pb-4 bg-gradient-to-r from-brand-sky-light via-brand-peach-light to-brand-butter-light border-b border-white/40 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky to-brand-peach flex items-center justify-center text-brand-indigo shadow-xs">
            <Users class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-brand-indigo">Kelola Keluarga & Anggota 🎀</h3>
            <p class="text-xs text-brand-indigo/60">{familyName || 'Keluarga Ini Uangku'}</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo">
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Tab Selection -->
      <div class="flex border-b border-white/60 bg-white/40 px-6 pt-3 gap-2 overflow-x-auto">
        <button
          on:click={() => (activeTab = 'members')}
          class="pb-2.5 text-xs font-bold transition border-b-2 flex items-center gap-1.5 shrink-0 {activeTab === 'members' ? 'border-brand-peach-dark text-brand-indigo' : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo'}"
        >
          <Users class="w-4 h-4" />
          Daftar Anggota ({members.length})
        </button>
        <button
          on:click={() => (activeTab = 'invite')}
          class="pb-2.5 text-xs font-bold transition border-b-2 flex items-center gap-1.5 shrink-0 {activeTab === 'invite' ? 'border-brand-peach-dark text-brand-indigo' : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo'}"
        >
          <QrCode class="w-4 h-4" />
          Bagikan Link & QR
        </button>
        <button
          on:click={() => (activeTab = 'direct')}
          class="pb-2.5 text-xs font-bold transition border-b-2 flex items-center gap-1.5 shrink-0 {activeTab === 'direct' ? 'border-brand-peach-dark text-brand-indigo' : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo'}"
        >
          <Phone class="w-4 h-4" />
          Input No WA
        </button>
        <button
          on:click={() => (activeTab = 'timezone')}
          class="pb-2.5 text-xs font-bold transition border-b-2 flex items-center gap-1.5 shrink-0 {activeTab === 'timezone' ? 'border-brand-peach-dark text-brand-indigo' : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo'}"
        >
          <Clock class="w-4 h-4" />
          Zona Waktu
        </button>
      </div>

      <div class="p-6 max-h-[65vh] overflow-y-auto">
        {#if activeTab === 'members'}
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-brand-indigo/70">Daftar Anggota Keluarga ({members.length})</span>
              <button
                type="button"
                on:click={() => (activeTab = 'invite')}
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-sky/20 hover:bg-brand-sky/30 text-brand-indigo text-xs font-bold transition"
              >
                <UserPlus class="w-3.5 h-3.5" />
                Tambah Anggota
              </button>
            </div>

            {#if loadingMembers}
              <div class="py-8 text-center text-xs text-brand-indigo/60">Memuat anggota keluarga...</div>
            {:else if members.length === 0}
              <div class="py-8 text-center text-xs text-brand-indigo/60">Belum ada anggota keluarga.</div>
            {:else}
              <div class="space-y-2.5">
                {#each members as m}
                  <div class="p-3.5 rounded-2xl bg-white border border-brand-indigo/10 shadow-xs flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3 min-w-0">
                      <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky via-brand-peach to-brand-butter flex items-center justify-center font-bold text-brand-indigo text-xs shrink-0 shadow-xs">
                        {m.name ? m.name.substring(0, 2).toUpperCase() : 'US'}
                      </div>
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-xs font-extrabold text-brand-indigo truncate">{m.name}</span>
                          {#if m.role === 'MANAGER'}
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-brand-peach text-brand-indigo shadow-xs">👑 Manager</span>
                          {:else}
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-sky text-brand-indigo shadow-xs">👤 Anggota</span>
                          {/if}
                        </div>
                        <div class="flex items-center gap-3 mt-1 text-[11px] text-brand-indigo/60 flex-wrap">
                          {#if m.whatsappNumber}
                            <span class="flex items-center gap-1 text-emerald-700 font-mono font-medium">
                              <Phone class="w-3 h-3 text-emerald-600" />
                              {m.countryCode || '+62'} {m.whatsappNumber}
                            </span>
                          {:else}
                            <span class="text-brand-indigo/40 italic">Belum ada no WA</span>
                          {/if}
                          {#if m.telegramChatId}
                            <span class="flex items-center gap-1 text-sky-700 font-mono font-medium">
                              <Send class="w-3 h-3 text-sky-500" />
                              ID: {m.telegramChatId}
                            </span>
                          {/if}
                        </div>
                      </div>
                    </div>

                    {#if $auth.user?.role === 'MANAGER' && m.id !== $auth.user?.id}
                      <button
                        type="button"
                        on:click={() => handleDeleteMember(m)}
                        class="p-2 rounded-xl text-red-400 hover:text-red-600 hover:bg-red-50 transition shrink-0"
                        title="Hapus Anggota Keluarga"
                      >
                        <Trash2 class="w-4 h-4" />
                      </button>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else if activeTab === 'invite'}
          <div class="text-center space-y-4">
            <p class="text-xs text-brand-indigo/70">
              Scan QR Code ini dari kamera ponsel atau bagikan tautan ini ke pasangan / anak agar langsung terhubung.
            </p>

            {#if qrCodeDataUrl}
              <div class="inline-block p-4 rounded-3xl bg-white shadow-glass-sm border border-brand-indigo/10">
                <img src={qrCodeDataUrl} alt="QR Code Undangan" class="w-48 h-48 mx-auto rounded-xl" />
                <span class="block text-xs font-mono font-bold text-brand-indigo mt-2">Kode: {inviteCode}</span>
              </div>
            {/if}

            <div class="flex items-center gap-2">
              <input
                type="text"
                readonly
                value={inviteUrl}
                class="flex-1 px-3.5 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo/80 font-mono shadow-inner outline-none select-all"
              />
              <button
                on:click={handleCopy}
                class="px-3.5 py-2.5 rounded-2xl bg-white hover:bg-brand-sky-light text-brand-indigo text-xs font-bold border border-white shadow-xs transition flex items-center gap-1"
              >
                {#if copied}
                  <Check class="w-4 h-4 text-emerald-600" />
                  Tersalin!
                {:else}
                  <Copy class="w-4 h-4" />
                  Salin
                {/if}
              </button>
            </div>

            <button
              on:click={handleShareWhatsApp}
              class="w-full py-3 rounded-2xl bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition"
            >
              <Share2 class="w-4 h-4" />
              Bagikan ke Grup WhatsApp Keluarga
            </button>
          </div>
        {:else if activeTab === 'direct'}
          <!-- Direct Add Form -->
          <form on:submit|preventDefault={handleDirectAdd} class="space-y-3.5">
            {#if errorMsg}
              <div class="p-3 rounded-2xl bg-red-50 text-red-600 text-xs font-semibold">{errorMsg}</div>
            {/if}
            {#if successMsg}
              <div class="p-3 rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-semibold">{successMsg}</div>
            {/if}

            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">Nama Anggota Keluarga</label>
              <input
                type="text"
                bind:value={memberName}
                placeholder="Contoh: Bunda, Ayah, Kakak"
                class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-peach"
                required
              />
            </div>

            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">Nomor WhatsApp (Whitelist AI Bot)</label>
              <div class="flex gap-2">
                <select
                  bind:value={countryCode}
                  class="px-3 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-medium"
                >
                  {#each countryCodes as cc}
                    <option value={cc.code}>{cc.label}</option>
                  {/each}
                </select>
                <input
                  type="tel"
                  bind:value={whatsappNumber}
                  placeholder="8123456789"
                  class="flex-1 px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-peach"
                />
              </div>
              <p class="text-[11px] text-brand-indigo/50 mt-1">Hanya nomor ini yang diizinkan chat dengan bot WhatsApp.</p>
            </div>

            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">User ID Telegram (Opsional)</label>
              <input
                type="text"
                bind:value={telegramChatId}
                placeholder="Contoh: 123456789"
                class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-sky"
              />
              <p class="text-[11px] text-brand-indigo/50 mt-1">Dapat diperoleh dengan mengirim /start ke bot Telegram Anda.</p>
            </div>

            <div class="pt-1 border-t border-brand-indigo/10 space-y-3">
              <span class="block text-[11px] font-bold text-brand-indigo/70">Akses Login Web / Desktop App (Opsional)</span>
              <div>
                <label class="block text-xs font-bold text-brand-indigo mb-1">Email Anggota</label>
                <input
                  type="email"
                  bind:value={memberEmail}
                  placeholder="anggota@keluarga.com"
                  class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-sky"
                />
              </div>
              <div>
                <label class="block text-xs font-bold text-brand-indigo mb-1">Kata Sandi</label>
                <input
                  type="password"
                  bind:value={memberPassword}
                  placeholder="Minimal 6 karakter"
                  class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-sky"
                />
                <p class="text-[11px] text-brand-indigo/50 mt-1">Jika diisi, anggota keluarga dapat langsung login ke aplikasi Web/Desktop.</p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              class="w-full py-3 rounded-2xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-sm hover:scale-[1.01] transition disabled:opacity-50 mt-2"
            >
              {loading ? 'Menyimpan...' : 'Tambahkan Anggota ke Keluarga'}
            </button>
          </form>
        {:else if activeTab === 'timezone'}
          <div class="space-y-4">
            <div class="p-3.5 rounded-2xl bg-brand-sky-light/40 border border-brand-sky/20">
              <div class="flex items-start gap-2.5">
                <Globe class="w-4 h-4 text-brand-sky mt-0.5 shrink-0" />
                <p class="text-xs text-brand-indigo/80 leading-relaxed">
                  Zona waktu digunakan oleh <b>Bot WhatsApp & Telegram</b> untuk menentukan pergantian tanggal hari ini, kemarin, dan jam mutasi transaksi agar sesuai dengan waktu lokal keluarga Anda.
                </p>
              </div>
            </div>

            {#if tzSuccessMsg}
              <div class="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs rounded-2xl flex items-center gap-2">
                <Check class="w-4 h-4 shrink-0" />
                <span>{tzSuccessMsg}</span>
              </div>
            {/if}

            {#if tzErrorMsg}
              <div class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-2xl">
                {tzErrorMsg}
              </div>
            {/if}

            <!-- Tombol Deteksi Otomatis -->
            <div>
              <button
                type="button"
                on:click={detectDeviceTimezone}
                class="w-full py-2.5 px-4 rounded-2xl bg-white border border-brand-sky/40 text-brand-indigo text-xs font-bold shadow-xs hover:bg-brand-sky-light/30 transition flex items-center justify-center gap-2"
              >
                <Sparkles class="w-4 h-4 text-brand-sky" />
                Deteksi Otomatis dari Perangkat Saya
              </button>
            </div>

            <!-- Pilih Timezone Presets -->
            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1.5">Pilih Zona Waktu Keluarga</label>
              <select
                bind:value={selectedTimezone}
                class="w-full px-3.5 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-sky"
              >
                {#each timezoneOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>

            <!-- Custom Timezone String -->
            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">Zona Waktu IANA (Kustom)</label>
              <input
                type="text"
                bind:value={selectedTimezone}
                placeholder="Contoh: Asia/Jakarta"
                class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-sky"
              />
              <p class="text-[11px] text-brand-indigo/50 mt-1">Standar IANA (contoh: Asia/Jakarta, Asia/Makassar, Asia/Jayapura).</p>
            </div>

            <!-- Preview Jam Lokal -->
            <div class="p-3.5 rounded-2xl bg-white border border-brand-indigo/10 shadow-xs">
              <span class="block text-[11px] font-bold text-brand-indigo/60 uppercase tracking-wider mb-1">Pratinjau Waktu Saat Ini</span>
              <span class="text-sm font-extrabold text-brand-indigo block">
                {getPreviewTime(selectedTimezone)}
              </span>
            </div>

            <!-- Tombol Simpan -->
            <button
              type="button"
              on:click={handleSaveTimezone}
              disabled={savingTz}
              class="w-full py-3 rounded-2xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-sm hover:scale-[1.01] transition disabled:opacity-50 mt-2 flex items-center justify-center gap-1.5"
            >
              <Clock class="w-4 h-4" />
              {savingTz ? 'Menyimpan Zona Waktu...' : 'Simpan Zona Waktu Keluarga'}
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
