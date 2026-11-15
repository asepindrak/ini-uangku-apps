<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { setAuth } from '../stores/auth';
  import { Sparkles, Lock, Mail, User, Phone, HeartHandshake, Wallet, KeyRound, CheckCircle2 } from 'lucide-svelte';
  import logoImg from '../../assets/logo.png';

  export let onLoginSuccess: () => void;
  export let initialInviteCode: string = '';

  let mode: 'login' | 'registerManager' | 'joinFamily' = initialInviteCode ? 'joinFamily' : 'login';

  let name = '';
  let email = '';
  let password = '';
  let whatsappNumber = '';
  let countryCode = '+62';
  let familyName = 'Keluarga Bahagia';
  let inviteCode = initialInviteCode || '';
  let verifiedFamilyInfo: { familyName: string; managerName: string } | null = null;
  let verifyingCode = false;

  let loading = false;
  let errorMsg = '';
  let logoError = false;

  const countryCodes = [
    { code: '+62', label: '🇮🇩 Indonesia (+62)' },
    { code: '+60', label: '🇲🇾 Malaysia (+60)' },
    { code: '+65', label: '🇸🇬 Singapura (+65)' },
    { code: '+1', label: '🇺🇸 US (+1)' },
  ];

  $: if (initialInviteCode && !inviteCode) {
    inviteCode = initialInviteCode;
    mode = 'joinFamily';
  }

  $: if (mode === 'joinFamily' && inviteCode && inviteCode.length >= 6) {
    checkInviteCode(inviteCode);
  }

  async function checkInviteCode(code: string) {
    verifyingCode = true;
    try {
      const info = await api.getInviteInfo(code);
      if (info && info.isValid) {
        verifiedFamilyInfo = {
          familyName: info.familyName,
          managerName: info.managerName,
        };
      }
    } catch {
      verifiedFamilyInfo = null;
    } finally {
      verifyingCode = false;
    }
  }

  onMount(() => {
    if (initialInviteCode) {
      checkInviteCode(initialInviteCode);
    }
  });

  async function handleSubmit() {
    loading = true;
    errorMsg = '';

    try {
      if (mode === 'registerManager') {
        const res = await api.register({
          name,
          email,
          password,
          whatsappNumber,
          countryCode,
          familyName,
        });
        setAuth(res.token, res.user, res.family);
      } else if (mode === 'joinFamily') {
        if (!inviteCode) {
          throw new Error('Kode undangan keluarga wajib diisi.');
        }
        const res = await api.joinFamily({
          inviteCode: inviteCode.trim().toUpperCase(),
          name,
          email,
          password,
          whatsappNumber,
          countryCode,
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
  <div class="w-full max-w-md p-8 rounded-3xl bg-white/90 backdrop-blur-2xl border border-white/90 shadow-glass-lg space-y-5 animate-in fade-in zoom-in-95 duration-200">
    <!-- Brand Logo -->
    <div class="text-center space-y-2">
      <div class="w-16 h-16 mx-auto rounded-3xl overflow-hidden shadow-glass bg-gradient-to-tr from-brand-sky via-brand-peach to-brand-butter p-0.5 flex items-center justify-center">
        {#if logoError}
          <div class="w-full h-full rounded-[22px] bg-white flex items-center justify-center text-brand-indigo shadow-inner">
            <Wallet class="w-8 h-8 text-brand-indigo" />
          </div>
        {:else}
          <img
            src={logoImg}
            alt="Ini Uangku"
            class="w-full h-full object-cover rounded-[22px]"
            on:error={() => (logoError = true)}
          />
        {/if}
      </div>
      <h2 class="text-2xl font-black text-brand-indigo tracking-tight font-sans">Ini Uangku</h2>
      <p class="text-xs text-brand-indigo/60 font-medium">
        {#if mode === 'registerManager'}
          Daftarkan keluarga baru Anda untuk memulai pembukuan pintar
        {:else if mode === 'joinFamily'}
          Bergabung ke keluarga yang sudah ada dengan kode undangan 🎀
        {:else}
          Masuk ke Akun Keluarga Anda
        {/if}
      </p>
    </div>

    <!-- Mode Selector Tabs -->
    <div class="flex rounded-2xl bg-brand-sky/20 p-1 gap-1 text-xs font-bold text-brand-indigo">
      <button
        type="button"
        on:click={() => { mode = 'login'; errorMsg = ''; }}
        class="flex-1 py-1.5 rounded-xl transition {mode === 'login' ? 'bg-white shadow-xs text-brand-indigo' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Masuk
      </button>
      <button
        type="button"
        on:click={() => { mode = 'joinFamily'; errorMsg = ''; }}
        class="flex-1 py-1.5 rounded-xl transition {mode === 'joinFamily' ? 'bg-white shadow-xs text-brand-indigo' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Gabung Keluarga
      </button>
      <button
        type="button"
        on:click={() => { mode = 'registerManager'; errorMsg = ''; }}
        class="flex-1 py-1.5 rounded-xl transition {mode === 'registerManager' ? 'bg-white shadow-xs text-brand-indigo' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Keluarga Baru
      </button>
    </div>

    {#if errorMsg}
      <div class="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-600 text-xs font-semibold">
        {errorMsg}
      </div>
    {/if}

    {#if mode === 'joinFamily' && verifiedFamilyInfo}
      <div class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2.5">
        <CheckCircle2 class="w-5 h-5 text-emerald-600 shrink-0" />
        <div>
          <span class="font-bold">Undangan Terverifikasi! 🎀</span>
          <p class="text-[11px] text-emerald-700 mt-0.5">
            Anda akan bergabung ke <b>{verifiedFamilyInfo.familyName}</b> (Manager: {verifiedFamilyInfo.managerName}).
          </p>
        </div>
      </div>
    {/if}

    <form on:submit|preventDefault={handleSubmit} class="space-y-3">
      {#if mode === 'joinFamily'}
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Kode Undangan Keluarga</label>
          <div class="relative">
            <KeyRound class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
            <input
              type="text"
              bind:value={inviteCode}
              placeholder="Contoh: FAM-ABC123"
              class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs font-mono font-bold text-brand-indigo shadow-inner outline-none uppercase focus:ring-2 focus:ring-brand-sky"
              required
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Nama Lengkap Anggota</label>
          <div class="relative">
            <User class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
            <input
              type="text"
              bind:value={name}
              placeholder="Contoh: Ibu Rina / Kakak Dika"
              class="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-peach"
              required
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Nomor WhatsApp (Whitelist Bot Monee)</label>
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
              placeholder="8123456789 (Opsional)"
              class="flex-1 px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-peach"
            />
          </div>
        </div>
      {/if}

      {#if mode === 'registerManager'}
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
        {#if loading}
          Memproses...
        {:else if mode === 'registerManager'}
          Daftar Keluarga Baru
        {:else if mode === 'joinFamily'}
          Gabung ke Keluarga
        {:else}
          Masuk ke Aplikasi
        {/if}
      </button>
    </form>

    <div class="text-center pt-1 space-y-1">
      {#if mode === 'login'}
        <button
          type="button"
          on:click={() => { mode = 'joinFamily'; errorMsg = ''; }}
          class="block w-full text-xs font-semibold text-brand-indigo/70 hover:text-brand-indigo underline decoration-brand-sky decoration-2"
        >
          Punya Kode Undangan? Gabung ke Keluarga di sini →
        </button>
      {:else}
        <button
          type="button"
          on:click={() => { mode = 'login'; errorMsg = ''; }}
          class="block w-full text-xs font-semibold text-brand-indigo/70 hover:text-brand-indigo underline decoration-brand-peach decoration-2"
        >
          Sudah punya akun? Masuk di sini
        </button>
      {/if}
    </div>
  </div>
</div>
