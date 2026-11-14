<script lang="ts">
  import type { SinkingFund } from '../types';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah } from '../utils/format';
  import { PiggyBank, Plus, Calendar, Target, CheckCircle } from 'lucide-svelte';

  export let funds: SinkingFund[] = [];
  export let onAddFund: () => void;
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <div class="w-8 h-8 rounded-xl bg-brand-butter flex items-center justify-center text-brand-indigo shadow-xs">
        <PiggyBank class="w-4 h-4" />
      </div>
      <div>
        <h2 class="text-base font-bold text-brand-indigo">Sinking Funds (Pos Dana Siaga)</h2>
        <p class="text-xs text-brand-indigo/60 font-medium">Alokasi otomatis bulanan untuk pos tahunan & darurat</p>
      </div>
    </div>
    <button
      on:click={onAddFund}
      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/80 hover:bg-white text-brand-indigo text-xs font-semibold border border-white/80 shadow-xs transition"
    >
      <Plus class="w-3.5 h-3.5 text-brand-peach-dark" />
      Tambah Pos
    </button>
  </div>

  {#if funds.length === 0}
    <div class="p-8 text-center rounded-3xl bg-white/60 border border-white/80 backdrop-blur-md">
      <p class="text-xs text-brand-indigo/60">Belum ada pos dana siaga. Contoh: Pajak Mobil Tahunan, Dana Kurban, Liburan.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {#each funds as fund}
        {@const pct = Math.min(100, Math.round((fund.currentAmount / fund.targetAmount) * 100))}
        <div class="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm hover:shadow-glass transition space-y-3">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="text-sm font-bold text-brand-indigo">{fund.name}</h3>
              <p class="text-[11px] text-brand-indigo/60 flex items-center gap-1 mt-0.5">
                <Calendar class="w-3 h-3 text-brand-peach-dark" />
                Alokasi: {formatRupiah(fund.monthlyAlloc)}/bulan
              </p>
            </div>
            <span class="px-2.5 py-1 rounded-full text-xs font-black {pct >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-butter-light text-brand-indigo'}">
              {pct}%
            </span>
          </div>

          <!-- Progress Bar -->
          <div class="space-y-1">
            <div class="w-full h-2.5 rounded-full bg-brand-indigo/10 overflow-hidden">
              <div
                class="h-full bg-gradient-to-r from-brand-butter via-brand-peach to-brand-sky transition-all duration-500"
                style="width: {pct}%"
              ></div>
            </div>
            <div class="flex items-center justify-between text-[11px] font-semibold text-brand-indigo/70 pt-0.5">
              <span>
                {#if $privacyMode}
                  <span class="text-brand-indigo/40 select-none">Rp •••••</span>
                {:else}
                  {formatRupiah(fund.currentAmount)}
                {/if}
              </span>
              <span class="text-brand-indigo/50">
                Target: {formatRupiah(fund.targetAmount)}
              </span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
