<script lang="ts">
  import type { Wallet } from '../types';
  import { privacyMode } from '../stores/privacy';
  import { formatRupiah } from '../utils/format';
  import { Wallet as WalletIcon, Plus, CreditCard, Banknote, Landmark, ShieldCheck } from 'lucide-svelte';

  export let wallets: Wallet[] = [];
  export let onAddWallet: () => void;

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
        class="relative p-5 rounded-3xl bg-gradient-to-br {getWalletGradient(idx, wallet.isShared)} backdrop-blur-xl border border-white/80 shadow-glass-sm hover:shadow-glass hover:-translate-y-0.5 transition-all group overflow-hidden"
      >
        <!-- Background subtle glow -->
        <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/40 blur-xl pointer-events-none"></div>

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
          {#if wallet.isShared}
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/90 text-brand-peach-dark border border-brand-peach/30 shadow-xs flex items-center gap-1">
              <ShieldCheck class="w-3 h-3" /> Bersama
            </span>
          {/if}
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
    {/each}
  </div>
</div>
