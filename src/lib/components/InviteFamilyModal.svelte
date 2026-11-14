<script lang="ts">
  import { onMount } from 'svelte';
  import qrcode from 'qrcode';
  import { api } from '../api';
  import { X, Copy, Check, Share2, QrCode, UserPlus, Phone, Send } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;
  export let onMemberAdded: () => void;

  let activeTab: 'invite' | 'direct' = 'invite';
  let inviteCode = '';
  let inviteUrl = '';
  let familyName = '';
  let qrCodeDataUrl = '';
  let copied = false;

  // Direct add form state
  let memberName = '';
  let countryCode = '+62';
  let whatsappNumber = '';
  let telegramChatId = '';
  let role = 'MEMBER';
  let loading = false;
  let errorMsg = '';
  let successMsg = '';

  const countryCodes = [
    { code: '+62', label: '🇮🇩 Indonesia (+62)' },
    { code: '+60', label: '🇲🇾 Malaysia (+60)' },
    { code: '+65', label: '🇸🇬 Singapura (+65)' },
    { code: '+1', label: '🇺🇸 Amerika / Kanada (+1)' },
    { code: '+44', label: '🇬🇧 Inggris (+44)' },
    { code: '+81', label: '🇯🇵 Jepang (+81)' },
    { code: '+61', label: '🇦🇺 Australia (+61)' },
    { code: '+966', label: '🇸🇦 Arab Saudi (+966)' },
  ];

  onMount(async () => {
    await loadInvite();
  });

  $: if (isOpen) {
    loadInvite();
  }

  async function loadInvite() {
    try {
      const data = await api.getInvite();
      inviteCode = data.inviteCode;
      inviteUrl = data.inviteUrl;
      familyName = data.familyName;
      qrCodeDataUrl = await qrcode.toDataURL(inviteUrl, {
        width: 260,
        margin: 2,
        color: {
          dark: '#443D66',
          light: '#FFFFFF',
        },
      });
    } catch (e) {
      console.error('Failed to load invite:', e);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    copied = true;
    setTimeout(() => (copied = false), 2500);
  }

  function handleShareWhatsApp() {
    const text = `Halo! Yuk gabung ke pembukuan keuangan keluarga kita "${familyName}" di aplikasi Ini Uangku.\n\nKlik link ini untuk bergabung:\n${inviteUrl}\n\nAtau masukkan Kode Undangan: *${inviteCode}*`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  }

  async function handleDirectAdd() {
    if (!memberName) {
      errorMsg = 'Nama anggota keluarga wajib diisi.';
      return;
    }
    loading = true;
    errorMsg = '';
    successMsg = '';

    try {
      await api.addMember({
        name: memberName,
        countryCode,
        whatsappNumber,
        telegramChatId,
        role,
      });

      successMsg = `Berhasil menambahkan ${memberName} ke whitelist keluarga!`;
      memberName = '';
      whatsappNumber = '';
      telegramChatId = '';
      onMemberAdded();
      setTimeout(() => (successMsg = ''), 3000);
    } catch (err: any) {
      errorMsg = err.message || 'Gagal menambahkan anggota keluarga.';
    } finally {
      loading = false;
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <!-- Header -->
      <div class="p-6 pb-4 bg-gradient-to-r from-brand-sky-light via-brand-peach-light to-brand-butter-light border-b border-white/40 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-sky to-brand-peach flex items-center justify-center text-brand-indigo shadow-xs">
            <UserPlus class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-brand-indigo">Undang Anggota Keluarga 🎀</h3>
            <p class="text-xs text-brand-indigo/60">{familyName || 'Keluarga Ini Uangku'}</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo">
          <X class="w-5 h-5" />
        </button>
      </div>

      <!-- Tab Selection -->
      <div class="flex border-b border-white/60 bg-white/40 px-6 pt-3 gap-2">
        <button
          on:click={() => (activeTab = 'invite')}
          class="pb-2.5 text-xs font-bold transition border-b-2 flex items-center gap-1.5 {activeTab === 'invite' ? 'border-brand-peach-dark text-brand-indigo' : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo'}"
        >
          <QrCode class="w-4 h-4" />
          Bagikan QR & Link
        </button>
        <button
          on:click={() => (activeTab = 'direct')}
          class="pb-2.5 text-xs font-bold transition border-b-2 flex items-center gap-1.5 {activeTab === 'direct' ? 'border-brand-peach-dark text-brand-indigo' : 'border-transparent text-brand-indigo/50 hover:text-brand-indigo'}"
        >
          <Phone class="w-4 h-4" />
          Input No WA & Telegram
        </button>
      </div>

      <div class="p-6 max-h-[65vh] overflow-y-auto">
        {#if activeTab === 'invite'}
          <div class="text-center space-y-4">
            <p class="text-xs text-brand-indigo/70">
              Scan QR Code ini dari kamera ponsel atau bagikan tautan ini ke pasangan / anak agar langsung terhubung.
            </p>

            {#if qrCodeDataUrl}
              <div class="inline-block p-4 rounded-3xl bg-white shadow-glass-sm border border-brand-indigo/10">
                <img src={qrCodeDataUrl} alt="QR Code Undangan" class="w-48 h-48 mx-auto rounded-xl" />
                <span class="block text-xs font-mono font-bold text-brand-indigo mt-2">Kode: {inviteCode}</span>
              </div>
            {/if}

            <div class="flex items-center gap-2">
              <input
                type="text"
                readonly
                value={inviteUrl}
                class="flex-1 px-3.5 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo/80 font-mono shadow-inner outline-none select-all"
              />
              <button
                on:click={handleCopy}
                class="px-3.5 py-2.5 rounded-2xl bg-white hover:bg-brand-sky-light text-brand-indigo text-xs font-bold border border-white shadow-xs transition flex items-center gap-1"
              >
                {#if copied}
                  <Check class="w-4 h-4 text-emerald-600" />
                  Tersalin!
                {:else}
                  <Copy class="w-4 h-4" />
                  Salin
                {/if}
              </button>
            </div>

            <button
              on:click={handleShareWhatsApp}
              class="w-full py-3 rounded-2xl bg-[#25D366] hover:bg-[#20ba59] text-white text-xs font-bold shadow-sm flex items-center justify-center gap-2 transition"
            >
              <Share2 class="w-4 h-4" />
              Bagikan ke Grup WhatsApp Keluarga
            </button>
          </div>
        {:else}
          <!-- Direct Add Form -->
          <form on:submit|preventDefault={handleDirectAdd} class="space-y-3.5">
            {#if errorMsg}
              <div class="p-3 rounded-2xl bg-red-50 text-red-600 text-xs font-semibold">{errorMsg}</div>
            {/if}
            {#if successMsg}
              <div class="p-3 rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-semibold">{successMsg}</div>
            {/if}

            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">Nama Anggota Keluarga</label>
              <input
                type="text"
                bind:value={memberName}
                placeholder="Contoh: Bunda, Ayah, Kakak"
                class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none focus:ring-2 focus:ring-brand-peach"
                required
              />
            </div>

            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">Nomor WhatsApp (Whitelist AI Bot)</label>
              <div class="flex gap-2">
                <select
                  bind:value={countryCode}
                  class="px-3 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-medium"
                >
                  {#each countryCodes as cc}
                    <option value={cc.code}>{cc.label}</option>
                  {/each}
                </select>
                <input
                  type="tel"
                  bind:value={whatsappNumber}
                  placeholder="8123456789"
                  class="flex-1 px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-peach"
                />
              </div>
              <p class="text-[11px] text-brand-indigo/50 mt-1">Hanya nomor ini yang diizinkan chat dengan bot WhatsApp.</p>
            </div>

            <div>
              <label class="block text-xs font-bold text-brand-indigo mb-1">User ID Telegram (Opsional)</label>
              <input
                type="text"
                bind:value={telegramChatId}
                placeholder="Contoh: 123456789"
                class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-sky"
              />
              <p class="text-[11px] text-brand-indigo/50 mt-1">Dapat diperoleh dengan mengirim /start ke bot Telegram Anda.</p>
            </div>

            <button
              type="submit"
              disabled={loading}
              class="w-full py-3 rounded-2xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-sm hover:scale-[1.01] transition disabled:opacity-50 mt-2"
            >
              {loading ? 'Menyimpan...' : 'Tambahkan ke Whitelist Keluarga'}
            </button>
          </form>
        {/if}
      </div>
    </div>
  </div>
{/if}
