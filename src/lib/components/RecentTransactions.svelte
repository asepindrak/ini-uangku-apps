<script lang="ts">
  import type { Transaction } from '../types';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah, formatDate } from '../utils/format';
  import {
    ArrowUpRight,
    ArrowDownRight,
    Receipt,
    Mic,
    MessageSquare,
    Send,
    Repeat,
    Smartphone,
  } from 'lucide-svelte';

  export let transactions: Transaction[] = [];

  function getSourceBadge(source: string) {
    if (source.includes('IMAGE_RECEIPT')) {
      return { label: 'Nota WA', icon: Receipt, bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (source.includes('IMAGE_PAPER')) {
      return { label: 'Kertas Kotretan', icon: Receipt, bg: 'bg-amber-50 text-amber-700 border-amber-200' };
    }
    if (source.includes('VOICE_NOTE')) {
      return { label: 'Voice Note', icon: Mic, bg: 'bg-purple-50 text-purple-700 border-purple-200' };
    }
    if (source.includes('WHATSAPP')) {
      return { label: 'WA Bot', icon: MessageSquare, bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    }
    if (source.includes('TELEGRAM')) {
      return { label: 'Telegram Bot', icon: Send, bg: 'bg-sky-50 text-sky-700 border-sky-200' };
    }
    if (source.includes('RECURRING')) {
      return { label: 'Auto Tagihan', icon: Repeat, bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    }
    return { label: 'Manual App', icon: Smartphone, bg: 'bg-gray-50 text-gray-700 border-gray-200' };
  }
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <div class="w-8 h-8 rounded-xl bg-brand-peach flex items-center justify-center text-brand-indigo shadow-xs">
        <Receipt class="w-4 h-4" />
      </div>
      <div>
        <h2 class="text-base font-bold text-brand-indigo">Transaksi Terbaru</h2>
        <p class="text-xs text-brand-indigo/60 font-medium">Catatan otomatis dari Bot WhatsApp, Telegram, struk belanja & VN</p>
      </div>
    </div>
  </div>

  {#if transactions.length === 0}
    <div class="p-8 text-center rounded-3xl bg-white/60 border border-white/80 backdrop-blur-md">
      <p class="text-xs text-brand-indigo/60">Belum ada transaksi. Kirim foto struk atau pesan ke WhatsApp/Telegram untuk mulai mencatat!</p>
    </div>
  {:else}
    <div class="rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm divide-y divide-white/80 overflow-hidden">
      {#each transactions as t}
        {@const badge = getSourceBadge(t.inputSource)}
        <div class="p-4 sm:px-6 flex items-center justify-between gap-4 hover:bg-white/50 transition">
          <div class="flex items-center gap-3.5 min-w-0">
            <div class="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 {t.type === 'INCOME' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-peach-light text-brand-indigo'}">
              {#if t.type === 'INCOME'}
                <ArrowUpRight class="w-5 h-5" />
              {:else}
                <ArrowDownRight class="w-5 h-5" />
              {/if}
            </div>

            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h4 class="text-sm font-bold text-brand-indigo truncate">{t.description}</h4>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border {badge.bg}">
                  <svelte:component this={badge.icon} class="w-2.5 h-2.5" />
                  {badge.label}
                </span>
              </div>
              <p class="text-xs text-brand-indigo/60 flex items-center gap-2 mt-0.5">
                <span>{t.walletName}</span>
                <span>•</span>
                <span>{t.categoryName || 'Umum'}</span>
                <span>•</span>
                <span>{formatDate(t.transactionDate)}</span>
              </p>
            </div>
          </div>

          <div class="text-right flex-shrink-0">
            <div class="text-sm sm:text-base font-black {t.type === 'INCOME' ? 'text-emerald-600' : 'text-brand-indigo'}">
              {#if $privacyMode}
                <span class="text-brand-indigo/40 select-none">Rp •••••</span>
              {:else}
                {t.type === 'INCOME' ? '+' : '-'}{formatRupiah(t.amount)}
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
