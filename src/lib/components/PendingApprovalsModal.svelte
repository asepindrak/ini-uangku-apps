<script lang="ts">
  import type { PendingAction } from '../types';
  import { formatRupiah, formatDate } from '../utils/format';
  import { api } from '../api';
  import { X, Check, AlertTriangle, Clock } from 'lucide-svelte';

  export let pendingActions: PendingAction[] = [];
  export let isOpen: boolean = false;
  export let onClose: () => void;
  export let onActionProcessed: () => void;

  let loadingId: string | null = null;
  let statusMessage = '';

  async function handleRespond(id: string, approved: boolean) {
    loadingId = id;
    statusMessage = '';
    try {
      const res = await api.respondPendingAction(id, approved);
      statusMessage = res.message || (approved ? 'Berhasil disetujui!' : 'Berhasil dibatalkan.');
      setTimeout(() => {
        onActionProcessed();
        if (pendingActions.length <= 1) {
          onClose();
        }
      }, 1000);
    } catch (err: any) {
      alert(err.message || 'Gagal memproses persetujuan');
    } finally {
      loadingId = null;
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-lg bg-white/90 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <div class="p-6 bg-gradient-to-r from-brand-peach-light via-brand-butter-light to-brand-sky-light border-b border-white/40 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-2xl bg-brand-peach flex items-center justify-center text-brand-indigo shadow-xs">
            <AlertTriangle class="w-5 h-5 text-brand-peach-dark" />
          </div>
          <div>
            <h3 class="text-base font-bold text-brand-indigo">Persetujuan Transaksi AI ({pendingActions.length})</h3>
            <p class="text-xs text-brand-indigo/60">Draf mutasi yang diajukan bot dan membutuhkan persetujuan Anda</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo">
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="p-6 max-h-[60vh] overflow-y-auto space-y-4">
        {#if statusMessage}
          <div class="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            {statusMessage}
          </div>
        {/if}

        {#if pendingActions.length === 0}
          <div class="py-8 text-center text-xs text-brand-indigo/60">
            Tidak ada transaksi yang sedang menunggu persetujuan.
          </div>
        {:else}
          {#each pendingActions as action}
            <div class="p-4 rounded-2xl bg-white/70 border border-white/90 shadow-sm space-y-3">
              <div class="flex items-center justify-between text-xs text-brand-indigo/60">
                <span class="flex items-center gap-1 font-semibold text-brand-indigo">
                  Diajukan untuk: {action.userName || 'Keluarga'}
                </span>
                <span class="flex items-center gap-1">
                  <Clock class="w-3.5 h-3.5" />
                  {formatDate(action.createdAt)}
                </span>
              </div>

              <div class="p-3 rounded-xl bg-white/60 border border-white/70 text-xs whitespace-pre-line text-brand-indigo/90 font-mono">
                {action.summaryText}
              </div>

              <div class="flex items-center justify-end gap-2 pt-1">
                <button
                  on:click={() => handleRespond(action.id, false)}
                  disabled={loadingId === action.id}
                  class="px-4 py-2 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition disabled:opacity-50"
                >
                  Tolak / Batal
                </button>
                <button
                  on:click={() => handleRespond(action.id, true)}
                  disabled={loadingId === action.id}
                  class="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-brand-indigo bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky hover:scale-[1.02] active:scale-[0.98] shadow-xs transition disabled:opacity-50"
                >
                  <Check class="w-3.5 h-3.5" />
                  Setujui Sekarang
                </button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
