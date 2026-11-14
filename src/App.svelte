<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from './lib/stores/auth';
  import { api } from './lib/api';
  import type { Wallet, Transaction, SinkingFund } from './lib/types';
  import Navbar from './lib/components/Navbar.svelte';
  import WalletCarousel from './lib/components/WalletCarousel.svelte';
  import NetWorthCard from './lib/components/NetWorthCard.svelte';
  import SinkingFundsList from './lib/components/SinkingFundsList.svelte';
  import RecentTransactions from './lib/components/RecentTransactions.svelte';
  import PendingApprovalsModal from './lib/components/PendingApprovalsModal.svelte';
  import InviteFamilyModal from './lib/components/InviteFamilyModal.svelte';
  import BotStatusModal from './lib/components/BotStatusModal.svelte';
  import LLMSettingsModal from './lib/components/LLMSettingsModal.svelte';
  import UpdateModal from './lib/components/UpdateModal.svelte';
  import AuthModal from './lib/components/AuthModal.svelte';

  let wallets: Wallet[] = [];
  let transactions: Transaction[] = [];
  let sinkingFunds: SinkingFund[] = [];
  let pendingActions: any[] = [];
  let netWorthData = { totalCash: 0, totalAsset: 0, totalDebt: 0, netWorth: 0 };

  // Modals state
  let isPendingOpen = false;
  let isInviteOpen = false;
  let isBotStatusOpen = false;
  let isLLMSettingsOpen = false;

  onMount(async () => {
    if ($auth.isAuthenticated) {
      await loadDashboardData();
    }
  });

  async function loadDashboardData() {
    try {
      const [w, t, s, nw, p] = await Promise.all([
        api.getWallets().catch(() => []),
        api.getTransactions().catch(() => []),
        api.getSinkingFunds().catch(() => []),
        api.getNetWorth().catch(() => ({ totalCash: 0, totalAsset: 0, totalDebt: 0, netWorth: 0 })),
        api.getPendingActions().catch(() => []),
      ]);

      wallets = w;
      transactions = t;
      sinkingFunds = s;
      netWorthData = nw;
      pendingActions = p;
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    }
  }

  function handleAddWallet() {
    const name = prompt('Masukkan nama dompet baru (contoh: Dompet Ibu, Tabungan Anak):');
    if (name) {
      api.createWallet({ name, type: 'BANK', balance: 0, colorCode: '#FFC1B6' })
        .then(() => loadDashboardData())
        .catch((e) => alert(e.message));
    }
  }

  function handleAddSinkingFund() {
    const name = prompt('Masukkan nama pos dana siaga (contoh: Pajak Mobil Tahunan, Liburan, Kurban):');
    if (!name) return;
    const targetStr = prompt('Target nominal (contoh: 3600000):', '3600000');
    if (!targetStr) return;
    const allocStr = prompt('Alokasi bulanan (contoh: 300000):', '300000');
    if (!allocStr) return;

    const sourceWallet = wallets[0];
    if (!sourceWallet) {
      alert('Buat dompet terlebih dahulu.');
      return;
    }

    api.createSinkingFund({
      name,
      targetAmount: Number(targetStr),
      monthlyAlloc: Number(allocStr),
      sourceWalletId: sourceWallet.id,
    })
      .then(() => loadDashboardData())
      .catch((e) => alert(e.message));
  }
</script>

{#if !$auth.isAuthenticated}
  <AuthModal onLoginSuccess={loadDashboardData} />
{:else}
  <div class="min-h-screen flex flex-col pb-16">
    <Navbar
      pendingCount={pendingActions.length}
      onOpenInvite={() => (isInviteOpen = true)}
      onOpenBotStatus={() => (isBotStatusOpen = true)}
      onOpenPending={() => (isPendingOpen = true)}
      onOpenLLMSettings={() => (isLLMSettingsOpen = true)}
    />

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 w-full space-y-8 flex-1">
      <!-- 1. Net Worth Card -->
      <NetWorthCard
        totalCash={netWorthData.totalCash}
        totalAsset={netWorthData.totalAsset}
        totalDebt={netWorthData.totalDebt}
        netWorth={netWorthData.netWorth}
      />

      <!-- 2. Multi-Wallet Carousel -->
      <WalletCarousel
        {wallets}
        onAddWallet={handleAddWallet}
      />

      <!-- 3. Sinking Funds List -->
      <SinkingFundsList
        funds={sinkingFunds}
        onAddFund={handleAddSinkingFund}
      />

      <!-- 4. Recent Transactions -->
      <RecentTransactions
        {transactions}
      />
    </main>

    <!-- Modals -->
    <PendingApprovalsModal
      isOpen={isPendingOpen}
      {pendingActions}
      onClose={() => (isPendingOpen = false)}
      onActionProcessed={loadDashboardData}
    />

    <InviteFamilyModal
      isOpen={isInviteOpen}
      onClose={() => (isInviteOpen = false)}
      onMemberAdded={loadDashboardData}
    />

    <BotStatusModal
      isOpen={isBotStatusOpen}
      onClose={() => (isBotStatusOpen = false)}
    />

    <LLMSettingsModal
      isOpen={isLLMSettingsOpen}
      onClose={() => (isLLMSettingsOpen = false)}
    />

    <UpdateModal />
  </div>
{/if}
