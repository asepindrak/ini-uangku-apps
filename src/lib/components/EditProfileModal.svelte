<script lang="ts">
  import { auth, updateAuthUser } from '../stores/auth';
  import { api } from '../api';
  import { X, User, Phone, Send, Check, ShieldCheck, Mail, Sparkles } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;

  let name = '';
  let email = '';
  let countryCode = '+62';
  let whatsappNumber = '';
  let telegramChatId = '';
  let role = '';
  let loading = false;
  let successMsg = '';
  let errorMsg = '';
  let prevIsOpen = false;

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

  // Inisialisasi HANYA SEKALI saat modal bertransisi dari closed ke open
  // agar ketikan input pengguna tidak ter-reset/terhapus di tengah jalan!
  $: if (isOpen && !prevIsOpen) {
    prevIsOpen = true;
    if ($auth.user) {
      name = $auth.user.name || '';
      email = $auth.user.email || '';
      countryCode = $auth.user.countryCode || '+62';
      whatsappNumber = $auth.user.whatsappNumber || '';
      telegramChatId = $auth.user.telegramChatId || '';
      role = $auth.user.role || 'MEMBER';
    }
    successMsg = '';
    errorMsg = '';
  }

  $: if (!isOpen && prevIsOpen) {
    prevIsOpen = false;
  }

  async function handleSave() {
    loading = true;
    errorMsg = '';
    successMsg = '';

    try {
      const res = await api.updateMyProfile({
        name,
        countryCode,
        whatsappNumber,
        telegramChatId,
      });

      updateAuthUser(res.user);
      successMsg = res.message || 'Profil dan nomor HP berhasil diperbarui!';
      setTimeout(() => {
        successMsg = '';
        onClose();
      }, 1500);
    } catch (err: any) {
      errorMsg = err.message || 'Gagal memperbarui profil.';
    } finally {
      loading = false;
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/35 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-md bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/90 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <!-- Header -->
      <div class="p-6 pb-4 bg-gradient-to-r from-brand-sky-light via-brand-peach-light to-brand-butter-light border-b border-white/50 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky to-brand-peach flex items-center justify-center text-brand-indigo shadow-xs">
            <User class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-extrabold text-brand-indigo">Edit Profil & Nomor HP 🎀</h3>
            <p class="text-xs text-brand-indigo/60 font-medium">Pengaturan Akun & Akses Bot Monee</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/70 text-brand-indigo/60 hover:text-brand-indigo transition">
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Form Content -->
      <form on:submit|preventDefault={handleSave} class="p-6 space-y-4">
        {#if successMsg}
          <div class="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-2xl flex items-center gap-2 shadow-xs">
            <Check class="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        {/if}

        {#if errorMsg}
          <div class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-2xl shadow-xs">
            {errorMsg}
          </div>
        {/if}

        <!-- Status Role Badge -->
        <div class="flex items-center justify-between p-3 rounded-2xl bg-white border border-brand-indigo/10 shadow-xs">
          <div class="flex items-center gap-2">
            <ShieldCheck class="w-4 h-4 text-brand-sky" />
            <span class="text-xs font-semibold text-brand-indigo">Peran di Keluarga:</span>
          </div>
          <span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold {role === 'MANAGER' ? 'bg-brand-peach text-brand-indigo' : 'bg-brand-sky text-brand-indigo'}">
            {role === 'MANAGER' ? '👑 Manager / Kepala Keluarga' : '👤 Anggota'}
          </span>
        </div>

        <!-- Nama Lengkap -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
            <User class="w-3.5 h-3.5" />
            Nama Lengkap
          </label>
          <input
            type="text"
            bind:value={name}
            required
            class="w-full px-4 py-2.5 rounded-2xl bg-white border border-brand-indigo/10 text-xs text-brand-indigo shadow-xs outline-none focus:ring-2 focus:ring-brand-sky"
            placeholder="Contoh: Asep Indrak"
          />
        </div>

        <!-- Email (Read-only) -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
            <Mail class="w-3.5 h-3.5" />
            Email (Akun Login)
          </label>
          <input
            type="email"
            value={email}
            disabled
            class="w-full px-4 py-2.5 rounded-2xl bg-gray-100/80 border border-transparent text-xs text-brand-indigo/60 outline-none cursor-not-allowed select-none"
          />
        </div>

        <!-- Nomor WhatsApp -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
            <Phone class="w-3.5 h-3.5 text-emerald-600" />
            Nomor WhatsApp (Whitelist Bot Monee)
          </label>
          <div class="flex gap-2">
            <select
              bind:value={countryCode}
              class="w-32 px-3 py-2.5 rounded-2xl bg-white border border-brand-indigo/10 text-xs text-brand-indigo shadow-xs outline-none focus:ring-2 focus:ring-brand-sky cursor-pointer"
            >
              {#each countryCodes as c}
                <option value={c.code}>{c.label}</option>
              {/each}
            </select>
            <input
              type="text"
              bind:value={whatsappNumber}
              placeholder="Contoh: 8123456789"
              class="flex-1 px-4 py-2.5 rounded-2xl bg-white border border-brand-indigo/10 text-xs text-brand-indigo shadow-xs outline-none font-mono focus:ring-2 focus:ring-brand-sky"
            />
          </div>
          <p class="text-[11px] text-brand-indigo/50 mt-1">
            Monee hanya akan merespons chat/nota dari nomor WhatsApp yang terdaftar ini.
          </p>
        </div>

        <!-- User ID Telegram -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
            <Send class="w-3.5 h-3.5 text-sky-500" />
            User ID Telegram (Opsional)
          </label>
          <input
            type="text"
            bind:value={telegramChatId}
            placeholder="Contoh: 123456789"
            class="w-full px-4 py-2.5 rounded-2xl bg-white border border-brand-indigo/10 text-xs text-brand-indigo shadow-xs outline-none font-mono focus:ring-2 focus:ring-brand-sky"
          />
          <p class="text-[11px] text-brand-indigo/50 mt-1">
            Ketik <code>/start</code> di bot Telegram untuk melihat ID Telegram Anda.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          class="w-full py-3 rounded-2xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-xs hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-50 mt-3 flex items-center justify-center gap-2 cursor-pointer"
        >
          <Sparkles class="w-4 h-4" />
          {loading ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </form>
    </div>
  </div>
{/if}
