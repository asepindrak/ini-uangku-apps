<script lang="ts">
  import type { Wallet } from '../types';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah } from '../utils/format';
  import { Wallet as WalletIcon, Plus, CreditCard, Banknote, Landmark, ShieldCheck, Star, Pencil, X, Trash2, Check } from 'lucide-svelte';
  import { api } from '../api';
  import { toast } from '../stores/toast';
  import { confirmDialog } from '../stores/confirm';

  export let wallets: Wallet[] = [];
  export let onAddWallet: () => void;
  export let onRefresh: (() => void) | undefined = undefined;

  let settingDefaultId: string | null = null;

  // Edit Modal State
  let editingWallet: Wallet | null = null;
  let editName = '';
  let editType: 'BANK' | 'CASH' | 'E_WALLET' | 'INVESTMENT' = 'BANK';
  let editBalance = 0;
  let editIsShared = false;
  let editIsDefault = false;
  let saving = false;
  let deleting = false;

  function setEditType(t: any) {
    editType = t;
  }

  function openEdit(wallet: Wallet) {
    editingWallet = wallet;
    editName = wallet.name;
    editType = wallet.type;
    editBalance = Number(wallet.balance) || 0;
    editIsShared = Boolean(wallet.isShared);
    editIsDefault = Boolean(wallet.isDefaultExpense);
  }

  function closeEdit() {
    editingWallet = null;
  }

  async function handleSaveEdit() {
    if (!editingWallet || !editName.trim()) return;
    saving = true;
    try {
      await api.updateWallet(editingWallet.id, {
        name: editName.trim(),
        type: editType,
        balance: editBalance,
        isShared: editIsShared,
        isDefaultExpense: editIsDefault,
      });

      toast.success(`Perubahan dompet "${editName.trim()}" berhasil disimpan!`);
      closeEdit();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menyimpan perubahan dompet.');
    } finally {
      saving = false;
    }
  }

  async function handleDeleteWallet() {
    if (!editingWallet) return;
    const confirmed = await confirmDialog.confirm({
      title: 'Hapus Dompet',
      message: `Hapus dompet "${editingWallet.name}"? Data saldo dompet ini akan dihapus.`,
      confirmText: 'Hapus Dompet',
      cancelText: 'Batal',
      isDestructive: true,
    });
    if (!confirmed) return;

    deleting = true;
    try {
      await api.deleteWallet(editingWallet.id);
      toast.success(`Dompet "${editingWallet.name}" berhasil dihapus.`);
      closeEdit();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Gagal menghapus dompet.');
    } finally {
      deleting = false;
    }
  }

  async function handleSetDefault(wallet: Wallet) {
    if (wallet.isDefaultExpense) return;
    settingDefaultId = wallet.id;
    try {
      await api.setDefaultWallet(wallet.id);
      toast.success(`Dompet "${wallet.name}" kini menjadi dompet utama pengeluaran! ⭐`);
      if (onRefresh) {
        onRefresh();
      } else {
        wallets = wallets.map(w => ({
          ...w,
          isDefaultExpense: w.id === wallet.id
        }));
      }
    } catch (err: any) {
      toast.error(err.message || 'Gagal mengatur dompet default');
    } finally {
      settingDefaultId = null;
    }
  }

  function getWalletGradient(index: number, isShared: boolean): string {
    if (isShared) {
      return 'from-brand-peach via-brand-peach-light to-white';
    }
    const gradients = [
      'from-brand-sky via-brand-sky-light to-white',
      'from-brand-butter via-brand-butter-light to-white',
      'from-brand-mint via-brand-mint-light to-white',
      'from-purple-200 via-purple-100 to-white',
    ];
    return gradients[index % gradients.length];
  }

  function getWalletIcon(type: string) {
    switch (type) {
      case 'BANK': return Landmark;
      case 'CASH': return Banknote;
      case 'E_WALLET': return CreditCard;
      default: return WalletIcon;
    }
  }
</script>

