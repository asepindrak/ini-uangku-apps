<script lang="ts">
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah } from '../utils/format';
  import { TrendingUp, Landmark, ShieldAlert, ArrowUpRight, ArrowDownRight } from 'lucide-svelte';

  export let totalCash: number = 0;
  export let totalAsset: number = 0;
  export let totalDebt: number = 0;
  export let netWorth: number = 0;

  $: totalGross = totalCash + totalAsset;
  $: cashPct = totalGross > 0 ? (totalCash / totalGross) * 100 : 50;
  $: assetPct = totalGross > 0 ? (totalAsset / totalGross) * 100 : 50;
</script>

<div class="p-6 rounded-3xl bg-white/75 backdrop-blur-2xl border border-white/80 shadow-glass space-y-5">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2.5">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-butter to-brand-sky flex items-center justify-center text-brand-indigo shadow-xs">
        <TrendingUp class="w-5 h-5" />
      </div>
      <div>
        <h2 class="text-base font-bold text-brand-indigo">Kekayaan Bersih Keluarga (Net Worth)</h2>
        <p class="text-xs text-brand-indigo/60 font-medium">Kalkulasi: (Total Kas + Aset Riil) - Sisa Cicilan</p>
      </div>
    </div>

    <div class="text-right">
      <span class="text-xs text-brand-indigo/60 font-medium uppercase tracking-wider">Net Worth</span>
      <div class="text-2xl font-black text-brand-indigo tracking-tight font-sans">
        {#if $privacyMode}
          <span class="text-brand-indigo/40 select-none">Rp ••••••••</span>
        {:else}
          {formatRupiah(netWorth)}
        {/if}
      </div>
    </div>
  </div>

  <!-- Visual Proportion Bar -->
  <div class="space-y-1.5">
    <div class="w-full h-3 rounded-full bg-brand-indigo/10 overflow-hidden flex shadow-inner">
      <div class="h-full bg-brand-sky transition-all duration-500" style="width: {cashPct}%" title="Kas & Saldo Bank"></div>
      <div class="h-full bg-brand-butter transition-all duration-500" style="width: {assetPct}%" title="Aset & Investasi"></div>
    </div>
    <div class="flex items-center justify-between text-[11px] text-brand-indigo/60 font-medium">
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-brand-sky"></span> Kas & Bank: {cashPct.toFixed(0)}%</span>
      <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-brand-butter"></span> Aset & Emas: {assetPct.toFixed(0)}%</span>
    </div>
  </div>

  <!-- Breakdown Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
    <!-- Kas & Bank -->
    <div class="p-3.5 rounded-2xl bg-brand-sky-light/80 border border-brand-sky/40">
      <div class="flex items-center justify-between text-xs text-brand-indigo/70 font-semibold mb-1">
        <span>Total Kas & Bank</span>
        <ArrowUpRight class="w-4 h-4 text-emerald-500" />
      </div>
      <div class="text-base font-black text-brand-indigo">
        {#if $privacyMode}
          <span class="text-brand-indigo/40 select-none">Rp ••••••••</span>
        {:else}
          {formatRupiah(totalCash)}
        {/if}
      </div>
    </div>

    <!-- Aset Riil -->
    <div class="p-3.5 rounded-2xl bg-brand-butter-light/80 border border-brand-butter/40">
      <div class="flex items-center justify-between text-xs text-brand-indigo/70 font-semibold mb-1">
        <span>Total Aset & Emas</span>
        <Landmark class="w-4 h-4 text-amber-500" />
      </div>
      <div class="text-base font-black text-brand-indigo">
        {#if $privacyMode}
          <span class="text-brand-indigo/40 select-none">Rp ••••••••</span>
        {:else}
          {formatRupiah(totalAsset)}
        {/if}
      </div>
    </div>

    <!-- Sisa Cicilan/Utang -->
    <div class="p-3.5 rounded-2xl bg-brand-peach-light/80 border border-brand-peach/40">
      <div class="flex items-center justify-between text-xs text-brand-indigo/70 font-semibold mb-1">
        <span>Sisa Utang / KPR</span>
        <ArrowDownRight class="w-4 h-4 text-red-500" />
      </div>
      <div class="text-base font-black text-brand-indigo">
        {#if $privacyMode}
          <span class="text-brand-indigo/40 select-none">Rp ••••••••</span>
        {:else}
          {formatRupiah(totalDebt)}
        {/if}
      </div>
    </div>
  </div>
</div>
