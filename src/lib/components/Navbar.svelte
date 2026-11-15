<script lang="ts">
  import { privacyMode } from "../stores/privacy";
  import { auth, clearAuth } from "../stores/auth";
  import {
    updateModalOpen,
    updateInfo,
    updateChecking,
  } from "../stores/update";
  import { checkAppUpdate } from "../utils/tauri-ipc";
  import {
    Eye,
    EyeOff,
    Sparkles,
    Bot,
    Bell,
    LogOut,
    Users,
    User,
    Settings,
    LayoutDashboard,
    BarChart3,
    Receipt,
    FileText,
    Wallet,
    ChevronDown,
    Layers,
  } from "lucide-svelte";
  import logoImg from "../../assets/logo.png";

  export let pendingCount: number = 0;
  export let activeView: "overview" | "analytics" | "transactions" | "reports" =
    "overview";
  export let onViewChange: (
    view: "overview" | "analytics" | "transactions" | "reports",
  ) => void;
  export let onOpenInvite: () => void;
  export let onOpenBotStatus: () => void;
  export let onOpenPending: () => void;
  export let onOpenLLMSettings: () => void;
  export let onOpenProfile: () => void;
  export let onOpenCategories: () => void;

  let logoError = false;
  let isProfileMenuOpen = false;

  function togglePrivacy() {
    privacyMode.update((v) => !v);
  }

  async function handleCheckUpdate() {
    updateChecking.set(true);
    try {
      const res = await checkAppUpdate();
      updateInfo.set(res);
      updateModalOpen.set(true);
    } catch (e) {
      console.error("Update check error:", e);
    } finally {
      updateChecking.set(false);
    }
  }
</script>

<header
  class="sticky top-0 z-40 w-full backdrop-blur-xl bg-white/80 border-b border-white/60 shadow-glass-sm transition-all"