<div class="space-y-3">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h2 class="text-base font-bold text-brand-indigo">Dompet & Rekening Keluarga</h2>
      <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/70 text-brand-indigo/70 border border-white">
        {wallets.length} Dompet
      </span>
    </div>
    <button
      on:click={onAddWallet}
      class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/80 hover:bg-white text-brand-indigo text-xs font-semibold border border-white/80 shadow-xs transition"
    >
      <Plus class="w-3.5 h-3.5 text-brand-peach-dark" />
      Tambah Dompet
    </button>
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each wallets as wallet, idx}
      <div
        class="relative p-5 rounded-3xl bg-gradient-to-br {getWalletGradient(idx, wallet.isShared)} backdrop-blur-xl border {wallet.isDefaultExpense ? 'border-amber-400/80 ring-2 ring-amber-300/40 shadow-md' : 'border-white/80 shadow-glass-sm'} hover:shadow-glass hover:-translate-y-0.5 transition-all group overflow-hidden flex flex-col justify-between"
      >
        <!-- Background subtle glow -->
        <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/40 blur-xl pointer-events-none"></div>

        <div>
          <div class="flex items-start justify-between relative z-10">
            <div class="flex items-center gap-2.5">
              <div class="w-10 h-10 rounded-2xl bg-white/80 backdrop-blur-md flex items-center justify-center text-brand-indigo shadow-xs">
                <svelte:component this={getWalletIcon(wallet.type)} class="w-5 h-5 text-brand-indigo" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-brand-indigo tracking-tight">{wallet.name}</h3>
                <p class="text-[11px] text-brand-indigo/60 font-medium">
                  {wallet.isShared ? 'Rekening Bersama' : wallet.userName ? `Milik ${wallet.userName}` : 'Dompet Pribadi'}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1.5 flex-wrap justify-end">
              {#if wallet.isDefaultExpense}
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100/90 text-amber-800 border border-amber-300 shadow-xs flex items-center gap-1" title="Dompet default untuk pengeluaran yang tidak menyebutkan dompet">
                  <Star class="w-3 h-3 fill-amber-500 text-amber-500" /> Default
                </span>
              {/if}
              {#if wallet.isShared}
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 text-brand-peach-dark border border-brand-peach/30 shadow-xs flex items-center gap-1">
                  <ShieldCheck class="w-3 h-3" /> Bersama
                </span>
              {/if}
            </div>
          </div>

          <div class="mt-5 relative z-10">
            <span class="text-[11px] font-medium text-brand-indigo/60 uppercase tracking-wider">Saldo Saat Ini</span>
            <div class="text-xl sm:text-2xl font-black text-brand-indigo tracking-tight mt-0.5 font-sans">
              {#if $privacyMode}
                <span class="tracking-widest text-brand-indigo/40 select-none">Rp ••••••••</span>
              {:else}
                {formatRupiah(wallet.balance)}
              {/if}
            </div>
          </div>
        </div>

        <div class="mt-4 pt-3 border-t border-black/5 flex items-center justify-between relative z-10 text-xs">
          <div>
            {#if wallet.isDefaultExpense}
              <span class="text-[11px] font-bold text-amber-800 flex items-center gap-1">
                <Star class="w-3 h-3 fill-amber-500 text-amber-500" /> Default Pengeluaran
              </span>
            {:else}
              <button
                type="button"
                on:click={() => handleSetDefault(wallet)}
                disabled={settingDefaultId === wallet.id}
                class="text-[11px] font-semibold text-brand-indigo/70 hover:text-amber-800 flex items-center gap-1 transition px-2 py-1 rounded-lg hover:bg-white/70 active:scale-95 disabled:opacity-50"
                title="Jadikan dompet default untuk pengeluaran"
              >
                <Star class="w-3 h-3 text-brand-indigo/50" />
                {settingDefaultId === wallet.id ? 'Menyimpan...' : 'Jadikan Default'}
              </button>
            {/if}
          </div>

          <button
            type="button"
            on:click={() => openEdit(wallet)}
            class="text-[11px] font-semibold text-brand-indigo/60 hover:text-brand-indigo flex items-center gap-1 transition px-2 py-1 rounded-lg hover:bg-white/70 active:scale-95"
            title="Edit nama, tipe, atau saldo dompet ini"
          >
            <Pencil class="w-3 h-3 text-brand-indigo/50" />
            Edit
          </button>
        </div>
      </div>
    {/each}
  </div>
</div>

<!-- Modal Edit Dompet -->
{#if editingWallet}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-md bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <!-- Header -->
      <div class="p-5 bg-gradient-to-r from-brand-sky-light via-brand-peach-light to-brand-butter-light border-b border-white/40 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-2xl bg-white/80 flex items-center justify-center text-brand-indigo shadow-xs">
            <Pencil class="w-4 h-4" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-brand-indigo">Edit Dompet & Rekening</h3>
            <p class="text-[11px] text-brand-indigo/60">Sesuaikan nama, tipe, atau saldo dompet</p>
          </div>
        </div>
        <button on:click={closeEdit} class="p-1.5 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo">
          <X class="w-4 h-4" />
        </button>
      </div>

      <!-- Form Body -->
      <form on:submit|preventDefault={handleSaveEdit} class="p-5 space-y-4">
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Nama Dompet</label>
          <input
            type="text"
            bind:value={editName}
            placeholder="Contoh: BCA Utama, Kas Tunai, Bank Jago"
            class="w-full px-3.5 py-2.5 rounded-2xl bg-white/90 border border-brand-indigo/10 text-xs text-brand-indigo font-medium shadow-inner outline-none focus:ring-2 focus:ring-brand-peach"
            required
          />
        </div>

        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Tipe Dompet</label>
          <div class="grid grid-cols-2 gap-2">
            {#each [
              { type: 'BANK', label: '🏦 Rekening Bank' },
              { type: 'CASH', label: '💵 Kas Tunai' },
              { type: 'E_WALLET', label: '💳 E-Wallet' },
              { type: 'INVESTMENT', label: '📈 Investasi' }
            ] as opt}
              <button
                type="button"
                on:click={() => setEditType(opt.type)}
                class="py-2 px-3 rounded-xl border text-xs font-semibold text-left transition {editType === opt.type ? 'border-brand-peach-dark bg-brand-peach/20 text-brand-indigo' : 'border-black/5 bg-white/60 text-brand-indigo/60 hover:text-brand-indigo'}"
              >
                {opt.label}
              </button>
            {/each}
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1">Saldo Saat Ini (Rp)</label>
          <input
            type="number"
            bind:value={editBalance}
            min="0"
            step="1000"
            placeholder="0"
            class="w-full px-3.5 py-2.5 rounded-2xl bg-white/90 border border-brand-indigo/10 text-xs font-mono font-bold text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-sky"
          />
          <p class="text-[11px] text-brand-indigo/50 mt-1">Ubah nominal saldo riil yang ada pada dompet / rekening ini.</p>
        </div>

        <!-- Toggles -->
        <div class="pt-2 border-t border-black/5 space-y-2.5">
          <label class="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={editIsDefault}
              class="w-4 h-4 rounded text-brand-peach-dark focus:ring-brand-peach accent-amber-500"
            />
            <div>
              <span class="text-xs font-bold text-brand-indigo flex items-center gap-1">
                <Star class="w-3.5 h-3.5 text-amber-500 fill-amber-500" /> Jadikan Default Pengeluaran
              </span>
              <p class="text-[10px] text-brand-indigo/60">Otomatis digunakan saat pengeluaran tidak menyebutkan dompet.</p>
            </div>
          </label>

          <label class="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={editIsShared}
              class="w-4 h-4 rounded text-brand-peach-dark focus:ring-brand-peach accent-brand-peach-dark"
            />
            <div>
              <span class="text-xs font-bold text-brand-indigo flex items-center gap-1">
                <ShieldCheck class="w-3.5 h-3.5 text-brand-peach-dark" /> Rekening Bersama Keluarga
              </span>
              <p class="text-[10px] text-brand-indigo/60">Dapat dilihat dan digunakan oleh seluruh anggota keluarga.</p>
            </div>
          </label>
        </div>

        <!-- Action Buttons -->
        <div class="pt-3 border-t border-black/5 flex items-center justify-between gap-2">
          <button
            type="button"
            on:click={handleDeleteWallet}
            disabled={deleting}
            class="px-3 py-2 rounded-xl text-red-500 hover:text-red-700 hover:bg-red-50 text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 class="w-3.5 h-3.5" />
            Hapus
          </button>

          <div class="flex items-center gap-2">
            <button
              type="button"
              on:click={closeEdit}
              class="px-4 py-2 rounded-xl border border-black/10 text-brand-indigo/70 hover:bg-white text-xs font-bold transition"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              class="px-5 py-2 rounded-xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-xs hover:scale-[1.02] active:scale-[0.98] transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <Check class="w-3.5 h-3.5" />
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
{/if}
