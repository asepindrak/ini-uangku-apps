<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah, formatDate } from '../utils/format';
  import type { Wallet } from '../types';
  import {
    BarChart3,
    TrendingUp,
    TrendingDown,
    PiggyBank,
    Wallet as WalletIcon,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    PieChart,
    AlertCircle,
    RefreshCw,
  } from 'lucide-svelte';

  export let wallets: Wallet[] = [];

  let selectedPeriod: '7d' | '30d' | '90d' | 'year' = '30d';
  let selectedWalletId = 'ALL';
  let isLoading = false;
  let analyticsData: any = null;
  let activeTooltip: { date: string; label: string; income: number; expense: number } | null = null;

  onMount(() => {
    loadAnalytics();
  });

  export async function loadAnalytics() {
    isLoading = true;
    try {
      const params = new URLSearchParams();
      params.append('period', selectedPeriod);
      if (selectedWalletId !== 'ALL') {
        params.append('walletId', selectedWalletId);
      }
      analyticsData = await api.getAnalytics(params.toString());
    } catch (err) {
      console.error('Error loading analytics:', err);
    } finally {
      isLoading = false;
    }
  }

  function handlePeriodChange(p: '7d' | '30d' | '90d' | 'year') {
    selectedPeriod = p;
    loadAnalytics();
  }

  function handleWalletChange(e: Event) {
    selectedWalletId = (e.target as HTMLSelectElement).value;
    loadAnalytics();
  }

  // Calculate highest value for dynamic bar scaling
  $: maxBarValue = analyticsData?.dailyTrend
    ? Math.max(...analyticsData.dailyTrend.map((d: any) => Math.max(d.income, d.expense)), 100000)
    : 100000;
</script>