>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    <div class="h-16 flex items-center justify-between gap-3">
      <!-- Brand Logo & Title (Always 1 Line) -->
      <div
        class="flex items-center gap-2.5 shrink-0 cursor-pointer select-none"
        on:click={() => onViewChange("overview")}
      >
        <div
          class="relative w-10 h-10 rounded-2xl overflow-hidden shadow-xs bg-gradient-to-tr from-brand-sky via-brand-peach to-brand-butter p-0.5 flex items-center justify-center shrink-0"
        >
          {#if logoError}
            <div
              class="w-full h-full rounded-[14px] bg-white flex items-center justify-center text-brand-indigo shadow-inner"
            >
              <Wallet class="w-5 h-5 text-brand-indigo" />
            </div>
          {:else}
            <img
              src={logoImg}
              alt="Ini Uangku"
              class="w-full h-full object-cover rounded-[14px]"
              on:error={() => (logoError = true)}
            />
          {/if}
        </div>

        <div class="flex items-center gap-2 whitespace-nowrap">
          <span
            class="text-base sm:text-lg font-black text-brand-indigo tracking-tight font-sans"
            >Ini Uangku</span
          >
          {#if $auth.family}
            <span
              class="text-xs text-brand-indigo/30 font-bold hidden sm:inline"
              >•</span
            >
            <span
              class="text-xs font-bold text-brand-indigo/60 hidden sm:inline max-w-[130px] truncate"
              title={$auth.family.name}
            >
              {$auth.family.name}
            </span>
          {/if}
          <span
            class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-brand-sky text-brand-indigo shadow-xs hidden xl:inline"
          >
            Monee AI
          </span>
        </div>
      </div>

      <!-- Navigation Tabs (Desktop & Tablet) -->
      <nav
        class="hidden md:flex items-center gap-1 p-1 rounded-2xl bg-white/80 border border-white/90 shadow-xs shrink-0"
      >
        <button
          on:click={() => onViewChange("overview")}
          class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap {activeView ===
          'overview'
            ? 'bg-brand-indigo text-white shadow-xs'
            : 'text-brand-indigo/70 hover:text-brand-indigo hover:bg-white/60'}"
        >
          <LayoutDashboard class="w-3.5 h-3.5 shrink-0" />
          <span>Ringkasan</span>
        </button>

        <button
          on:click={() => onViewChange("analytics")}
          class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap {activeView ===
          'analytics'
            ? 'bg-brand-indigo text-white shadow-xs'
            : 'text-brand-indigo/70 hover:text-brand-indigo hover:bg-white/60'}"
        >
          <BarChart3 class="w-3.5 h-3.5 shrink-0" />
          <span>Analitik</span>
        </button>

        <button
          on:click={() => onViewChange("transactions")}
          class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap {activeView ===
          'transactions'
            ? 'bg-brand-indigo text-white shadow-xs'
            : 'text-brand-indigo/70 hover:text-brand-indigo hover:bg-white/60'}"
        >
          <Receipt class="w-3.5 h-3.5 shrink-0" />
          <span>Transaksi</span>
        </button>

        <button
          on:click={() => onViewChange("reports")}
          class="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap {activeView ===
          'reports'
            ? 'bg-brand-indigo text-white shadow-xs'
            : 'text-brand-indigo/70 hover:text-brand-indigo hover:bg-white/60'}"
        >
          <FileText class="w-3.5 h-3.5 shrink-0" />
          <span>Laporan</span>
        </button>
      </nav>

      <!-- Center/Right Action Buttons -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Privacy Mode Toggle (Eye Icon) -->
        <button
          on:click={togglePrivacy}
          class="p-2.5 rounded-2xl text-xs font-semibold transition shadow-xs border {$privacyMode
            ? 'bg-brand-peach text-brand-indigo border-brand-peach-dark shadow-inner'
            : 'bg-white/80 text-brand-indigo/70 hover:text-brand-indigo border-white/70 hover:bg-white'}"
          title={$privacyMode
            ? "Sensor Saldo Aktif (Klik untuk Tampilkan)"
            : "Sensor Saldo (Klik untuk Sembunyikan)"}
        >
          {#if $privacyMode}
            <EyeOff class="w-4 h-4 text-brand-peach-dark" />
          {:else}
            <Eye class="w-4 h-4 text-brand-indigo/60" />
          {/if}
        </button>

        <!-- Pending Approval Notification -->
        <button
          on:click={onOpenPending}
          class="relative p-2.5 rounded-2xl bg-white/80 hover:bg-white border border-white/70 text-brand-indigo/70 hover:text-brand-indigo transition shadow-xs"
          title="Persetujuan Transaksi AI Menunggu"
        >
          <Bell class="w-4 h-4" />
          {#if pendingCount > 0}
            <span
              class="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-peach-dark text-white text-[10px] font-black flex items-center justify-center animate-bounce shadow-sm"
            >
              {pendingCount}
            </span>
          {/if}
        </button>

        <!-- Profile & Context Menu Dropdown -->
        {#if $auth.isAuthenticated}
          <div class="relative">
            <button
              on:click={() => (isProfileMenuOpen = !isProfileMenuOpen)}
              class="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-2xl bg-white/80 hover:bg-white border border-white/80 text-brand-indigo text-xs font-bold transition shadow-xs hover:shadow-sm"
            >
              <div
                class="w-7 h-7 rounded-xl bg-gradient-to-tr from-brand-peach to-brand-butter text-brand-indigo text-xs font-black flex items-center justify-center shadow-xs shrink-0"
              >
                {$auth.user?.name
                  ? $auth.user.name.substring(0, 1).toUpperCase()
                  : "U"}
              </div>
              <span class="max-w-[100px] truncate hidden sm:inline"
                >{$auth.user?.name || "Profil"}</span
              >
              <ChevronDown
                class="w-3.5 h-3.5 text-brand-indigo/50 transition-transform duration-200 {isProfileMenuOpen
                  ? 'rotate-180'
                  : ''}"
              />
            </button>

            <!-- Dropdown Context Menu -->
            {#if isProfileMenuOpen}
              <!-- Backdrop -->
              <div
                class="fixed inset-0 z-40"
                on:click={() => (isProfileMenuOpen = false)}
              ></div>

              <div
                class="absolute right-0 mt-2 w-64 rounded-3xl bg-white/95 backdrop-blur-2xl border border-white/80 shadow-glass-lg p-2 z-50 animate-in fade-in zoom-in-95 duration-150 space-y-1"
              >
                <!-- User Profile Header -->
                <div
                  class="p-3 bg-gradient-to-r from-brand-sky-light/40 to-brand-peach-light/40 rounded-2xl mb-1 border border-white/60"
                >
                  <div class="flex items-center gap-2.5">
                    <div
                      class="w-9 h-9 rounded-2xl bg-brand-peach flex items-center justify-center text-brand-indigo font-black text-sm shrink-0 shadow-xs"
                    >
                      {$auth.user?.name
                        ? $auth.user.name.substring(0, 1).toUpperCase()
                        : "U"}
                    </div>
                    <div class="min-w-0">
                      <div
                        class="text-xs font-extrabold text-brand-indigo truncate"
                      >
                        {$auth.user?.name}
                      </div>
                      <div class="text-[11px] text-brand-indigo/60 truncate">
                        {$auth.family
                          ? `Keluarga ${$auth.family.name}`
                          : $auth.user?.email || "Akun"}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Menu Item: Edit Profile -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    onOpenProfile();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-semibold text-brand-indigo/80 hover:text-brand-indigo hover:bg-brand-sky/20 transition text-left"
                >
                  <User class="w-4 h-4 text-brand-indigo/60 shrink-0" />
                  <span>Edit Profil & No HP</span>
                </button>

                <!-- Menu Item: Kelola Keluarga -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    onOpenInvite();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-semibold text-brand-indigo/80 hover:text-brand-indigo hover:bg-brand-peach/20 transition text-left"
                >
                  <Users class="w-4 h-4 text-brand-peach-dark shrink-0" />
                  <span>Kelola Keluarga & Anggota</span>
                </button>

                <!-- Menu Item: Kategori & Anggaran -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    onOpenCategories();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-semibold text-brand-indigo/80 hover:text-brand-indigo hover:bg-brand-mint/30 transition text-left"
                >
                  <Layers class="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Kategori Pengeluaran & Budget</span>
                </button>

                <!-- Menu Item: Status Bot Monee -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    onOpenBotStatus();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-semibold text-brand-indigo/80 hover:text-brand-indigo hover:bg-brand-butter/30 transition text-left"
                >
                  <Bot class="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Status Bot Monee & Chat</span>
                </button>

                <!-- Menu Item: Pengaturan AI (LLM) -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    onOpenLLMSettings();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-semibold text-brand-indigo/80 hover:text-brand-indigo hover:bg-brand-sky/20 transition text-left"
                >
                  <Settings class="w-4 h-4 text-brand-indigo/60 shrink-0" />
                  <span>Pengaturan Model AI (LLM)</span>
                </button>

                <!-- Menu Item: Periksa Pembaruan -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    handleCheckUpdate();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-semibold text-brand-indigo/80 hover:text-brand-indigo hover:bg-brand-butter/30 transition text-left"
                >
                  <Sparkles class="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Periksa Pembaruan</span>
                </button>

                <!-- Divider -->
                <div class="my-1 border-t border-black/5"></div>

                <!-- Menu Item: Logout -->
                <button
                  type="button"
                  on:click={() => {
                    isProfileMenuOpen = false;
                    clearAuth();
                  }}
                  class="w-full flex items-center gap-2.5 px-3 py-2 rounded-2xl text-xs font-bold text-red-600 hover:bg-red-50 transition text-left"
                >
                  <LogOut class="w-4 h-4 text-red-500 shrink-0" />
                  <span>Keluar (Logout)</span>
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- Mobile Navigation Tab Bar (visible on sm & below) -->
    <div
      class="flex md:hidden items-center justify-around py-2 border-t border-brand-indigo/5 text-xs font-bold"
    >
      <button
        on:click={() => onViewChange("overview")}
        class="flex flex-col items-center gap-0.5 py-1 px-2.5 rounded-xl transition {activeView ===
        'overview'
          ? 'text-brand-indigo font-black'
          : 'text-brand-indigo/50'}"
      >
        <LayoutDashboard class="w-4 h-4" />
        <span>Ringkasan</span>
      </button>

      <button
        on:click={() => onViewChange("analytics")}
        class="flex flex-col items-center gap-0.5 py-1 px-2.5 rounded-xl transition {activeView ===
        'analytics'
          ? 'text-brand-indigo font-black'
          : 'text-brand-indigo/50'}"
      >
        <BarChart3 class="w-4 h-4" />
        <span>Analitik</span>
      </button>

      <button
        on:click={() => onViewChange("transactions")}
        class="flex flex-col items-center gap-0.5 py-1 px-2.5 rounded-xl transition {activeView ===
        'transactions'
          ? 'text-brand-indigo font-black'
          : 'text-brand-indigo/50'}"
      >
        <Receipt class="w-4 h-4" />
        <span>Transaksi</span>
      </button>

      <button
        on:click={() => onViewChange("reports")}
        class="flex flex-col items-center gap-0.5 py-1 px-2.5 rounded-xl transition {activeView ===
        'reports'
          ? 'text-brand-indigo font-black'
          : 'text-brand-indigo/50'}"
      >
        <FileText class="w-4 h-4" />
        <span>Laporan</span>
      </button>
    </div>
  </div>
</header>
