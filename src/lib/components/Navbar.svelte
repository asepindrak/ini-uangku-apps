<script lang="ts">
  import { privacyMode } from '../stores/privacy';
  import { auth, clearAuth } from '../stores/auth';
  import { updateModalOpen, updateInfo, updateChecking } from '../stores/update';
  import { checkAppUpdate } from '../utils/tauri-ipc';
  import {
    Eye,
    EyeOff,
    Sparkles,
    Bot,
    Bell,
    LogOut,
    UserPlus,
    Users,
    User,
    Settings,
    ShieldCheck,
  } from 'lucide-svelte';

  export let pendingCount: number = 0;
  export let onOpenInvite: () => void;
  export let onOpenBotStatus: () => void;
  export let onOpenPending: () => void;
  export let onOpenLLMSettings: () => void;
  export let onOpenProfile: () => void;

  function togglePrivacy() {
    privacyMode.update((v) => !v);
  }

  async function handleCheckUpdate() {
    updateChecking.set(true);
    try {
      const res = await checkAppUpdate();
      updateInfo.set(res);
      updateModalOpen.set(true);
    } catch (e) {
      console.error('Update check error:', e);
    } finally {
      updateChecking.set(false);
    }
  }
</script>

<header class="sticky top-0 z-40 w-full backdrop-blur-xl bg-white/60 border-b border-white/50 shadow-glass-sm transition-all">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-4">
    <!-- Brand Logo & Title -->
    <div class="flex items-center gap-3">
      <div class="relative w-11 h-11 rounded-2xl overflow-hidden shadow-sm bg-gradient-to-tr from-brand-sky via-brand-peach to-brand-butter p-0.5">
        <img src="/logo.png" alt="Ini Uangku" class="w-full h-full object-cover rounded-[14px]" />
      </div>
      <div>
        <div class="flex items-center gap-2">
          <h1 class="text-lg font-extrabold text-brand-indigo tracking-tight font-sans">Ini Uangku</h1>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-sky text-brand-indigo-dark shadow-xs">
            Family AI
          </span>
        </div>
        {#if $auth.family}
          <p class="text-xs text-brand-indigo/60 font-medium truncate max-w-[160px] sm:max-w-xs">
            {$auth.family.name}
          </p>
        {/if}
      </div>
    </div>

    <!-- Center/Right Action Buttons -->
    <div class="flex items-center gap-2 sm:gap-3">
      <!-- Privacy Mode Toggle (Eye Icon) -->
      <button
        on:click={togglePrivacy}
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold transition shadow-xs border {$privacyMode
          ? 'bg-brand-peach/80 text-brand-indigo border-brand-peach'
          : 'bg-white/80 text-brand-indigo/70 hover:text-brand-indigo border-white/70 hover:bg-white'}"
        title="Mode Sensor Saldo di Tempat Umum"
      >
        {#if $privacyMode}
          <EyeOff class="w-4 h-4 text-brand-peach-dark" />
          <span class="hidden sm:inline">Sensor Aktif</span>
        {:else}
          <Eye class="w-4 h-4 text-brand-indigo/60" />
          <span class="hidden sm:inline">Sensor Saldo</span>
        {/if}
      </button>

      <!-- Pending Approval Notification -->
      <button
        on:click={onOpenPending}
        class="relative p-2.5 rounded-2xl bg-white/80 hover:bg-white border border-white/70 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
        title="Persetujuan Transaksi Menunggu"
      >
        <Bell class="w-4 h-4" />
        {#if pendingCount > 0}
          <span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-peach-dark text-white text-[10px] font-black flex items-center justify-center animate-bounce shadow-sm">
            {pendingCount}
          </span>
        {/if}
      </button>

      <!-- Bot Gateway Status -->
      <button
        on:click={onOpenBotStatus}
        class="p-2.5 rounded-2xl bg-white/80 hover:bg-white border border-white/70 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
        title="Status WhatsApp & Telegram Bot"
      >
        <Bot class="w-4 h-4" />
      </button>

      <!-- Kelola Keluarga & Daftar Anggota -->
      <button
        on:click={onOpenInvite}
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-gradient-to-r from-brand-sky-light to-brand-peach-light hover:from-brand-sky hover:to-brand-peach text-brand-indigo text-xs font-bold border border-white/80 shadow-xs transition"
        title="Daftar Anggota Keluarga & Undang Anggota"
      >
        <Users class="w-4 h-4" />
        <span class="hidden sm:inline">Keluarga</span>
      </button>

      <!-- LLM Configuration -->
      <button
        on:click={onOpenLLMSettings}
        class="p-2.5 rounded-2xl bg-white/80 hover:bg-white border border-white/70 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
        title="Pengaturan Model AI"
      >
        <Settings class="w-4 h-4" />
      </button>

      <!-- Check Update -->
      <button
        on:click={handleCheckUpdate}
        class="p-2.5 rounded-2xl bg-gradient-to-tr from-brand-butter to-brand-sky-light border border-white/80 text-brand-indigo hover:scale-105 transition shadow-xs"
        title="Periksa Pembaruan Aplikasi"
      >
        <Sparkles class="w-4 h-4" />
      </button>

      <!-- User Profile & Logout -->
      {#if $auth.isAuthenticated}
        <button
          on:click={onOpenProfile}
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/80 hover:bg-white border border-white/70 text-brand-indigo text-xs font-bold transition shadow-xs"
          title="Edit Profil & Nomor HP Saya"
        >
          <div class="w-5 h-5 rounded-full bg-brand-peach text-brand-indigo text-[10px] font-extrabold flex items-center justify-center">
            {$auth.user?.name ? $auth.user.name.substring(0, 1).toUpperCase() : 'U'}
          </div>
          <span class="hidden md:inline max-w-[100px] truncate">{$auth.user?.name}</span>
        </button>

        <button
          on:click={clearAuth}
          class="p-2.5 rounded-2xl bg-red-50/80 hover:bg-red-100/90 border border-red-200/50 text-red-600 transition shadow-xs"
          title="Keluar"
        >
          <LogOut class="w-4 h-4" />
        </button>
      {/if}
    </div>
  </div>
</header>
