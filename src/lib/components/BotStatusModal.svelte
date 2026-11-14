<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { BotStatus } from '../types';
  import { X, Bot, RefreshCw, CheckCircle2, AlertCircle, Smartphone, Send, ShieldCheck } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;

  let status: BotStatus = {
    whatsappConnected: false,
    whatsappQr: undefined,
    telegramConnected: false,
    whitelistCount: 0,
  };
  let loading = false;
  let pollInterval: any = null;

  onMount(() => {
    if (isOpen) startPolling();
  });

  $: if (isOpen) {
    loadStatus();
    startPolling();
  } else {
    stopPolling();
  }

  function startPolling() {
    stopPolling();
    pollInterval = setInterval(loadStatus, 4000);
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

  async function handleRestartWhatsApp() {
    loading = true;
    try {
      await api.restartWhatsApp();
      await loadStatus();
    } catch (e) {
      console.error(e);
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
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky to-brand-butter flex items-center justify-center text-brand-indigo shadow-xs">
            <Bot class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-brand-indigo">Status Bot AI Keluarga</h3>
            <p class="text-xs text-brand-indigo/60">WhatsApp (Baileys) & Telegram Bot Gateway</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo">
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        <!-- Whitelist Security Banner -->
        <div class="p-3.5 rounded-2xl bg-brand-sky-light/80 border border-brand-sky/40 flex items-start gap-2.5 text-xs text-brand-indigo">
          <ShieldCheck class="w-5 h-5 text-brand-sky-dark flex-shrink-0 mt-0.5" />
          <div>
            <span class="font-bold">Strict Whitelist Guard Aktif:</span>
            <p class="text-brand-indigo/70 mt-0.5">
              Hanya {status.whitelistCount} nomor anggota keluarga terdaftar yang dilayani. Pesan dari nomor lain otomatis diabaikan demi menjaga privasi dan token AI.
            </p>
          </div>
        </div>

        <!-- WhatsApp Baileys Section -->
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
                  Buka WhatsApp di ponsel $\rightarrow$ Perangkat Tertaut $\rightarrow$ Tautkan Perangkat:
                </p>
                <img src={status.whatsappQr} alt="QR WhatsApp" class="w-48 h-48 mx-auto rounded-xl shadow-xs" />
              </div>
            {:else}
              <div class="p-4 text-center bg-gray-50 rounded-2xl border border-gray-100 text-xs text-brand-indigo/60">
                Memuat kode QR...
              </div>
            {/if}

            <button
              on:click={handleRestartWhatsApp}
              disabled={loading}
              class="w-full py-2.5 rounded-2xl bg-white hover:bg-gray-50 border border-white/80 text-xs font-bold text-brand-indigo shadow-xs flex items-center justify-center gap-1.5 transition"
            >
              <RefreshCw class="w-3.5 h-3.5 {loading ? 'animate-spin' : ''}" />
              Refresh / Mulai Ulang Sesi WhatsApp
            </button>
          {/if}
        </div>

        <!-- Telegram Bot Section -->
        <div class="p-4 rounded-3xl bg-white/80 border border-white/90 shadow-sm flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center text-sky-600">
              <Send class="w-4 h-4" />
            </div>
            <div>
              <h4 class="text-xs font-bold text-brand-indigo">Telegram Bot</h4>
              <p class="text-[11px] text-brand-indigo/60">Polling Listener Gateway</p>
            </div>
          </div>

          {#if status.telegramConnected}
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
              <CheckCircle2 class="w-3.5 h-3.5" /> Aktif
            </span>
          {:else}
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
              Belum Dikonfigurasi
            </span>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
