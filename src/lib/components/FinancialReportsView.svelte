<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah } from '../utils/format';
  import {
    FileText,
    Calendar,
    Printer,
    Download,
    TrendingUp,
    TrendingDown,
    PiggyBank,
    Wallet,
    Target,
    CheckCircle2,
    AlertTriangle,
    RefreshCw,
  } from 'lucide-svelte';

  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];

  let selectedMonth = new Date().getMonth();
  let selectedYear = currentYear;
  let isLoading = false;
  let reportData: any = null;

  onMount(() => {
    loadReport();
  });

  export async function loadReport() {
    isLoading = true;
    try {
      const res = await api.getFinancialReport(`month=${selectedMonth}&year=${selectedYear}`);
      reportData = res;
    } catch (err) {
      console.error('Error loading financial report:', err);
    } finally {
      isLoading = false;
    }
  }

  function handleMonthChange(e: Event) {
    selectedMonth = Number((e.target as HTMLSelectElement).value);
    loadReport();
  }

  function handleYearChange(e: Event) {
    selectedYear = Number((e.target as HTMLSelectElement).value);
    loadReport();
  }

  function printReport() {
    window.print();
  }

  function exportReportCSV() {
    if (!reportData) return;
    const lines: string[] = [];
    lines.push(`LAPORAN KEUANGAN KELUARGA - PERIODE ${reportData.periodLabel.toUpperCase()}`);
    lines.push('');
    lines.push('1. RINGKASAN ARUS KAS (CASH FLOW)');
    lines.push(`Total Pemasukan,${reportData.totalIncome}`);
    lines.push(`Total Pengeluaran,${reportData.totalExpense}`);
    lines.push(`Arus Kas Bersih (Surplus/Defisit),${reportData.netCashFlow}`);
    lines.push('');
    lines.push('2. LAPORAN ANGGARAN PER KATEGORI');
    lines.push('Kategori,Anggaran,Realisasi,Sisa Kuota,Persentase');
    for (const b of reportData.budgetReport || []) {
      lines.push(`"${b.name}",${b.budget},${b.actual},${b.variance},${b.utilization}%`);
    }
    lines.push('');
    lines.push('3. SALDO AKHIR DOMPET KELUARGA');
    lines.push('Nama Dompet,Tipe,Saldo Akhir');
    for (const w of reportData.wallets || []) {
      lines.push(`"${w.name}",${w.type},${w.balance}`);
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + lines.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `laporan_keuangan_${reportData.periodLabel.replace(/\s+/g, '_').toLowerCase()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
</script>

<div class="space-y-6 print:space-y-4">
  <!-- Controls Bar: Title & Selectors -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
    <div class="flex items-center gap-2.5">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-butter to-brand-mint flex items-center justify-center text-brand-indigo shadow-xs">
        <FileText class="w-5 h-5" />
      </div>
      <div>
        <h2 class="text-lg font-extrabold text-brand-indigo tracking-tight">Laporan Keuangan Keluarga</h2>
        <p class="text-xs text-brand-indigo/60 font-medium">Rekapitulasi arus kas bulanan, kepatuhan anggaran & dana cadangan</p>
      </div>
    </div>

    <!-- Selectors and Action Buttons -->
    <div class="flex flex-wrap items-center gap-2">
      <!-- Month & Year Selectors -->
      <div class="flex items-center gap-1.5 p-1 rounded-2xl bg-white/80 border border-white/90 shadow-xs">
        <select
          value={selectedMonth}
          on:change={handleMonthChange}
          class="px-2.5 py-1.5 bg-transparent text-xs font-bold text-brand-indigo outline-none cursor-pointer"
        >
          {#each months as m, idx}
            <option value={idx}>{m}</option>
          {/each}
        </select>

        <select
          value={selectedYear}
          on:change={handleYearChange}
          class="px-2.5 py-1.5 bg-transparent text-xs font-bold text-brand-indigo outline-none cursor-pointer border-l border-brand-indigo/10"
        >
          {#each years as y}
            <option value={y}>{y}</option>
          {/each}
        </select>
      </div>

      <button
        on:click={exportReportCSV}
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/80 hover:bg-white border border-white/90 text-xs font-bold text-brand-indigo shadow-xs transition"
        title="Unduh Rekap CSV"
      >
        <Download class="w-3.5 h-3.5" />
        <span class="hidden sm:inline">CSV</span>
      </button>

      <button
        on:click={printReport}
        class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-brand-indigo text-white text-xs font-bold shadow-xs hover:bg-brand-indigo-light transition"
        title="Cetak Laporan Resmi"
      >
        <Printer class="w-3.5 h-3.5" />
        <span>Cetak Laporan</span>
      </button>

      <button
        on:click={loadReport}
        class="p-2 rounded-2xl bg-white/80 border border-white/90 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
        title="Muat Ulang"
      >
        <RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
      </button>
    </div>
  </div>

  {#if isLoading && !reportData}
    <div class="py-16 text-center text-xs font-bold text-brand-indigo/60 animate-pulse">
      Menyusun Laporan Keuangan Periode {months[selectedMonth]} {selectedYear}...
    </div>
  {:else if reportData}
    <!-- Printable Document Wrapper -->
    <div class="space-y-6 bg-white/90 backdrop-blur-2xl p-6 sm:p-8 rounded-3xl border border-white/90 shadow-glass-md print:shadow-none print:border-none print:p-0">
      <!-- Report Header -->
      <div class="pb-6 border-b border-brand-indigo/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span class="text-[11px] font-extrabold uppercase tracking-widest text-brand-indigo/50">Dokumen Finansial Resmi</span>
          <h1 class="text-xl sm:text-2xl font-black text-brand-indigo mt-0.5">Laporan Arus Kas & Anggaran</h1>
          <p class="text-xs font-semibold text-brand-indigo/70 mt-1">
            Periode: <span class="font-extrabold text-brand-indigo">{reportData.periodLabel}</span>
          </p>
        </div>

        <div class="text-left sm:text-right">
          <div class="inline-block px-3 py-1 rounded-full text-xs font-bold bg-brand-sky-light text-brand-indigo border border-brand-sky">
            ✓ Terverifikasi AI Monee
          </div>
          <div class="text-[10px] text-brand-indigo/50 mt-1">Dicetak pada: {new Date().toLocaleDateString('id-ID', { dateStyle: 'long' })}</div>
        </div>
      </div>

      <!-- 1. Executive Cash Flow Summary (3 Cards) -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200">
          <span class="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
            <TrendingUp class="w-4 h-4 text-emerald-600" />
            Total Pemasukan (Cash In)
          </span>
          <div class="text-lg font-black text-emerald-700 mt-1">
            {#if $privacyMode}
              <span class="select-none">Rp •••••</span>
            {:else}
              +{formatRupiah(reportData.totalIncome)}
            {/if}
          </div>
        </div>

        <div class="p-4 rounded-2xl bg-rose-50/70 border border-rose-200">
          <span class="text-xs font-bold text-rose-800 flex items-center gap-1.5">
            <TrendingDown class="w-4 h-4 text-rose-600" />
            Total Pengeluaran (Cash Out)
          </span>
          <div class="text-lg font-black text-rose-700 mt-1">
            {#if $privacyMode}
              <span class="select-none">Rp •••••</span>
            {:else}
              -{formatRupiah(reportData.totalExpense)}
            {/if}
          </div>
        </div>

        <div class="p-4 rounded-2xl {reportData.netCashFlow >= 0 ? 'bg-sky-50/70 border border-sky-200 text-sky-800' : 'bg-amber-50/70 border border-amber-200 text-amber-800'}">
          <span class="text-xs font-bold flex items-center gap-1.5">
            <PiggyBank class="w-4 h-4" />
            Surplus / (Defisit) Bersih
          </span>
          <div class="text-lg font-black mt-1 {reportData.netCashFlow >= 0 ? 'text-sky-700' : 'text-amber-700'}">
            {#if $privacyMode}
              <span class="select-none">Rp •••••</span>
            {:else}
              {reportData.netCashFlow >= 0 ? '+' : ''}{formatRupiah(reportData.netCashFlow)}
            {/if}
          </div>
        </div>
      </div>

      <!-- 2. Budget vs Actual Realization Table -->
      <div class="space-y-3">
        <h3 class="text-sm font-bold text-brand-indigo flex items-center gap-2">
          <Target class="w-4 h-4 text-brand-indigo/60" />
          Kepatuhan Anggaran Kategori (Budget vs Actual)
        </h3>

        {#if reportData.budgetReport.length === 0}
          <div class="p-4 text-center rounded-2xl bg-white/60 text-xs text-brand-indigo/50">
            Tidak ada transaksi kategori pada bulan ini.
          </div>
        {:else}
          <div class="overflow-x-auto rounded-2xl border border-brand-indigo/10">
            <table class="w-full text-left text-xs">
              <thead class="bg-brand-indigo/5 text-brand-indigo font-bold border-b border-brand-indigo/10">
                <tr>
                  <th class="p-3">Kategori</th>
                  <th class="p-3">Anggaran Plafon</th>
                  <th class="p-3">Realisasi</th>
                  <th class="p-3">Sisa / Variance</th>
                  <th class="p-3">Utilisasi %</th>
                  <th class="p-3">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-brand-indigo/5">
                {#each reportData.budgetReport as b}
                  <tr class="hover:bg-brand-sky-light/30 transition">
                    <td class="p-3 font-bold text-brand-indigo">{b.name}</td>
                    <td class="p-3 text-brand-indigo/70">
                      {#if $privacyMode}
                        Rp •••••
                      {:else}
                        {b.budget > 0 ? formatRupiah(b.budget) : '-'}
                      {/if}
                    </td>
                    <td class="p-3 font-bold text-rose-600">
                      {#if $privacyMode}
                        Rp •••••
                      {:else}
                        {formatRupiah(b.actual)}
                      {/if}
                    </td>
                    <td class="p-3 font-semibold {b.variance < 0 ? 'text-rose-600' : 'text-emerald-600'}">
                      {#if $privacyMode}
                        Rp •••••
                      {:else}
                        {b.budget > 0 ? (b.variance >= 0 ? '+' : '') + formatRupiah(b.variance) : '-'}
                      {/if}
                    </td>
                    <td class="p-3 font-bold">
                      {b.budget > 0 ? `${b.utilization}%` : '-'}
                    </td>
                    <td class="p-3">
                      {#if b.budget > 0}
                        {#if b.utilization > 100}
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700">
                            <AlertTriangle class="w-2.5 h-2.5" /> Over Budget
                          </span>
                        {:else if b.utilization >= 80}
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                            ⚠️ Waspada (80%)
                          </span>
                        {:else}
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                            <CheckCircle2 class="w-2.5 h-2.5" /> Aman
                          </span>
                        {/if}
                      {:else}
                        <span class="text-brand-indigo/40 text-[10px]">Fleksibel</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- 3. Wallet Ending Balances & Sinking Funds (2 Columns) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
        <!-- Ending Balances -->
        <div class="space-y-3">
          <h3 class="text-sm font-bold text-brand-indigo flex items-center gap-2">
            <Wallet class="w-4 h-4 text-brand-indigo/60" />
            Saldo Akhir Dompet Keluarga
          </h3>
          <div class="rounded-2xl border border-brand-indigo/10 divide-y divide-brand-indigo/5 overflow-hidden">
            {#each reportData.wallets as w}
              <div class="p-3 flex items-center justify-between text-xs hover:bg-white/60">
                <span class="font-bold text-brand-indigo">{w.name} ({w.type})</span>
                <span class="font-black text-brand-indigo">
                  {#if $privacyMode}
                    Rp •••••
                  {:else}
                    {formatRupiah(w.balance)}
                  {/if}
                </span>
              </div>
            {/each}
          </div>
        </div>

        <!-- Sinking Funds Progress -->
        <div class="space-y-3">
          <h3 class="text-sm font-bold text-brand-indigo flex items-center gap-2">
            <PiggyBank class="w-4 h-4 text-brand-indigo/60" />
            Progres Pos Dana Siaga
          </h3>
          <div class="rounded-2xl border border-brand-indigo/10 divide-y divide-brand-indigo/5 overflow-hidden">
            {#if reportData.sinkingFunds.length === 0}
              <div class="p-4 text-center text-xs text-brand-indigo/50">
                Belum ada pos dana siaga aktif.
              </div>
            {:else}
              {#each reportData.sinkingFunds as s}
                <div class="p-3 space-y-1 text-xs hover:bg-white/60">
                  <div class="flex items-center justify-between">
                    <span class="font-bold text-brand-indigo">{s.name}</span>
                    <span class="font-bold text-brand-indigo/70">{s.progress}%</span>
                  </div>
                  <div class="w-full bg-brand-butter-light rounded-full h-1.5 overflow-hidden">
                    <div class="bg-gradient-to-r from-brand-butter-dark to-brand-peach h-1.5 rounded-full" style="width: {s.progress}%"></div>
                  </div>
                  <div class="flex justify-between text-[10px] text-brand-indigo/60">
                    <span>Terkumpul: {formatRupiah(s.collected)}</span>
                    <span>Target: {formatRupiah(s.target)}</span>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>
