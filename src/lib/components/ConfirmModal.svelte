<script lang="ts">
  import { confirmDialog } from '../stores/confirm';
  import { AlertTriangle, HelpCircle, X } from 'lucide-svelte';
</script>

{#if $confirmDialog.isOpen}
  <div class="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-brand-indigo/40 backdrop-blur-md transition-all">
    <div
      class="relative w-full max-w-sm bg-white/95 backdrop-blur-2xl rounded-3xl border border-white/80 shadow-glass-lg p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150"
    >
      <div class="flex items-start gap-3.5">
        <div class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 shadow-xs {
          $confirmDialog.isDestructive
            ? 'bg-rose-100 text-rose-600'
            : 'bg-brand-sky/30 text-brand-indigo'
        }">
          {#if $confirmDialog.isDestructive}
            <AlertTriangle class="w-5 h-5" />
          {:else}
            <HelpCircle class="w-5 h-5" />
          {/if}
        </div>

        <div class="flex-1 min-w-0 pr-6">
          <h3 class="text-sm font-black text-brand-indigo tracking-tight">{$confirmDialog.title}</h3>
          <p class="text-xs text-brand-indigo/70 font-medium leading-relaxed mt-1">{$confirmDialog.message}</p>
        </div>

        <button
          type="button"
          on:click={confirmDialog.cancel}
          class="absolute top-4 right-4 p-1.5 rounded-full hover:bg-black/5 text-brand-indigo/50 hover:text-brand-indigo transition"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex items-center justify-end gap-2.5 pt-2">
        <button
          type="button"
          on:click={confirmDialog.cancel}
          class="px-4 py-2 rounded-xl border border-black/10 text-brand-indigo/70 hover:bg-black/5 text-xs font-bold transition"
        >
          {$confirmDialog.cancelText || 'Batal'}
        </button>

        <button
          type="button"
          on:click={confirmDialog.accept}
          class="px-5 py-2 rounded-xl text-xs font-extrabold shadow-xs hover:scale-[1.02] active:scale-[0.98] transition {
            $confirmDialog.isDestructive
              ? 'bg-rose-600 hover:bg-rose-700 text-white'
              : 'bg-brand-indigo hover:bg-brand-indigo-dark text-white'
          }"
        >
          {$confirmDialog.confirmText || 'Konfirmasi'}
        </button>
      </div>
    </div>
  </div>
{/if}
