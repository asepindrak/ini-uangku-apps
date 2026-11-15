<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah, formatDate } from '../utils/format';
  import type { Transaction, Wallet } from '../types';
  import {
    Search,
    Filter,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    Receipt,
    Mic,
    MessageSquare,
    Send,
    Repeat,
    Smartphone,
    Download,
    Printer,
    Trash2,
    RefreshCw,
    X,
    SlidersHorizontal,
  } from 'lucide-svelte';

  export let wallets: Wallet[] = [];
  export let onTransactionChanged: () => void = () => {};

  let transactions: Transaction[] = [];
  let isLoading = false;

  // Filter states
  let searchQuery = '';
  let selectedWalletId = 'ALL';
  let selectedType = 'ALL';
  let selectedDatePreset: 'all' | 'today' | 'yesterday' | '7d' | 'this_month' | 'last_month' | 'custom' = 'all';
  let startDate = '';
  let endDate = '';

  let deletingId: string | null = null;
  let confirmDeleteTx: Transaction | null = null;

  onMount(() => {
    fetchFilteredTransactions();
  });

  export async function fetchFilteredTransactions() {
    isLoading = true;
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (selectedWalletId !== 'ALL') params.append('walletId', selectedWalletId);
      if (selectedType !== 'ALL') params.append('type', selectedType);

      // Apply date preset
      const now = new Date();
      if (selectedDatePreset === 'today') {
        const d = now.toISOString().split('T')[0];
        params.append('startDate', d);
        params.append('endDate', d);
      } else if (selectedDatePreset === 'yesterday') {
        const y = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        params.append('startDate', y);
        params.append('endDate', y);
      } else if (selectedDatePreset === '7d') {
        const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        params.append('startDate', d7);
      } else if (selectedDatePreset === 'this_month') {
        const mStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
        params.append('startDate', mStart);
      } else if (selectedDatePreset === 'last_month') {
        const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
        const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];
        params.append('startDate', lmStart);
        params.append('endDate', lmEnd);
      } else if (selectedDatePreset === 'custom') {
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
      }

      params.append('limit', '200');

      const res = await api.getTransactions(`?${params.toString()}`);
      transactions = res;
    } catch (err) {
      console.error('Error fetching transactions:', err);
    } finally {
      isLoading = false;
    }
  }

  function handleDatePreset(preset: 'all' | 'today' | 'yesterday' | '7d' | 'this_month' | 'last_month' | 'custom') {
    selectedDatePreset = preset;
    if (preset !== 'custom') {
      startDate = '';
      endDate = '';
    }
    fetchFilteredTransactions();
  }

  function resetFilters() {
    searchQuery = '';
    selectedWalletId = 'ALL';
    selectedType = 'ALL';
    selectedDatePreset = 'all';
    startDate = '';
    endDate = '';
    fetchFilteredTransactions();
  }

  async function handleDelete(t: Transaction) {
    deletingId = t.id;
    try {
      await api.deleteTransaction(t.id);
      confirmDeleteTx = null;
      await fetchFilteredTransactions();
      onTransactionChanged();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus transaksi');
    } finally {
      deletingId = null;
    }
  }

  function exportCSV() {
    if (transactions.length === 0) {
      alert('Tidak ada transaksi untuk diekspor.');
      return;
    }

    const headers = ['ID', 'Tanggal', 'Deskripsi', 'Tipe', 'Nominal', 'Dompet', 'Kategori', 'Sumber Input', 'Pengguna'];
    const rows = transactions.map((t) => [
      t.id,
      formatDate(t.transactionDate),
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.type,
      t.amount,
      `"${t.walletName || ''}"`,
      `"${t.categoryName || 'Umum'}"`,
      t.inputSource,
      `"${t.userName || 'Keluarga'}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `transaksi_iniuangku_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function printTransactions() {
    window.print();
  }

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

  // Summary of filtered results
  $: totalExpense = transactions.filter((t) => t.type === 'EXPENSE').reduce((acc, t) => acc + Number(t.amount), 0);
  $: totalIncome = transactions.filter((t) => t.type === 'INCOME').reduce((acc, t) => acc + Number(t.amount), 0);
</script>

<div class="space-y-5">
  <!-- Top Bar: Title & Action Buttons -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
    <div class="flex items-center gap-2.5">
      <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-peach to-brand-butter flex items-center justify-center text-brand-indigo shadow-xs">
        <Receipt class="w-5 h-5" />
      </div>
      <div>
        <h2 class="text-lg font-extrabold text-brand-indigo tracking-tight">Eksplorasi Transaksi & Filter</h2>
        <p class="text-xs text-brand-indigo/60 font-medium">Filter mutasi berdasarkan tanggal, dompet, kategori, atau kata kunci</p>
      </div>
    </div>

    <!-- Export & Print Actions -->
    <div class="flex items-center gap-2">
      <button
        on:click={exportCSV}
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/80 hover:bg-white border border-white/90 text-xs font-bold text-brand-indigo shadow-xs transition"
        title="Ekspor Data ke CSV / Excel"
      >
        <Download class="w-3.5 h-3.5" />
        <span class="hidden sm:inline">Ekspor CSV</span>
      </button>

      <button
        on:click={printTransactions}
        class="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-white/80 hover:bg-white border border-white/90 text-xs font-bold text-brand-indigo shadow-xs transition"
        title="Cetak Daftar Transaksi"
      >
        <Printer class="w-3.5 h-3.5" />
        <span class="hidden sm:inline">Cetak</span>
      </button>

      <button
        on:click={fetchFilteredTransactions}
        class="p-2.5 rounded-2xl bg-white/80 border border-white/90 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
        title="Muat Ulang"
      >
        <RefreshCw class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" />
      </button>
    </div>
  </div>

  <!-- Filter Controls Card -->
  <div class="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm space-y-4">
    <!-- Row 1: Search & Dropdowns -->
    <div class="grid grid-cols-1 sm:grid-cols-12 gap-3">
      <!-- Search Input -->
      <div class="sm:col-span-6 relative">
        <Search class="w-4 h-4 absolute left-3.5 top-3 text-brand-indigo/40" />
        <input
          type="text"
          placeholder="Cari transaksi, toko, makanan, atau item..."
          bind:value={searchQuery}
          on:input={() => fetchFilteredTransactions()}
          class="w-full pl-10 pr-4 py-2 bg-white/90 border border-white/80 rounded-2xl text-xs font-medium text-brand-indigo placeholder:text-brand-indigo/40 shadow-xs outline-none focus:ring-2 focus:ring-brand-sky"
        />
        {#if searchQuery}
          <button
            on:click={() => { searchQuery = ''; fetchFilteredTransactions(); }}
            class="absolute right-3 top-2.5 text-brand-indigo/40 hover:text-brand-indigo"
          >
            <X class="w-4 h-4" />
          </button>
        {/if}
      </div>

      <!-- Wallet Dropdown -->
      <div class="sm:col-span-3">
        <select
          bind:value={selectedWalletId}
          on:change={() => fetchFilteredTransactions()}
          class="w-full px-3 py-2 bg-white/90 border border-white/80 rounded-2xl text-xs font-bold text-brand-indigo shadow-xs outline-none focus:ring-2 focus:ring-brand-sky"
        >
          <option value="ALL">Semua Dompet</option>
          {#each wallets as w}
            <option value={w.id}>{w.name}</option>
          {/each}
        </select>
      </div>

      <!-- Type Dropdown -->
      <div class="sm:col-span-3">
        <select
          bind:value={selectedType}
          on:change={() => fetchFilteredTransactions()}
          class="w-full px-3 py-2 bg-white/90 border border-white/80 rounded-2xl text-xs font-bold text-brand-indigo shadow-xs outline-none focus:ring-2 focus:ring-brand-sky"
        >
          <option value="ALL">Semua Tipe</option>
          <option value="EXPENSE">🔴 Hanya Pengeluaran</option>
          <option value="INCOME">🟢 Hanya Pemasukan</option>
        </select>
      </div>
    </div>

    <!-- Row 2: Date Presets & Custom Date Range -->
    <div class="flex flex-wrap items-center gap-2 pt-1 border-t border-brand-indigo/5">
      <span class="text-xs font-bold text-brand-indigo/60 flex items-center gap-1">
        <Calendar class="w-3.5 h-3.5" />
        Waktu:
      </span>

      <button
        on:click={() => handleDatePreset('all')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === 'all' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Semua
      </button>
      <button
        on:click={() => handleDatePreset('today')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === 'today' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Hari Ini
      </button>
      <button
        on:click={() => handleDatePreset('yesterday')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === 'yesterday' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Kemarin
      </button>
      <button
        on:click={() => handleDatePreset('7d')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === '7d' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        7 Hari
      </button>
      <button
        on:click={() => handleDatePreset('this_month')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === 'this_month' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Bulan Ini
      </button>
      <button
        on:click={() => handleDatePreset('last_month')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === 'last_month' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Bulan Lalu
      </button>
      <button
        on:click={() => handleDatePreset('custom')}
        class="px-2.5 py-1 rounded-xl text-xs font-bold transition {selectedDatePreset === 'custom' ? 'bg-brand-indigo text-white' : 'bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
      >
        Kustom Tanggal
      </button>

      {#if selectedDatePreset === 'custom'}
        <div class="flex items-center gap-2 mt-2 sm:mt-0 w-full sm:w-auto">
          <input
            type="date"
            bind:value={startDate}
            on:change={() => fetchFilteredTransactions()}
            class="px-2.5 py-1 bg-white/90 border border-white/80 rounded-xl text-xs font-bold text-brand-indigo outline-none"
          />
          <span class="text-xs text-brand-indigo/50">s/d</span>
          <input
            type="date"
            bind:value={endDate}
            on:change={() => fetchFilteredTransactions()}
            class="px-2.5 py-1 bg-white/90 border border-white/80 rounded-xl text-xs font-bold text-brand-indigo outline-none"
          />
        </div>
      {/if}

      <!-- Reset Filter Button -->
      {#if searchQuery || selectedWalletId !== 'ALL' || selectedType !== 'ALL' || selectedDatePreset !== 'all'}
        <button
          on:click={resetFilters}
          class="ml-auto text-xs font-bold text-rose-600 hover:text-rose-700 transition"
        >
          Reset Filter
        </button>
      {/if}
    </div>

    <!-- Active Filter Summary Metrics -->
    <div class="pt-2 border-t border-brand-indigo/5 flex flex-wrap items-center justify-between text-xs font-semibold text-brand-indigo/70 gap-2">
      <div>
        Ditemukan: <span class="font-extrabold text-brand-indigo">{transactions.length} transaksi</span>
      </div>
      <div class="flex items-center gap-4">
        <span>Pengeluaran: <b class="text-rose-600">-{formatRupiah(totalExpense)}</b></span>
        <span>Pemasukan: <b class="text-emerald-600">+{formatRupiah(totalIncome)}</b></span>
      </div>
    </div>
  </div>

  <!-- Transactions Table / List -->
  {#if isLoading}
    <div class="p-12 text-center text-xs font-bold text-brand-indigo/60 animate-pulse">
      Memuat daftar mutasi transaksi...
    </div>
  {:else if transactions.length === 0}
    <div class="p-12 text-center rounded-3xl bg-white/60 border border-white/80 backdrop-blur-md space-y-2">
      <p class="text-sm font-bold text-brand-indigo">Tidak ada transaksi yang sesuai dengan filter.</p>
      <p class="text-xs text-brand-indigo/60">Coba ubah kata kunci pencarian, rentang tanggal, atau pilih opsi "Semua".</p>
    </div>
  {:else}
    <div class="rounded-3xl bg-white/80 backdrop-blur-xl border border-white/90 shadow-glass-sm divide-y divide-white/80 overflow-hidden">
      {#each transactions as t}
        {@const badge = getSourceBadge(t.inputSource)}
        <div class="p-4 sm:px-6 flex items-center justify-between gap-4 hover:bg-white/60 transition group">
          <div class="flex items-center gap-3.5 min-w-0">
            <div class="w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 {t.type === 'INCOME' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-peach-light text-brand-indigo'}">
              {#if t.type === 'INCOME'}
                <ArrowUpRight class="w-5 h-5" />
              {:else}
                <ArrowDownRight class="w-5 h-5" />
              {/if}
            </div>

            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="text-sm font-bold text-brand-indigo truncate">{t.description}</h4>
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border {badge.bg}">
                  <svelte:component this={badge.icon} class="w-2.5 h-2.5" />
                  {badge.label}
                </span>
              </div>
              <p class="text-xs text-brand-indigo/60 flex items-center gap-2 mt-0.5 flex-wrap">
                <span class="font-bold text-brand-indigo/80">{t.walletName}</span>
                <span>•</span>
                <span>{t.categoryName || 'Umum'}</span>
                <span>•</span>
                <span>{formatDate(t.transactionDate)}</span>
                {#if t.userName}
                  <span>•</span>
                  <span class="text-brand-indigo/50">Oleh: {t.userName}</span>
                {/if}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-3 flex-shrink-0">
            <div class="text-right">
              <div class="text-sm sm:text-base font-black {t.type === 'INCOME' ? 'text-emerald-600' : 'text-brand-indigo'}">
                {#if $privacyMode}
                  <span class="text-brand-indigo/40 select-none">Rp •••••</span>
                {:else}
                  {t.type === 'INCOME' ? '+' : '-'}{formatRupiah(t.amount)}
                {/if}
              </div>
            </div>

            <!-- Delete Button (Reverts Balance) -->
            <button
              on:click={() => (confirmDeleteTx = t)}
              class="opacity-0 group-hover:opacity-100 p-2 rounded-xl text-rose-500 hover:bg-rose-50 transition"
              title="Hapus Transaksi (Kembalikan Saldo)"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Modal Konfirmasi Hapus Transaksi -->
{#if confirmDeleteTx}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/40 backdrop-blur-sm">
    <div class="w-full max-w-md bg-white/95 rounded-3xl p-6 border border-white/80 shadow-glass-lg space-y-4">
      <h3 class="text-base font-extrabold text-brand-indigo">Hapus Transaksi Ini?</h3>
      <p class="text-xs text-brand-indigo/70 leading-relaxed">
        Apakah Anda yakin ingin menghapus transaksi <b>"{confirmDeleteTx.description}"</b> senilai <b>Rp {Number(confirmDeleteTx.amount).toLocaleString('id-ID')}</b>?<br /><br />
        <span class="text-emerald-700 font-bold">✓ Saldo dompet "{confirmDeleteTx.walletName}" akan otomatis dikembalikan ke nominal sebelumnya.</span>
      </p>

      <div class="flex items-center justify-end gap-2 pt-2">
        <button
          on:click={() => (confirmDeleteTx = null)}
          class="px-4 py-2 rounded-xl text-xs font-bold text-brand-indigo/60 hover:text-brand-indigo"
        >
          Batal
        </button>
        <button
          on:click={() => handleDelete(confirmDeleteTx)}
          disabled={deletingId === confirmDeleteTx.id}
          class="px-5 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition disabled:opacity-50"
        >
          {deletingId === confirmDeleteTx.id ? 'Menghapus...' : 'Ya, Hapus & Sesuaikan Saldo'}
        </button>
      </div>
    </div>
  </div>
{/if}
