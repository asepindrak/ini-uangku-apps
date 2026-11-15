<script lang="ts">
  import { toast } from '../stores/toast';
  import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-svelte';
</script>

<div class="fixed top-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0">
  {#each $toast as t (t.id)}
    <div
      class="pointer-events-auto p-4 rounded-2xl backdrop-blur-xl border shadow-glass-lg transition-all animate-in fade-in slide-in-from-top-3 duration-200 flex items-start gap-3 {
        t.type === 'success'
          ? 'bg-emerald-50/95 border-emerald-200/80 text-emerald-900 shadow-emerald-500/10'
          : t.type === 'error'
          ? 'bg-rose-50/95 border-rose-200/80 text-rose-900 shadow-rose-500/10'
          : t.type === 'warning'
          ? 'bg-amber-50/95 border-amber-200/80 text-amber-900 shadow-amber-500/10'
          : 'bg-white/95 border-brand-sky/40 text-brand-indigo shadow-glass'
      }"
    >
      <div class="mt-0.5 shrink-0">
        {#if t.type === 'success'}
          <CheckCircle2 class="w-5 h-5 text-emerald-600" />
        {:else if t.type === 'error'}
          <AlertCircle class="w-5 h-5 text-rose-600" />
        {:else if t.type === 'warning'}
          <AlertTriangle class="w-5 h-5 text-amber-600" />
        {:else}
          <Info class="w-5 h-5 text-brand-sky" />
        {/if}
      </div>

      <div class="flex-1 min-w-0 pr-1">
        {#if t.title}
          <h4 class="text-xs font-black tracking-tight mb-0.5">{t.title}</h4>
        {/if}
        <p class="text-xs font-medium leading-relaxed opacity-90 break-words">{t.message}</p>
      </div>

      <button
        type="button"
        on:click={() => toast.dismiss(t.id)}
        class="p-1 rounded-lg hover:bg-black/5 opacity-60 hover:opacity-100 transition shrink-0"
      >
        <X class="w-3.5 h-3.5" />
      </button>
    </div>
  {/each}
</div>
