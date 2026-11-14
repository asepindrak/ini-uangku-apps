<script lang="ts">
  import {
    updateInfo,
    updateModalOpen,
    updateDownloading,
    updateProgress,
    updateStatusMessage,
    updateErrorMessage,
  } from '../stores/update';
  import { downloadAndInstallUpdate, formatBytes, isTauri } from '../utils/tauri-ipc';
  import { marked } from 'marked';
  import {
    Sparkles,
    Download,
    X,
    ExternalLink,
    AlertCircle,
    CheckCircle2,
    Loader2,
  } from 'lucide-svelte';

  function handleClose() {
    updateModalOpen.set(false);
  }

  async function handleUpdateNow() {
    if (!$updateInfo || !$updateInfo.download_url || !$updateInfo.asset_name) {
      if ($updateInfo?.html_url) {
        window.open($updateInfo.html_url, '_blank');
      }
      return;
    }

    updateErrorMessage.set('');
    updateDownloading.set(true);
    updateStatusMessage.set('Menghubungkan ke server pembaruan GitHub...');

    try {
      const result = await downloadAndInstallUpdate(
        $updateInfo.download_url,
        $updateInfo.asset_name
      );
      updateStatusMessage.set(result);
    } catch (err: any) {
      console.error('Update failed:', err);
      updateErrorMessage.set(typeof err === 'string' ? err : err?.message || 'Gagal mengunduh pembaruan');
      updateDownloading.set(false);
    }
  }

  function handleOpenBrowser() {
    if ($updateInfo?.html_url) {
      window.open($updateInfo.html_url, '_blank');
    }
  }
</script>

{#if $updateModalOpen && $updateInfo}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div
      class="relative w-full max-w-xl max-h-[90vh] flex flex-col bg-white/85 backdrop-blur-2xl rounded-3xl border border-white/60 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200"
    >
      <!-- Header Pastel Glow -->
      <div class="relative px-6 pt-6 pb-4 bg-gradient-to-r from-brand-sky-light via-brand-peach-light to-brand-butter-light border-b border-white/40">
        <button
          on:click={handleClose}
          class="absolute top-5 right-5 p-2 rounded-full text-brand-indigo/60 hover:text-brand-indigo hover:bg-white/60 transition"
          aria-label="Tutup"
        >
          <X class="w-5 h-5" />
        </button>

        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-gradient-to-tr from-brand-peach to-brand-sky flex items-center justify-center shadow-sm">
            <Sparkles class="w-6 h-6 text-brand-indigo" />
          </div>
          <div>
            <h3 class="text-xl font-bold text-brand-indigo tracking-tight">Pembaruan Versi Baru Tersedia! 🎀</h3>
            <p class="text-xs text-brand-indigo/70 mt-0.5">Versi {$updateInfo.latest_version} siap diinstal (Anda memakai v{$updateInfo.current_version})</p>
          </div>
        </div>
      </div>

      <!-- Content Changelog -->
      <div class="p-6 overflow-y-auto flex-1 space-y-4 text-brand-indigo">
        <div class="p-4 rounded-2xl bg-white/60 border border-white/80 shadow-sm flex items-center justify-between text-xs">
          <div>
            <span class="text-brand-indigo/60">Paket Rilis:</span>
            <span class="font-semibold text-brand-indigo ml-1">{$updateInfo.asset_name || 'Installer Resmi'}</span>
          </div>
          {#if $updateInfo.asset_size}
            <div>
              <span class="text-brand-indigo/60">Ukuran:</span>
              <span class="font-semibold text-brand-indigo ml-1">{formatBytes($updateInfo.asset_size)}</span>
            </div>
          {/if}
        </div>

        <div>
          <h4 class="text-sm font-semibold text-brand-indigo mb-2">Catatan Rilis & Fitur Baru:</h4>
          <div class="p-4 rounded-2xl bg-white/50 border border-white/60 max-h-56 overflow-y-auto text-xs prose prose-sm text-brand-indigo/80">
            {@html marked.parse($updateInfo.release_notes || 'Peningkatan performa dan perbaikan antarmuka.')}
          </div>
        </div>

        {#if $updateErrorMessage}
          <div class="p-3 rounded-2xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-center gap-2">
            <AlertCircle class="w-4 h-4 flex-shrink-0" />
            <span>{$updateErrorMessage}</span>
          </div>
        {/if}

        {#if $updateDownloading}
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs font-semibold text-brand-indigo">
              <span class="flex items-center gap-1.5">
                <Loader2 class="w-3.5 h-3.5 animate-spin text-brand-peach-dark" />
                {$updateStatusMessage || 'Mengunduh paket...'}
              </span>
              <span>{$updateProgress.toFixed(0)}%</span>
            </div>
            <div class="w-full h-2.5 rounded-full bg-brand-indigo/10 overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-brand-sky via-brand-peach to-brand-butter transition-all duration-200"
                style="width: {$updateProgress}%"
              ></div>
            </div>
          </div>
        {/if}
      </div>

      <!-- Footer Buttons -->
      <div class="p-6 pt-3 bg-white/40 border-t border-white/50 flex items-center justify-between gap-3">
        <button
          on:click={handleOpenBrowser}
          class="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-xs font-medium text-brand-indigo/70 hover:text-brand-indigo hover:bg-white/60 transition"
        >
          <ExternalLink class="w-4 h-4" />
          Buka di GitHub
        </button>

        <div class="flex items-center gap-2">
          <button
            on:click={handleClose}
            class="px-5 py-2.5 rounded-2xl text-xs font-semibold text-brand-indigo/70 hover:bg-white/60 transition"
          >
            Nanti Saja
          </button>

          <button
            on:click={handleUpdateNow}
            disabled={$updateDownloading}
            class="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl text-xs font-bold text-brand-indigo bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-50"
          >
            {#if $updateDownloading}
              <Loader2 class="w-4 h-4 animate-spin" />
              Mengunduh...
            {:else}
              <Download class="w-4 h-4" />
              Perbarui Sekarang
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
