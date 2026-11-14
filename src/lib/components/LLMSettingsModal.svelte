<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../api';
  import { X, Sparkles, Check, Save, Server, Key, Cpu } from 'lucide-svelte';

  export let isOpen: boolean = false;
  export let onClose: () => void;

  let activeProvider: 'gemini' | 'openai' | 'claude' | 'custom' = 'gemini';
  let apiKey = '';
  let baseUrl = '';
  let modelName = 'gemini-2.0-flash';
  let temperature = 0.2;
  let loading = false;
  let successMsg = '';
  let errorMsg = '';

  const providerDefaults: Record<string, { model: string; base?: string; placeholder: string }> = {
    gemini: { model: 'gemini-2.0-flash', placeholder: 'AIzaSy...' },
    openai: { model: 'gpt-4o-mini', placeholder: 'sk-proj-...' },
    claude: { model: 'claude-3-5-sonnet-20241022', placeholder: 'sk-ant-...' },
    custom: { model: 'deepseek-chat', base: 'https://api.deepseek.com/v1', placeholder: 'Kunci API Custom / Bebas' },
  };

  onMount(loadConfig);

  $: if (isOpen) {
    loadConfig();
  }

  async function loadConfig() {
    try {
      const cfg = await api.getLLMConfig();
      activeProvider = cfg.activeProvider || 'gemini';
      baseUrl = cfg.baseUrl || '';
      modelName = cfg.modelName || providerDefaults[activeProvider]?.model || '';
      temperature = cfg.temperature ?? 0.2;
    } catch (e) {
      console.error(e);
    }
  }

  function handleProviderChange(prov: string) {
    activeProvider = prov as any;
    modelName = providerDefaults[prov]?.model || 'gemini-2.0-flash';
    if (providerDefaults[prov]?.base) {
      baseUrl = providerDefaults[prov].base!;
    } else {
      baseUrl = '';
    }
  }

  async function handleSave() {
    loading = true;
    errorMsg = '';
    successMsg = '';
    try {
      await api.updateLLMConfig({
        activeProvider,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        modelName,
        temperature,
      });
      successMsg = 'Konfigurasi model AI berhasil disimpan!';
      setTimeout(() => (successMsg = ''), 3000);
    } catch (err: any) {
      errorMsg = err.message || 'Gagal menyimpan konfigurasi AI.';
    } finally {
      loading = false;
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-indigo/30 backdrop-blur-md transition-all">
    <div class="relative w-full max-w-lg bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <!-- Header -->
      <div class="p-6 pb-4 bg-gradient-to-r from-brand-peach-light via-brand-butter-light to-brand-sky-light border-b border-white/40 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-peach to-brand-butter flex items-center justify-center text-brand-indigo shadow-xs">
            <Sparkles class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-bold text-brand-indigo">Pengaturan AI Model (Multi-LLM)</h3>
            <p class="text-xs text-brand-indigo/60">Pilih provider atau masukkan custom OpenAI-compatible</p>
          </div>
        </div>
        <button on:click={onClose} class="p-2 rounded-full hover:bg-white/60 text-brand-indigo/60 hover:text-brand-indigo">
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        {#if successMsg}
          <div class="p-3 rounded-2xl bg-emerald-50 text-emerald-700 text-xs font-semibold">{successMsg}</div>
        {/if}
        {#if errorMsg}
          <div class="p-3 rounded-2xl bg-red-50 text-red-600 text-xs font-semibold">{errorMsg}</div>
        {/if}

        <!-- Provider Buttons -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-2">Pilih Provider AI</label>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {#each ['gemini', 'openai', 'claude', 'custom'] as prov}
              <button
                type="button"
                on:click={() => handleProviderChange(prov)}
                class="py-2.5 px-3 rounded-2xl text-xs font-bold capitalize transition border {activeProvider === prov
                  ? 'bg-brand-sky text-brand-indigo-dark border-brand-sky-dark shadow-xs'
                  : 'bg-white/80 text-brand-indigo/60 hover:bg-white border-white/80'}"
              >
                {prov}
              </button>
            {/each}
          </div>
        </div>

        <!-- Custom Base URL -->
        {#if activeProvider === 'custom'}
          <div>
            <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
              <Server class="w-3.5 h-3.5" />
              Base URL (OpenAI-Compatible)
            </label>
            <input
              type="url"
              bind:value={baseUrl}
              placeholder="https://api.deepseek.com/v1 atau http://localhost:11434/v1"
              class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-sky"
            />
          </div>
        {/if}

        <!-- Model Name -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
            <Cpu class="w-3.5 h-3.5" />
            Model Identifier
          </label>
          <input
            type="text"
            bind:value={modelName}
            placeholder="gemini-2.0-flash / gpt-4o / deepseek-chat"
            class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-peach"
          />
        </div>

        <!-- API Key -->
        <div>
          <label class="block text-xs font-bold text-brand-indigo mb-1 flex items-center gap-1.5">
            <Key class="w-3.5 h-3.5" />
            API Key
          </label>
          <input
            type="password"
            bind:value={apiKey}
            placeholder={providerDefaults[activeProvider]?.placeholder || 'Masukkan API Key Anda'}
            class="w-full px-4 py-2.5 rounded-2xl bg-white/80 border border-white text-xs text-brand-indigo shadow-inner outline-none font-mono focus:ring-2 focus:ring-brand-peach"
          />
          <p class="text-[11px] text-brand-indigo/50 mt-1">Kosongkan jika ingin menggunakan kunci default server.</p>
        </div>

        <button
          on:click={handleSave}
          disabled={loading}
          class="w-full py-3 rounded-2xl bg-gradient-to-r from-brand-peach via-brand-butter to-brand-sky text-brand-indigo text-xs font-extrabold shadow-sm hover:scale-[1.01] transition disabled:opacity-50 mt-2 flex items-center justify-center gap-2"
        >
          <Save class="w-4 h-4" />
          {loading ? 'Menyimpan...' : 'Simpan Konfigurasi AI'}
        </button>
      </div>
    </div>
  </div>
{/if}
