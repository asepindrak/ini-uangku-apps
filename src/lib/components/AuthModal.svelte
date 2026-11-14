<script lang="ts">
  import { api } from '../api';
  import { setAuth } from '../stores/auth';
  import { Sparkles, Lock, Mail, User, Phone, HeartHandshake } from 'lucide-svelte';

  export let onLoginSuccess: () => void;

  let isRegister = false;
  let name = '';
  let email = '';
  let password = '';
  let whatsappNumber = '';
  let countryCode = '+62';
  let familyName = 'Keluarga Bahagia';
  let loading = false;
  let errorMsg = '';

  const countryCodes = [
    { code: '+62', label: '🇮🇩 Indonesia (+62)' },
    { code: '+60', label: '🇲🇾 Malaysia (+60)' },
    { code: '+65', label: '🇸🇬 Singapura (+65)' },
    { code: '+1', label: '🇺🇸 US (+1)' },
  ];

  async function handleSubmit() {
    loading = true;
    errorMsg = '';

    try {
      if (isRegister) {
        const res = await api.register({
          name,
          email,
          password,
          whatsappNumber,
          countryCode,
          familyName,
        });
        setAuth(res.token, res.user, res.family);
      } else {
        const res = await api.login({ email, password });
        setAuth(res.token, res.user, res.family);
      }
      onLoginSuccess();
    } catch (err: any) {
      errorMsg = err.message || 'Terjadi kesalahan saat masuk.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gradient-to-br from-[#EBF8FE]/80 via-[#FFF0ED]/80 to-[#FFFDF0]/80 backdrop-blur-xl">
  <div class="w-full max-w-md p-8 rounded-3xl bg-white/90 backdrop-blur-2xl border border-white/90 shadow-glass-lg space-y-6 animate-in fade-in zoom-in-95 duration-200">
    <!-- Brand Logo -->
    <div class="text-center space-y-2">
      <div class="w-16 h-16 mx-auto rounded-3xl overflow-hidden shadow-glass bg-gradient-to-tr from-brand-sky via-brand-peach to-brand-butter p-0.5">
        <img src="/logo.png" alt="Ini Uangku" class="w-full h-full object-cover rounded-[22px]" />
      </div>
      <h2 class="text-2xl font-black text-brand-indigo tracking-tight font-sans">Ini Uangku</h2>
      <p class="text-xs text-brand-indigo/60 font-medium">
        {isRegister ? 'Daftarkan keluarga Anda untuk memulai pembukuan pintar' : 'Masuk sebagai Manager Keluarga'}
      </p>
    </div>

    {#if errorMsg}
      <div class="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
        {errorMsg}
      </div>
    {/if}

    <form on:submit|preventDefault={handleSubmit} class="space-y-3.5">
      {#if isRegister}
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Nama Manager / Kepala Keluarga</label>
          <div class="relative">
            <User class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
            <input
              type="text"
              bind:value={name}
              placeholder="Contoh: Ayah Budi / Bunda Rina"
              class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-peach"
              required
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Nama Keluarga</label>
          <div class="relative">
            <HeartHandshake class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
            <input
              type="text"
              bind:value={familyName}
              placeholder="Contoh: Keluarga Pratama"
              class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-peach"
              required
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Nomor WhatsApp Manager</label>
          <div class="flex gap-2">
            <select
              bind:value={countryCode}
              class="px-2.5 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-medium"
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
              required
            />
          </div>
        </div>
      {/if}

      <div>
        <label class="block text-xs font-bold text-brand-indigo mb-1">Email</label>
        <div class="relative">
          <Mail class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
          <input
            type="email"
            bind:value={email}
            placeholder="nama@keluarga.com"
            class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-sky"
            required
          />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-brand-indigo mb-1">Kata Sandi</label>
        <div class="relative">
          <Lock class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
          <input
            type="password"
            bind:value={password}
            placeholder="Minimal 6 karakter"
            class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-sky"
            required
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        class="w-full py-3.5 rounded-2xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-sm hover:scale-[1.01] active:scale-[0.99] transition disabled:opacity-50 mt-4 flex items-center justify-center gap-2"
      >
        <Sparkles class="w-4 h-4" />
        {loading ? 'Memproses...' : isRegister ? 'Daftar Sekarang' : 'Masuk ke Aplikasi'}
      </button>
    </form>

    <div class="text-center pt-2">
      <button
        type="button"
        on:click={() => {
          isRegister = !isRegister;
          errorMsg = '';
        }}
        class="text-xs font-semibold text-brand-indigo/70 hover:text-brand-indigo underline decoration-brand-peach decoration-2"
      >
        {isRegister ? 'Sudah punya akun? Masuk di sini' : 'Belum punya akun? Buat akun Manager'}
      </button>
    </div>
  </div>
</div>
