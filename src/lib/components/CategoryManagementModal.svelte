<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import type { Category } from '../types';
  import { formatRupiah } from '../utils/format';
  import { toast } from '../stores/toast';
  import { confirmDialog } from '../stores/confirm';
  import {
    X,
    Plus,
    Pencil,
    Trash2,
    Tag,
    Check,
    Sparkles,
    Wallet,
    ShoppingCart,
    Coffee,
    Car,
    Home,
    Film,
    Heart,
    Zap,
    Smartphone,
    Gift,
    ShieldCheck,
    Book,
    Plane,
    TrendingUp,
    Layers,
    SlidersHorizontal,
    FolderPlus,
    AlertTriangle,
  } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;
  export let onCategoryChanged: (() => void) | undefined = undefined;

  let categories: Category[] = [];
  let loading = false;
  let activeTab: 'EXPENSE' | 'INCOME' = 'EXPENSE';

  // Form State (Add / Edit)
  let isEditing = false;
  let editingId: string | null = null;
  let formName = '';
  let formType: 'EXPENSE' | 'INCOME' = 'EXPENSE';
  let formBudget: number | null = null;
  let formAlertThreshold: number = 80;
  let formColor = '#FFC1B6';
  let formIcon = 'shopping-cart';
  let saving = false;

  // Icon Library
  const AVAILABLE_ICONS = [
    { id: 'shopping-cart', label: 'Belanja', icon: ShoppingCart },
    { id: 'coffee', label: 'Jajan / Makan', icon: Coffee },
    { id: 'car', label: 'Transport', icon: Car },
    { id: 'home', label: 'Rumah', icon: Home },
    { id: 'zap', label: 'Listrik / Air', icon: Zap },
    { id: 'heart', label: 'Kesehatan', icon: Heart },
    { id: 'smartphone', label: 'Pulsa / WiFi', icon: Smartphone },
    { id: 'gift', label: 'Hadiah', icon: Gift },
    { id: 'film', label: 'Hiburan', icon: Film },
    { id: 'book', label: 'Edukasi', icon: Book },
    { id: 'plane', label: 'Liburan', icon: Plane },
    { id: 'shield', label: 'Asuransi', icon: ShieldCheck },
    { id: 'wallet', label: 'Gaji / Kas', icon: Wallet },
    { id: 'trending-up', label: 'Investasi', icon: TrendingUp },
    { id: 'tag', label: 'Lainnya', icon: Tag },
  ];

  // Pastel Color Palette
  const AVAILABLE_COLORS = [
    { code: '#FFC1B6', name: 'Peach' },
    { code: '#C1ECFD', name: 'Sky' },
    { code: '#FDEEAD', name: 'Butter' },
    { code: '#C3F0DE', name: 'Mint' },
    { code: '#E8D5FF', name: 'Lavender' },
    { code: '#FECDD3', name: 'Rose' },
    { code: '#FED7AA', name: 'Orange' },
    { code: '#A7F3D0', name: 'Emerald' },
  ];

  function getIconComponent(iconName: string) {
    const found = AVAILABLE_ICONS.find((item) => item.id === iconName);
    return found ? found.icon : Tag;
  }

  $: if (isOpen) {
    loadCategories();
    resetForm();
  }

  async function loadCategories() {
    loading = true;
    try {
      categories = await api.getCategories();
    } catch (e: any) {
      toast.error(e.message || 'Gagal memuat kategori.');
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    isEditing = false;
    editingId = null;
    formName = '';
    formType = activeTab;
    formBudget = null;
    formAlertThreshold = 80;
    formColor = '#FFC1B6';
    formIcon = activeTab === 'EXPENSE' ? 'shopping-cart' : 'wallet';
  }

  function openCreateForm() {
    resetForm();
    isEditing = true;
  }

  function openEditForm(cat: Category) {
    editingId = cat.id;
    formName = cat.name;
    formType = (cat.type as 'EXPENSE' | 'INCOME') || 'EXPENSE';
    formBudget = cat.monthlyBudget || null;
    formAlertThreshold = cat.alertThreshold || 80;
    formColor = cat.color || '#FFC1B6';
    formIcon = cat.icon || 'tag';
    isEditing = true;
  }

  async function handleSubmit() {
    if (!formName.trim()) {
      toast.warning('Nama kategori tidak boleh kosong.');
      return;
    }

    saving = true;
    try {
      const payload = {
        name: formName.trim(),
        type: formType,
        monthlyBudget: formType === 'EXPENSE' && formBudget ? Number(formBudget) : null,
        alertThreshold: formType === 'EXPENSE' ? Number(formAlertThreshold) : 80,
        color: formColor,
        icon: formIcon,
      };

      if (editingId) {
        await api.updateCategory(editingId, payload);
        toast.success(`Kategori "${formName.trim()}" berhasil diperbarui! ✨`);
      } else {
        await api.createCategory(payload);
        toast.success(`Kategori "${formName.trim()}" berhasil ditambahkan! 🎉`);
      }

      await loadCategories();
      if (onCategoryChanged) onCategoryChanged();
      resetForm();
    } catch (e: any) {
      toast.error(e.message || 'Gagal menyimpan kategori.');
    } finally {
      saving = false;
    }
  }

  async function handleDelete(cat: Category) {
    const confirmed = await confirmDialog.confirm({
      title: 'Hapus Kategori',
      message: `Hapus kategori "${cat.name}"? Transaksi yang sudah tercatat dengan kategori ini tetap aman dan dialihkan ke "Tanpa Kategori".`,
      confirmText: 'Hapus Kategori',
      cancelText: 'Batal',
      isDestructive: true,
    });
    if (!confirmed) return;

    try {
      await api.deleteCategory(cat.id);
      toast.success(`Kategori "${cat.name}" berhasil dihapus.`);
      if (editingId === cat.id) resetForm();
      await loadCategories();
      if (onCategoryChanged) onCategoryChanged();
    } catch (e: any) {
      toast.error(e.message || 'Gagal menghapus kategori.');
    }
  }

  $: filteredCategories = categories.filter((c) => c.type === activeTab);
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/40 backdrop-blur-md">
    <div
      class="relative w-full max-w-3xl max-h-[90vh] bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-brand-indigo/5 flex items-center justify-between shrink-0 bg-white/50">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-brand-peach/30 flex items-center justify-center text-brand-peach-dark shadow-xs">
            <Layers class="w-5 h-5" />
          </div>
          <div>
            <h2 class="text-base font-black text-brand-indigo tracking-tight">Kelola Kategori Keuangan</h2>
            <p class="text-xs text-brand-indigo/60 font-medium">Atur pos pengeluaran, anggaran (budget), dan pos pemasukan keluarga</p>
          </div>
        </div>

        <button
          type="button"
          on:click={onClose}
          class="p-2 rounded-2xl hover:bg-black/5 text-brand-indigo/60 hover:text-brand-indigo transition"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Main Body -->
      <div class="flex-1 overflow-y-auto p-6 space-y-6">
        <!-- Tab Selector: Pengeluaran vs Pemasukan -->
        <div class="flex items-center justify-between gap-3">
          <div class="flex p-1 bg-brand-indigo/5 rounded-2xl">
            <button
              type="button"
              on:click={() => {
                activeTab = 'EXPENSE';
                if (!editingId) formType = 'EXPENSE';
              }}
              class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 {
                activeTab === 'EXPENSE'
                  ? 'bg-white text-brand-indigo shadow-xs'
                  : 'text-brand-indigo/60 hover:text-brand-indigo'
              }"
            >
              <span>💸 Kategori Pengeluaran</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] bg-brand-indigo/10">
                {categories.filter((c) => c.type === 'EXPENSE').length}
              </span>
            </button>

            <button
              type="button"
              on:click={() => {
                activeTab = 'INCOME';
                if (!editingId) formType = 'INCOME';
              }}
              class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 {
                activeTab === 'INCOME'
                  ? 'bg-white text-brand-indigo shadow-xs'
                  : 'text-brand-indigo/60 hover:text-brand-indigo'
              }"
            >
              <span>💰 Kategori Pemasukan</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] bg-brand-indigo/10">
                {categories.filter((c) => c.type === 'INCOME').length}
              </span>
            </button>
          </div>

          {#if !isEditing}
            <button
              type="button"
              on:click={openCreateForm}
              class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-indigo hover:bg-brand-indigo-dark text-white text-xs font-bold shadow-xs hover:scale-[1.02] active:scale-[0.98] transition"
            >
              <Plus class="w-4 h-4 text-brand-peach" />
              Tambah Kategori
            </button>
          {/if}
        </div>

        <!-- Add / Edit Form Drawer -->
        {#if isEditing}
          <div class="p-5 rounded-3xl bg-brand-sky/10 border border-brand-sky/30 space-y-4 animate-in fade-in duration-150">
            <div class="flex items-center justify-between">
              <h3 class="text-xs font-black uppercase tracking-wider text-brand-indigo flex items-center gap-2">
                <Sparkles class="w-4 h-4 text-amber-500" />
                {editingId ? 'Edit Kategori' : 'Tambah Kategori Baru'}
              </h3>
              <button
                type="button"
                on:click={resetForm}
                class="text-xs font-bold text-brand-indigo/60 hover:text-brand-indigo transition"
              >
                Batal
              </button>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Nama Kategori -->
              <div class="space-y-1">
                <label for="cat-name-input" class="block text-xs font-bold text-brand-indigo">Nama Kategori</label>
                <input
                  id="cat-name-input"
                  type="text"
                  bind:value={formName}
                  placeholder="Contoh: Belanja Bulanan, Jajan Anak, Bensin..."
                  class="w-full px-3.5 py-2.5 rounded-xl border border-brand-indigo/10 bg-white text-xs font-semibold text-brand-indigo focus:outline-none focus:ring-2 focus:ring-brand-peach/50"
                />
              </div>

              <!-- Tipe Kategori -->
              <div class="space-y-1">
                <label for="cat-type-select" class="block text-xs font-bold text-brand-indigo">Tipe Arus Kas</label>
                <select
                  id="cat-type-select"
                  bind:value={formType}
                  class="w-full px-3.5 py-2.5 rounded-xl border border-brand-indigo/10 bg-white text-xs font-semibold text-brand-indigo focus:outline-none focus:ring-2 focus:ring-brand-peach/50"
                >
                  <option value="EXPENSE">Pengeluaran (Expense)</option>
                  <option value="INCOME">Pemasukan (Income)</option>
                </select>
              </div>

              <!-- Plafon Bulanan (Hanya untuk Expense) -->
              {#if formType === 'EXPENSE'}
                <div class="space-y-1">
                  <label for="cat-budget-input" class="block text-xs font-bold text-brand-indigo flex items-center justify-between">
                    <span>Plafon Budget Bulanan (Opsional)</span>
                    <span class="text-[11px] text-brand-indigo/50 font-normal">0 / Kosongkan jika tanpa limit</span>
                  </label>
                  <div class="relative">
                    <span class="absolute left-3.5 top-2.5 text-xs font-bold text-brand-indigo/50">Rp</span>
                    <input
                      id="cat-budget-input"
                      type="number"
                      bind:value={formBudget}
                      placeholder="Contoh: 1500000"
                      class="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-brand-indigo/10 bg-white text-xs font-semibold text-brand-indigo focus:outline-none focus:ring-2 focus:ring-brand-peach/50"
                    />
                  </div>
                </div>

                <!-- Alert Threshold Guardrail -->
                <div class="space-y-1">
                  <label for="cat-threshold-input" class="block text-xs font-bold text-brand-indigo flex items-center justify-between">
                    <span>Peringatan Guardrail AI (Monee)</span>
                    <span class="text-[11px] text-amber-600 font-extrabold">{formAlertThreshold}% dari budget</span>
                  </label>
                  <div class="flex items-center gap-2 pt-1">
                    <input
                      id="cat-threshold-input"
                      type="range"
                      min="50"
                      max="100"
                      step="5"
                      bind:value={formAlertThreshold}
                      class="flex-1 accent-amber-500 cursor-pointer"
                    />
                    <div class="flex gap-1">
                      {#each [70, 80, 90] as pct}
                        <button
                          type="button"
                          on:click={() => (formAlertThreshold = pct)}
                          class="px-2 py-1 rounded-lg text-[10px] font-bold border transition {
                            formAlertThreshold === pct
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'bg-white text-brand-indigo/60 border-brand-indigo/10 hover:border-amber-300'
                          }"
                        >
                          {pct}%
                        </button>
                      {/each}
                    </div>
                  </div>
                </div>
              {/if}
            </div>

            <!-- Pilih Icon -->
            <div class="space-y-1.5 pt-2">
              <label class="block text-xs font-bold text-brand-indigo">Pilih Ikon</label>
              <div class="flex flex-wrap gap-2">
                {#each AVAILABLE_ICONS as item}
                  <button
                    type="button"
                    on:click={() => (formIcon = item.id)}
                    class="p-2.5 rounded-xl border flex items-center justify-center transition {
                      formIcon === item.id
                        ? 'bg-brand-indigo text-white border-brand-indigo ring-2 ring-brand-indigo/20 shadow-xs'
                        : 'bg-white text-brand-indigo/70 border-brand-indigo/10 hover:border-brand-indigo/30'
                    }"
                    title={item.label}
                  >
                    <svelte:component this={item.icon} class="w-4 h-4" />
                  </button>
                {/each}
              </div>
            </div>

            <!-- Pilih Warna Pastel -->
            <div class="space-y-1.5 pt-1">
              <label class="block text-xs font-bold text-brand-indigo">Pilih Warna Aksen</label>
              <div class="flex items-center gap-2">
                {#each AVAILABLE_COLORS as c}
                  <button
                    type="button"
                    on:click={() => (formColor = c.code)}
                    class="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center {
                      formColor === c.code ? 'border-brand-indigo ring-2 ring-brand-indigo/30 scale-105' : 'border-white shadow-xs'
                    }"
                    style="background-color: {c.code};"
                    title={c.name}
                  >
                    {#if formColor === c.code}
                      <Check class="w-3.5 h-3.5 text-brand-indigo font-black" />
                    {/if}
                  </button>
                {/each}
              </div>
            </div>

            <!-- Submit Buttons -->
            <div class="flex items-center justify-end gap-2.5 pt-3 border-t border-brand-sky/20">
              <button
                type="button"
                on:click={resetForm}
                class="px-4 py-2 rounded-xl border border-black/10 text-brand-indigo/70 hover:bg-black/5 text-xs font-bold transition"
              >
                Batal
              </button>

              <button
                type="button"
                on:click={handleSubmit}
                disabled={saving || !formName.trim()}
                class="px-5 py-2 rounded-xl bg-brand-indigo hover:bg-brand-indigo-dark disabled:opacity-50 text-white text-xs font-extrabold shadow-xs hover:scale-[1.02] active:scale-[0.98] transition flex items-center gap-1.5"
              >
                {#if saving}
                  <span>Menyimpan...</span>
                {:else}
                  <Check class="w-4 h-4 text-emerald-400" />
                  <span>{editingId ? 'Simpan Perubahan' : 'Buat Kategori'}</span>
                {/if}
              </button>
            </div>
          </div>
        {/if}

        <!-- Category Grid / List -->
        {#if loading}
          <div class="py-12 text-center text-xs font-semibold text-brand-indigo/60">
            Memuat daftar kategori...
          </div>
        {:else if filteredCategories.length === 0}
          <div class="p-8 text-center rounded-3xl bg-brand-indigo/5 border border-dashed border-brand-indigo/10 space-y-2">
            <Tag class="w-8 h-8 mx-auto text-brand-indigo/30" />
            <h4 class="text-xs font-bold text-brand-indigo">Belum ada kategori {activeTab === 'EXPENSE' ? 'pengeluaran' : 'pemasukan'}</h4>
            <p class="text-[11px] text-brand-indigo/60 max-w-xs mx-auto">
              Klik tombol "Tambah Kategori" di atas untuk membuat pos baru.
            </p>
          </div>
        {:else}
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {#each filteredCategories as cat}
              <div
                class="p-4 rounded-2xl bg-white/80 border border-white/80 shadow-glass-sm hover:shadow-glass hover:-translate-y-0.5 transition flex items-center justify-between gap-3 group"
              >
                <!-- Left: Icon & Details -->
                <div class="flex items-center gap-3 min-w-0">
                  <div
                    class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-xs"
                    style="background-color: {cat.color || '#FFC1B6'};"
                  >
                    <svelte:component this={getIconComponent(cat.icon)} class="w-5 h-5 text-brand-indigo" />
                  </div>

                  <div class="min-w-0">
                    <h4 class="text-xs font-bold text-brand-indigo truncate">{cat.name}</h4>
                    {#if cat.type === 'EXPENSE'}
                      <div class="flex items-center gap-2 mt-0.5">
                        {#if cat.monthlyBudget && cat.monthlyBudget > 0}
                          <span class="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                            Budget: {formatRupiah(cat.monthlyBudget)}/bln
                          </span>
                        {:else}
                          <span class="text-[10px] text-brand-indigo/50">Tanpa plafon budget</span>
                        {/if}
                      </div>
                    {:else}
                      <span class="text-[10px] font-bold text-brand-indigo/60">Pos Pemasukan</span>
                    {/if}
                  </div>
                </div>

                <!-- Right: Action Buttons -->
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    on:click={() => openEditForm(cat)}
                    class="p-2 rounded-xl text-brand-indigo/50 hover:text-brand-indigo hover:bg-brand-indigo/5 transition"
                    title="Edit Kategori"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    on:click={() => handleDelete(cat)}
                    class="p-2 rounded-xl text-brand-indigo/40 hover:text-rose-600 hover:bg-rose-50 transition"
                    title="Hapus Kategori"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer Info -->
      <div class="px-6 py-3 border-t border-brand-indigo/5 bg-brand-butter/10 flex items-center justify-between text-[11px] text-brand-indigo/70 font-medium">
        <span class="flex items-center gap-1.5">
          <Sparkles class="w-3.5 h-3.5 text-amber-500" />
          Monee 🎀 otomatis mencocokkan struk & pesan belanjaan ke kategori di atas.
        </span>
        <button
          type="button"
          on:click={onClose}
          class="font-bold text-brand-indigo hover:underline"
        >
          Tutup
        </button>
      </div>
    </div>
  </div>
{/if}
