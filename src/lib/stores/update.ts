import { writable } from 'svelte/store';

export interface UpdateInfo {
  has_update: boolean;
  current_version: string;
  latest_version: string;
  release_title: string;
  release_notes: string;
  release_date: string;
  download_url?: string | null;
  asset_name?: string | null;
  asset_size?: number | null;
  html_url: string;
}

export const updateInfo = writable<UpdateInfo | null>(null);
export const updateModalOpen = writable<boolean>(false);
export const updateDownloading = writable<boolean>(false);
export const updateProgress = writable<number>(0);
export const updateStatusMessage = writable<string>('');
export const updateErrorMessage = writable<string>('');
export const updateChecking = writable<boolean>(false);