<div class="space-y-6">
  <!-- Header Controls: Title, Period Pills & Wallet Filter -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div class="flex items-center gap-2.5">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky via-brand-peach to-brand-butter flex items-center justify-center text-brand-indigo shadow-xs">
        <BarChart3 class="w-5 h-5" />
      </div>
      <div>
        <h2 class="text-lg font-extrabold text-brand-indigo tracking-tight">Dashboard & Analitik Keuangan</h2>
        <p class="text-xs text-brand-indigo/60 font-medium">Tren arus kas, rasio tabungan, dan distribusi belanja keluarga</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <!-- Period Selector Pills -->
      <div class="p-1 rounded-2xl bg-white/80 border border-white/90 shadow-xs flex items-center gap-1">
        <button
          on:click={() => handlePeriodChange('7d')}
          class="px-3 py-1.5 rounded-xl text-xs font-bold transition {selectedPeriod === '7d' ? 'bg-brand-indigo text-white shadow-xs' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
        >
          7 Hari
        </button>
        <button
          on:click={() => handlePeriodChange('30d')}
          class="px-3 py-1.5 rounded-xl text-xs font-bold transition {selectedPeriod === '30d' ? 'bg-brand-indigo text-white shadow-xs' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
        >
          30 Hari
        </button>
        <button
          on:click={() => handlePeriodChange('90d')}
          class="px-3 py-1.5 rounded-xl text-xs font-bold transition {selectedPeriod === '90d' ? 'bg-brand-indigo text-white shadow-xs' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
        >
          3 Bulan
        </button>
        <button
          on:click={() => handlePeriodChange('year')}
          class="px-3 py-1.5 rounded-xl text-xs font-bold transition {selectedPeriod === 'year' ? 'bg-brand-indigo text-white shadow-xs' : 'text-brand-indigo/60 hover:text-brand-indigo'}"
        >
          Tahun Ini
        </button>
      </div>

      <!-- Wallet Selector -->
      <select
        value={selectedWalletId}
        on:change={handleWalletChange}
        class="px-3 py-1.5 rounded-2xl bg-white/80 border border-white/90 text-xs font-bold text-brand-indigo shadow-xs outline-none focus:ring-2 focus:ring-brand-sky"
      >
        <option value="ALL">Semua Dompet</option>
        {#each wallets as w}
          <option value={w.id}>{w.name}</option>
        {/each}
      </select>

      <button
        on:click={loadAnalytics}
        class="p-2 rounded-2xl bg-white/80 border border-white/90 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
        title="Muat Ulang Data Analitik"
      >
        <RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
      </button>
    </div>
  </div>

  {#if isLoading && !analyticsData}
    <div class="py-16 text-center text-xs font-bold text-brand-indigo/60 animate-pulse">
      Memproses data analitik keuangan keluarga...
    </div>
  {:else if analyticsData}
    <!-- 1. KPI Cards Grid (4 Cards) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <!-- Total Pemasukan -->
      <div class="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm flex items-center justify-between">
        <div>
          <span class="text-xs font-bold text-brand-indigo/60 flex items-center gap-1.5">
            <TrendingUp class="w-3.5 h-3.5 text-emerald-600" />
            Total Pemasukan
          </span>
          <div class="text-xl font-black text-emerald-600 mt-1">
            {#if $privacyMode}
              <span class="text-brand-indigo/40 select-none">Rp •••••</span>
            {:else}
              +{formatRupiah(analyticsData.totalIncome)}
            {/if}
          </div>
          <span class="text-[10px] text-brand-indigo/50 font-medium">Periode {selectedPeriod}</span>
        </div>
        <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <ArrowUpRight class="w-6 h-6" />
        </div>
      </div>

      <!-- Total Pengeluaran -->
      <div class="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm flex items-center justify-between">
        <div>
          <span class="text-xs font-bold text-brand-indigo/60 flex items-center gap-1.5">
            <TrendingDown class="w-3.5 h-3.5 text-rose-500" />
            Total Pengeluaran
          </span>
          <div class="text-xl font-black text-brand-indigo mt-1">
            {#if $privacyMode}
              <span class="text-brand-indigo/40 select-none">Rp •••••</span>
            {:else}
              -{formatRupiah(analyticsData.totalExpense)}
            {/if}
          </div>
          <span class="text-[10px] text-brand-indigo/50 font-medium">Arus kas keluar</span>
        </div>
        <div class="w-12 h-12 rounded-2xl bg-brand-peach-light text-brand-peach-dark flex items-center justify-center">
          <ArrowDownRight class="w-6 h-6" />
        </div>
      </div>

      <!-- Arus Kas Bersih (Net Cash Flow) -->
      <div class="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm flex items-center justify-between">
        <div>
          <span class="text-xs font-bold text-brand-indigo/60 flex items-center gap-1.5">
            <PiggyBank class="w-3.5 h-3.5 text-sky-600" />
            Arus Kas Bersih
          </span>
          <div class="text-xl font-black mt-1 {analyticsData.netSavings >= 0 ? 'text-emerald-600' : 'text-rose-600'}">
            {#if $privacyMode}
              <span class="text-brand-indigo/40 select-none">Rp •••••</span>
            {:else}
              {analyticsData.netSavings >= 0 ? '+' : ''}{formatRupiah(analyticsData.netSavings)}
            {/if}
          </div>
          <span class="text-[10px] text-brand-indigo/50 font-medium">{analyticsData.netSavings >= 0 ? 'Surplus Finansial' : 'Defisit Pengeluaran'}</span>
        </div>
        <div class="w-12 h-12 rounded-2xl bg-brand-sky-light text-brand-indigo flex items-center justify-center">
          <WalletIcon class="w-6 h-6" />
        </div>
      </div>

      <!-- Rasio Tabungan (Savings Rate) -->
      <div class="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm flex items-center justify-between">
        <div>
          <span class="text-xs font-bold text-brand-indigo/60 flex items-center gap-1.5">
            <PieChart class="w-3.5 h-3.5 text-amber-500" />
            Rasio Menabung
          </span>
          <div class="text-xl font-black text-brand-indigo mt-1">
            {analyticsData.savingsRate}%
          </div>
          <div class="w-24 bg-brand-butter-light rounded-full h-1.5 mt-1 overflow-hidden">
            <div class="bg-gradient-to-r from-brand-butter-dark to-brand-peach h-1.5 rounded-full" style="width: {Math.min(100, analyticsData.savingsRate)}%"></div>
          </div>
        </div>
        <div class="w-12 h-12 rounded-2xl bg-brand-butter-light text-brand-indigo flex items-center justify-center font-extrabold text-sm">
          {analyticsData.savingsRate >= 20 ? '🌟 Sehat' : '⚠️ Waspada'}
        </div>
      </div>
    </div>

    <!-- 2. Visual Daily Trend Bar Chart (Income vs Expense) -->
    <div class="p-6 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-sm font-bold text-brand-indigo flex items-center gap-2">
            <span>Grafik Arus Kas Harian</span>
            <span class="text-xs font-medium text-brand-indigo/50">({analyticsData.dailyTrend.length} hari aktif)</span>
          </h3>
          <p class="text-xs text-brand-indigo/60 font-medium">Bandingkan pola pemasukan hijau dan pengeluaran peach setiap hari</p>
        </div>

        <div class="flex items-center gap-4 text-xs font-bold">
          <span class="flex items-center gap-1.5 text-emerald-600">
            <span class="w-3 h-3 rounded-md bg-emerald-500 inline-block"></span>
            Pemasukan
          </span>
          <span class="flex items-center gap-1.5 text-brand-peach-dark">
            <span class="w-3 h-3 rounded-md bg-brand-peach-dark inline-block"></span>
            Pengeluaran
          </span>
        </div>
      </div>

      {#if analyticsData.dailyTrend.length === 0}
        <div class="py-12 text-center text-xs text-brand-indigo/50">
          Belum ada catatan mutasi transaksi pada periode ini.
        </div>
      {:else}
        <!-- Bar Chart Container -->
        <div class="pt-6 pb-2 overflow-x-auto">
          <div class="min-w-[600px] h-48 flex items-end gap-3 px-2 border-b border-brand-indigo/10">
            {#each analyticsData.dailyTrend as day}
              {@const incHeight = Math.max(4, Math.round((day.income / maxBarValue) * 160))}
              {@const expHeight = Math.max(4, Math.round((day.expense / maxBarValue) * 160))}
              <div
                class="flex-1 flex flex-col items-center gap-1 group relative cursor-pointer"
                on:mouseenter={() => (activeTooltip = day)}
                on:mouseleave={() => (activeTooltip = null)}
              >
                <!-- Double Bars (Income & Expense) -->
                <div class="w-full flex items-end justify-center gap-1 h-40">
                  <!-- Income Bar -->
                  {#if day.income > 0}
                    <div
                      class="w-3 sm:w-4 bg-emerald-400 hover:bg-emerald-500 rounded-t-md transition-all duration-300"
                      style="height: {incHeight}px;"
                    ></div>
                  {/if}

                  <!-- Expense Bar -->
                  {#if day.expense > 0}
                    <div
                      class="w-3 sm:w-4 bg-brand-peach-dark hover:bg-rose-400 rounded-t-md transition-all duration-300"
                      style="height: {expHeight}px;"
                    ></div>
                  {/if}
                </div>

                <!-- Date Label -->
                <span class="text-[10px] font-bold text-brand-indigo/60 truncate max-w-[42px]">
                  {day.label}
                </span>

                <!-- Hover Tooltip -->
                {#if activeTooltip === day}
                  <div class="absolute -top-16 z-20 px-3 py-1.5 rounded-xl bg-brand-indigo text-white text-[11px] font-mono whitespace-nowrap shadow-lg pointer-events-none">
                    <div class="font-bold">{day.label}</div>
                    <div class="text-emerald-300">+Rp {day.income.toLocaleString('id-ID')}</div>
                    <div class="text-rose-300">-Rp {day.expense.toLocaleString('id-ID')}</div>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <!-- 3. Category Spending Breakdown & Top 5 Expenses (2 Columns) -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Category Distribution -->
      <div class="p-6 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-brand-indigo">Distribusi Kategori Pengeluaran</h3>
            <p class="text-xs text-brand-indigo/60">Pos pengeluaran yang paling banyak menyerap anggaran</p>
          </div>
          <span class="text-xs font-bold text-brand-indigo/60">{analyticsData.categoryBreakdown.length} Kategori</span>
        </div>

        {#if analyticsData.categoryBreakdown.length === 0}
          <div class="py-8 text-center text-xs text-brand-indigo/50">
            Belum ada pengeluaran yang tercatat pada periode ini.
          </div>
        {:else}
          <div class="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
            {#each analyticsData.categoryBreakdown as cat}
              <div class="space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-brand-indigo flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full" style="background-color: {cat.color};"></span>
                    {cat.name}
                    <span class="text-[10px] text-brand-indigo/50 font-normal">({cat.count} transaksi)</span>
                  </span>
                  <span class="font-black text-brand-indigo">
                    {#if $privacyMode}
                      <span class="text-brand-indigo/40 select-none">Rp •••••</span>
                    {:else}
                      {formatRupiah(cat.total)} ({cat.percentage}%)
                    {/if}
                  </span>
                </div>
                <div class="w-full bg-black/5 rounded-full h-2 overflow-hidden">
                  <div
                    class="h-2 rounded-full transition-all duration-500"
                    style="width: {cat.percentage}%; background-color: {cat.color};"
                  ></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Top 5 Largest Expenses -->
      <div class="p-6 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-sm font-bold text-brand-indigo">5 Pengeluaran Terbesar</h3>
            <p class="text-xs text-brand-indigo/60">Pengeluaran dengan nominal paling signifikan</p>
          </div>
          <span class="text-xs font-bold text-rose-600 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200">
            Top Priority
          </span>
        </div>

        {#if analyticsData.topExpenses.length === 0}
          <div class="py-8 text-center text-xs text-brand-indigo/50">
            Belum ada data pengeluaran.
          </div>
        {:else}
          <div class="space-y-2.5">
            {#each analyticsData.topExpenses as exp, i}
              <div class="p-3 rounded-2xl bg-white/60 border border-white/80 flex items-center justify-between gap-3">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="w-6 h-6 rounded-xl bg-brand-peach text-brand-indigo font-black text-xs flex items-center justify-center flex-shrink-0">
                    {i + 1}
                  </span>
                  <div class="min-w-0">
                    <h5 class="text-xs font-bold text-brand-indigo truncate">{exp.description}</h5>
                    <p class="text-[10px] text-brand-indigo/60 flex items-center gap-1.5 mt-0.5">
                      <span>{exp.categoryName}</span>
                      <span>•</span>
                      <span>{exp.walletName}</span>
                      <span>•</span>
                      <span>{formatDate(exp.date)}</span>
                    </p>
                  </div>
                </div>

                <div class="text-right flex-shrink-0 text-xs font-black text-rose-600">
                  {#if $privacyMode}
                    <span class="text-brand-indigo/40 select-none">Rp •••••</span>
                  {:else}
                    -{formatRupiah(exp.amount)}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
