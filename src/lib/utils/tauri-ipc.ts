import type { UpdateInfo } from '../stores/update';

export const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export async function checkAppUpdate(): Promise<UpdateInfo> {
  if (!isTauri) {
    return {
      has_update: false,
      current_version: '1.0.0 (Web/Dev)',
      latest_version: '1.0.0',
      release_title: 'Ini Uangku v1.0.0',
      release_notes: 'Mode Web / Preview',
      release_date: new Date().toISOString(),
      html_url: 'https://github.com/asepindrak/ini-uangku-apps/releases',
    };
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<UpdateInfo>('check_app_update');
}

export async function downloadAndInstallUpdate(downloadUrl: string, assetName: string): Promise<string> {
  if (!isTauri) {
    window.open(downloadUrl, '_blank');
    return 'Membuka tautan unduhan di browser...';
  }

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('download_and_install_update', {
    downloadUrl,
    assetName,
  });
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
