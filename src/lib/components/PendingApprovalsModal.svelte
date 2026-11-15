<script lang="ts">
  import type { PendingAction } from '../types';
  import { formatRupiah, formatDate } from '../utils/format';
  import { api } from '../api';
  import { toast } from '../stores/toast';
  import { X, Check, AlertTriangle, Clock, ShieldCheck, Sparkles } from 'lucide-svelte';

  export let pendingActions: PendingAction[] = [];
  export let isOpen: boolean = false;
  export let onClose: () => void;
  export let onActionProcessed: () => void;

  let loadingId: string | null = null;
  let statusMessage = '';
  let alertMessage = '';

  async function handleRespond(id: string, approved: boolean) {
    loadingId = id;
    statusMessage = '';
    alertMessage = '';
    try {
      const res = await api.respondPendingAction(id, approved);
      statusMessage = res.message || (approved ? 'Berhasil disetujui & terjurnal!' : 'Berhasil dibatalkan.');
      if (res.alert) {
        alertMessage = res.alert;
      }
      setTimeout(() => {
        onActionProcessed();
        if (pendingActions.length <= 1) {
          onClose();
        }
      }, 1200);
    } catch (err: any) {
      toast.error(err.message || 'Gagal memproses persetujuan');
    } finally {
      loadingId = null;
    }
  }

  function getActionLabel(type: string) {
    if (type === 'CREATE_TRANSACTION') return '📝 Catat Transaksi Baru';
    if (type === 'UPDATE_TRANSACTION') return '✏️ Koreksi / Edit Transaksi';
    if (type === 'DELETE_TRANSACTION') return '🗑️ Hapus Transaksi';
    if (type === 'CREATE_WALLET') return '👛 Tambah Dompet Baru';
    if (type === 'TRANSFER_WALLET') return '🔄 Transfer Antar Dompet';
    if (type === 'SET_BUDGET') return '🎯 Atur Anggaran Kategori';
    if (type === 'CREATE_SINKING_FUND') return '💰 Buat Pos Dana Siaga';
    if (type === 'EXECUTE_SINKING_FUND') return '🎯 Alokasi Tabungan Dana Siaga';
    if (type === 'CREATE_RECURRING_BILL') return '⏰ Tagihan Rutin Baru';
    if (type === 'EXECUTE_RECURRING_BILL') return '💳 Pembayaran Tagihan Rutin';
    return '⚡ Aksi Finansial AI';
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/35 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/90 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <div class="p-6 bg-gradient-to-r from-brand-peach-light via-brand-butter-light to-brand-sky-light border-b border-white/50 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-brand-peach flex items-center justify-center text-brand-indigo shadow-xs">
            <Sparkles class="w-5 h-5 text-brand-peach-dark" />
          </div>
          <div>
            <h3 class="text-base font-extrabold text-brand-indigo flex items-center gap-2">
              Persetujuan AI Monee
              <span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-brand-indigo text-white shadow-xs">
                {pendingActions.length} Menunggu
              </span>
            </h3>
            <p class="text-xs text-brand-indigo/70 font-medium">100% Real-Time & Terhubung ke WhatsApp / Telegram Bot</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/70 text-brand-indigo/60 hover:text-brand-indigo transition">
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="p-6 max-h-[65vh] overflow-y-auto space-y-4">
        {#if statusMessage}
          <div class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2 shadow-xs">
            <ShieldCheck class="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{statusMessage}</span>
          </div>
        {/if}

        {#if alertMessage}
          <div class="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold whitespace-pre-line shadow-xs">
            {alertMessage}
          </div>
        {/if}

        {#if pendingActions.length === 0}
          <div class="py-12 text-center space-y-2">
            <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center">
              <Check class="w-6 h-6" />
            </div>
            <p class="text-sm font-bold text-brand-indigo">Semua Transaksi Sudah Disetujui!</p>
            <p class="text-xs text-brand-indigo/60 max-w-xs mx-auto">
              Tidak ada draf yang tertunda. Setiap pesan atau foto struk baru yang dikirim ke Monee akan muncul di sini.
            </p>
          </div>
        {:else}
          {#each pendingActions as action}
            <div class="p-4 rounded-2xl bg-white/80 border border-white/95 shadow-sm space-y-3">
              <div class="flex items-center justify-between text-xs text-brand-indigo/60">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-brand-sky-light text-brand-indigo border border-brand-sky">
                  {getActionLabel(action.actionType)}
                </span>
                <span class="flex items-center gap-1">
                  <Clock class="w-3.5 h-3.5 text-brand-indigo/50" />
                  {formatDate(action.createdAt)}
                </span>
              </div>

              <!-- Summary Card -->
              <div class="p-3.5 rounded-xl bg-white/70 border border-brand-indigo/5 text-xs whitespace-pre-line text-brand-indigo/90 font-mono leading-relaxed">
                {action.summaryText}
              </div>

              <div class="flex items-center justify-between pt-1">
                <span class="text-[11px] font-semibold text-brand-indigo/60">
                  Diajukan oleh: <b class="text-brand-indigo">{action.userName || 'Keluarga'}</b>
                </span>

                <div class="flex items-center gap-2">
                  <button
                    on:click={() => handleRespond(action.id, false)}
                    disabled={loadingId === action.id}
                    class="px-3.5 py-1.5 rounded-xl text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 transition disabled:opacity-50"
                  >
                    Tolak / Batal
                  </button>
                  <button
                    on:click={() => handleRespond(action.id, true)}
                    disabled={loadingId === action.id}
                    class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold text-brand-indigo bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky hover:scale-[1.02] active:scale-[0.98] shadow-xs transition disabled:opacity-50"
                  >
                    <Check class="w-3.5 h-3.5" />
                    {loadingId === action.id ? 'Menyimpan...' : 'Setujui Sekarang'}
                  </button>
                </div>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
