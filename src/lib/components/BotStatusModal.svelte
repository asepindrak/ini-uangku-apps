<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { BotStatus, TelegramConfigResponse } from '../types';
  import {
    X,
    Bot,
    RefreshCw,
    CheckCircle2,
    AlertCircle,
    Smartphone,
    Send,
    ShieldCheck,
    Plus,
    Trash2,
    KeyRound,
    UserCheck,
    ExternalLink,
    HelpCircle,
    ChevronDown,
    ChevronUp
  } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;

  let activeTab: 'telegram' | 'whatsapp' = 'telegram';

  let status: BotStatus = {
    whatsappConnected: false,
    whatsappQr: undefined,
    telegramConnected: false,
    globalTelegramBotRunning: false,
    globalTelegramBotUsername: null,
    whitelistCount: 0,
  };

  // Telegram Config State
  let telegramConfig: TelegramConfigResponse = {
    globalBotRunning: false,
    globalBotUsername: null,
    configured: false,
    token: '',
    username: null,
    isRunning: false,
    whitelists: [],
    memberUsers: [],
  };

  let botTokenInput = '';
  let newUserId = '';
  let newUserName = '';
  let showAdvancedBotToken = false;

  let loadingWa = false;
  let savingTelegram = false;
  let addingWhitelist = false;
  let telegramMessage: { text: string; type: 'success' | 'error' } | null = null;
  let pollInterval: any = null;

  onMount(() => {
    if (isOpen) {
      loadStatus();
      loadTelegramConfig();
      startPolling();
    }
  });

  $: if (isOpen) {
    loadStatus();
    loadTelegramConfig();
    startPolling();
  } else {
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(() => {
      loadStatus();
      if (activeTab === 'telegram') {
        loadTelegramConfig(false);
      }
    }, 4000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function loadStatus() {
    try {
      status = await api.getBotStatus();
    } catch (e) {
      console.warn('Bot status check error:', e);
    }
  }

  async function loadTelegramConfig(syncInput = true) {
    try {
      telegramConfig = await api.getTelegramConfig();
      if (syncInput && telegramConfig.token) {
        botTokenInput = telegramConfig.token;
      }
    } catch (e) {
      console.warn('Telegram config load error:', e);
    }
  }

  async function handleRestartWhatsApp() {
    loadingWa = true;
    try {
      await api.restartWhatsApp();
      await loadStatus();
    } catch (e) {
      console.error(e);
    } finally {
      loadingWa = false;
    }
  }

  async function handleSaveTelegramBot() {
    if (!botTokenInput.trim()) {
      telegramMessage = { text: 'Token bot tidak boleh kosong.', type: 'error' };
      return;
    }

    savingTelegram = true;
    telegramMessage = null;
    try {
      const res = await api.updateTelegramConfig({ botToken: botTokenInput.trim() });
      telegramMessage = { text: res.message || 'Bot berhasil diaktifkan!', type: 'success' };
      await loadTelegramConfig();
      await loadStatus();
    } catch (e: any) {
      telegramMessage = { text: e.message || 'Gagal mengaktifkan bot Telegram.', type: 'error' };
    } finally {
      savingTelegram = false;
    }
  }

  async function handleStopTelegramBot() {
    if (!confirm('Apakah Anda yakin ingin menonaktifkan bot Telegram mandiri keluarga ini?')) return;

    savingTelegram = true;
    telegramMessage = null;
    try {
      await api.deleteTelegramConfig();
      botTokenInput = '';
      telegramMessage = { text: 'Bot Telegram mandiri dinonaktifkan. Sistem kembali menggunakan Bot Global.', type: 'success' };
      await loadTelegramConfig();
      await loadStatus();
    } catch (e: any) {
      telegramMessage = { text: e.message || 'Gagal menghentikan bot.', type: 'error' };
    } finally {
      savingTelegram = false;
    }
  }

  async function handleAddWhitelist() {
    if (!newUserId.trim() || !newUserName.trim()) {
      alert('Mohon isi User ID dan Nama Anggota.');
      return;
    }

    addingWhitelist = true;
    try {
      await api.addTelegramWhitelist({
        identifier: newUserId.trim(),
        name: newUserName.trim(),
      });
      newUserId = '';
      newUserName = '';
      await loadTelegramConfig(false);
      await loadStatus();
    } catch (e: any) {
      alert(e.message || 'Gagal menambahkan User ID.');
    } finally {
      addingWhitelist = false;
    }
  }

  async function handleDeleteWhitelist(id: string) {
    if (!confirm('Hapus User ID ini dari whitelist bot?')) return;

    try {
      await api.deleteTelegramWhitelist(id);
      await loadTelegramConfig(false);
      await loadStatus();
    } catch (e: any) {
      alert(e.message || 'Gagal menghapus User ID.');
    }
  }

  $: displayBotUsername = telegramConfig.username || telegramConfig.globalBotUsername || 'MoneeAiBot';
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-xl bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      
      <!-- Modal Header -->
      <div class="p-6 pb-4 bg-gradient-to-r from-brand-sky-light via-brand-peach-light to-brand-butter-light border-b border-white/40 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky to-brand-butter flex items-center justify-center text-brand-indigo shadow-xs">
            <Bot class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-brand-indigo">Bot AI & Multi-Platform Asisten</h3>
            <p class="text-xs text-brand-indigo/60">Telegram & WhatsApp Gateway Keuangan Keluarga</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo transition">
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Navigation Tabs -->
      <div class="flex border-b border-brand-indigo/5 bg-white/60 px-6 pt-3 gap-2">
        <button
          type="button"
          on:click={() => (activeTab = 'telegram')}
          class="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-2xl border-b-2 transition {activeTab === 'telegram'
            ? 'border-brand-sky-dark text-brand-indigo bg-white shadow-xs'
            : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo hover:bg-white/40'}"
        >
          <Send class="w-3.5 h-3.5 text-sky-600" />
          Bot Telegram
          {#if telegramConfig.isRunning || telegramConfig.globalBotRunning}
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          {/if}
        </button>

        <button
          type="button"
          on:click={() => (activeTab = 'whatsapp')}
          class="flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-2xl border-b-2 transition {activeTab === 'whatsapp'
            ? 'border-brand-sky-dark text-brand-indigo bg-white shadow-xs'
            : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo hover:bg-white/40'}"
        >
          <Smartphone class="w-3.5 h-3.5 text-emerald-600" />
          WhatsApp Web (Baileys)
          {#if status.whatsappConnected}
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
          {/if}
        </button>
      </div>

      <div class="p-6 space-y-4 max-h-[72vh] overflow-y-auto">

        <!-- ================= TELEGRAM TAB ================= -->
        {#if activeTab === 'telegram'}
          <!-- Hero Card: Bot Telegram Global -->
          <div class="p-4 rounded-3xl bg-gradient-to-br from-white/95 to-brand-sky-light/50 border border-brand-sky/30 shadow-xs space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-9 h-9 rounded-2xl bg-sky-500 text-white flex items-center justify-center shadow-xs">
                  <Send class="w-4 h-4 ml-0.5" />
                </div>
                <div>
                  <h4 class="text-xs font-bold text-brand-indigo">Bot Telegram Resmi</h4>
                  <p class="text-[11px] text-brand-indigo/60">@{displayBotUsername}</p>
                </div>
              </div>

              <div class="flex items-center gap-2">
                {#if telegramConfig.isRunning || telegramConfig.globalBotRunning}
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                    <CheckCircle2 class="w-3.5 h-3.5" /> Online 24/7
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
                    Menghubungkan...
                  </span>
                {/if}
              </div>
            </div>

            <p class="text-xs text-brand-indigo/70 leading-relaxed">
              Seluruh anggota keluarga Anda dapat menggunakan bot ini untuk mencatat pengeluaran, foto struk, dan voice note. Bot <b>otomatis mengenali keluarga Anda</b> berdasarkan User ID yang didaftarkan di bawah ini.
            </p>

            <a
              href="https://t.me/{displayBotUsername}"
              target="_blank"
              rel="noreferrer"
              class="w-full py-2.5 rounded-2xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-xs flex items-center justify-center gap-2 transition"
            >
              <Send class="w-3.5 h-3.5" />
              Buka @{displayBotUsername} di Telegram
              <ExternalLink class="w-3 h-3 opacity-80" />
            </a>
          </div>

          <!-- Multiple User ID Whitelist Card -->
          <div class="p-4 rounded-3xl bg-white/80 border border-white/90 shadow-sm space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600">
                  <UserCheck class="w-4 h-4" />
                </div>
                <div>
                  <h4 class="text-xs font-bold text-brand-indigo">Whitelist Anggota Keluarga</h4>
                  <p class="text-[11px] text-brand-indigo/60">Daftar User ID Telegram yang diizinkan mengelola keuangan</p>
                </div>
              </div>
            </div>

            <!-- Form Tambah User ID -->
            <div class="p-3 bg-brand-sky-light/40 rounded-2xl border border-brand-sky/20 space-y-2">
              <span class="text-[11px] font-bold text-brand-indigo block">+ Tambah User ID Anggota</span>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  bind:value={newUserId}
                  placeholder="Telegram User ID (e.g. 12345678)"
                  class="px-3 py-2 rounded-xl bg-white border border-brand-indigo/15 text-xs text-brand-indigo focus:outline-hidden focus:ring-1 focus:ring-brand-sky"
                />
                <input
                  type="text"
                  bind:value={newUserName}
                  placeholder="Nama Anggota (e.g. Ayah / Bunda / Anak)"
                  class="px-3 py-2 rounded-xl bg-white border border-brand-indigo/15 text-xs text-brand-indigo focus:outline-hidden focus:ring-1 focus:ring-brand-sky"
                />
              </div>
              <div class="flex items-center justify-between pt-1">
                <p class="text-[10px] text-brand-indigo/60 flex items-center gap-1">
                  <HelpCircle class="w-3 h-3 text-brand-indigo/40" />
                  Ketik <code class="bg-white/80 px-1 rounded">/start</code> di bot untuk melihat User ID.
                </p>
                <button
                  type="button"
                  on:click={handleAddWhitelist}
                  disabled={addingWhitelist}
                  class="px-3 py-1.5 rounded-xl bg-brand-sky-dark text-white text-xs font-bold shadow-xs hover:opacity-95 transition disabled:opacity-50 flex items-center gap-1"
                >
                  <Plus class="w-3.5 h-3.5" />
                  Tambah ID
                </button>
              </div>
            </div>

            <!-- Whitelisted List -->
            <div class="space-y-2">
              {#if telegramConfig.memberUsers.length === 0 && telegramConfig.whitelists.length === 0}
                <div class="p-4 text-center rounded-2xl bg-gray-50 border border-gray-100 text-xs text-brand-indigo/60">
                  Belum ada User ID Telegram yang didaftarkan.
                </div>
              {:else}
                <!-- Member Users with TelegramChatId -->
                {#each telegramConfig.memberUsers as user}
                  <div class="p-2.5 rounded-2xl bg-white border border-brand-indigo/10 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs font-bold">
                        {user.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs font-bold text-brand-indigo">{user.name}</span>
                          <span class="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-purple-100 text-purple-700">
                            {user.role}
                          </span>
                        </div>
                        <span class="text-[11px] font-mono text-brand-indigo/60">ID: {user.telegramChatId}</span>
                      </div>
                    </div>
                    <span class="text-[10px] text-emerald-600 font-semibold px-2 py-0.5 rounded-full bg-emerald-50">
                      User Terdaftar
                    </span>
                  </div>
                {/each}

                <!-- Extra Whitelisted Telegram Users -->
                {#each telegramConfig.whitelists as item}
                  <div class="p-2.5 rounded-2xl bg-white border border-brand-indigo/10 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center text-xs font-bold">
                        {item.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div class="flex items-center gap-1.5">
                          <span class="text-xs font-bold text-brand-indigo">{item.name}</span>
                          <span class="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-sky-100 text-sky-700">
                            Whitelist
                          </span>
                        </div>
                        <span class="text-[11px] font-mono text-brand-indigo/60">ID: {item.identifier}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      on:click={() => handleDeleteWhitelist(item.id)}
                      class="p-1.5 rounded-xl hover:bg-rose-50 text-rose-500 hover:text-rose-700 transition"
                      title="Hapus ID"
                    >
                      <Trash2 class="w-4 h-4" />
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>

          <!-- Collapsible: Advanced Custom Bot Token (Opsional) -->
          <div class="p-3.5 rounded-2xl bg-gray-50/80 border border-gray-200/70 space-y-2">
            <button
              type="button"
              on:click={() => (showAdvancedBotToken = !showAdvancedBotToken)}
              class="w-full flex items-center justify-between text-xs font-bold text-brand-indigo/70 hover:text-brand-indigo transition"
            >
              <div class="flex items-center gap-2">
                <KeyRound class="w-3.5 h-3.5 text-brand-indigo/50" />
                <span>Gunakan Bot Telegram Mandiri Pribadi (Opsional / Lanjutan)</span>
              </div>
              {#if showAdvancedBotToken}
                <ChevronUp class="w-4 h-4 text-brand-indigo/40" />
              {:else}
                <ChevronDown class="w-4 h-4 text-brand-indigo/40" />
              {/if}
            </button>

            {#if showAdvancedBotToken}
              <div class="pt-2 space-y-2.5 animate-in fade-in duration-150">
                <p class="text-[11px] text-brand-indigo/60">
                  Secara default sistem menggunakan bot resmi @{displayBotUsername}. Namun jika keluarga Anda ingin bot khusus dari @BotFather, masukkan token di bawah:
                </p>
                <input
                  type="text"
                  bind:value={botTokenInput}
                  placeholder="Contoh: 7123456789:AAHk..."
                  class="w-full px-3 py-2 rounded-xl bg-white border border-brand-indigo/15 text-xs text-brand-indigo focus:outline-hidden focus:ring-1 focus:ring-brand-sky"
                />

                {#if telegramMessage}
                  <div class="p-2 rounded-xl text-xs font-medium {telegramMessage.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                    {telegramMessage.text}
                  </div>
                {/if}

                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    on:click={handleSaveTelegramBot}
                    disabled={savingTelegram}
                    class="flex-1 py-2 rounded-xl bg-brand-sky-dark text-white text-xs font-bold shadow-xs hover:opacity-95 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw class="w-3 h-3 {savingTelegram ? 'animate-spin' : ''}" />
                    Simpan Token Mandiri
                  </button>

                  {#if telegramConfig.configured}
                    <button
                      type="button"
                      on:click={handleStopTelegramBot}
                      disabled={savingTelegram}
                      class="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition"
                    >
                      Reset ke Global
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- ================= WHATSAPP TAB ================= -->
        {#if activeTab === 'whatsapp'}
          <div class="p-3.5 rounded-2xl bg-brand-sky-light/80 border border-brand-sky/40 flex items-start gap-2.5 text-xs text-brand-indigo">
            <ShieldCheck class="w-5 h-5 text-brand-sky-dark flex-shrink-0 mt-0.5" />
            <div>
              <span class="font-bold">WhatsApp Multi-Family Whitelist:</span>
              <p class="text-brand-indigo/70 mt-0.5">
                Hanya nomor WhatsApp anggota keluarga yang terdaftar yang dilayani. Pesan dari nomor tak dikenal otomatis diabaikan.
              </p>
            </div>
          </div>

          <div class="p-4 rounded-3xl bg-white/80 border border-white/90 shadow-sm space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-xl bg-[#25D366]/20 flex items-center justify-center text-[#25D366]">
                  <Smartphone class="w-4 h-4" />
                </div>
                <div>
                  <h4 class="text-xs font-bold text-brand-indigo">WhatsApp Web (Baileys)</h4>
                  <p class="text-[11px] text-brand-indigo/60">Multi-Device Socket 24/7</p>
                </div>
              </div>

              <div class="flex items-center gap-2">
                {#if status.whatsappConnected}
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                    <CheckCircle2 class="w-3.5 h-3.5" /> Terhubung
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                    <AlertCircle class="w-3.5 h-3.5" /> Menunggu Scan QR
                  </span>
                {/if}
              </div>
            </div>

            {#if !status.whatsappConnected}
              {#if status.whatsappQr}
                <div class="p-4 text-center bg-white rounded-2xl border border-brand-indigo/10 space-y-2">
                  <p class="text-xs font-medium text-brand-indigo/70">
                    Buka WhatsApp di ponsel &rarr; Perangkat Tertaut &rarr; Tautkan Perangkat:
                  </p>
                  <img src={status.whatsappQr} alt="QR WhatsApp" class="w-48 h-48 mx-auto rounded-xl shadow-xs" />
                </div>
              {:else}
                <div class="p-4 text-center bg-gray-50 rounded-2xl border border-gray-100 text-xs text-brand-indigo/60">
                  Memuat kode QR...
                </div>
              {/if}

              <button
                type="button"
                on:click={handleRestartWhatsApp}
                disabled={loadingWa}
                class="w-full py-2.5 rounded-2xl bg-white hover:bg-gray-50 border border-white/80 text-xs font-bold text-brand-indigo shadow-xs flex items-center justify-center gap-1.5 transition"
              >
                <RefreshCw class="w-3.5 h-3.5 {loadingWa ? 'animate-spin' : ''}" />
                Refresh / Mulai Ulang Sesi WhatsApp
              </button>
            {/if}
          </div>
        {/if}

      </div>
    </div>
  </div>
{/if}
