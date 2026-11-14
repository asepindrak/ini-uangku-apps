import { writable } from 'svelte/store';

const initialValue = typeof localStorage !== 'undefined' 
  ? localStorage.getItem('iniuangku_privacy_mode') === 'true' 
  : false;

export const privacyMode = writable<boolean>(initialValue);

privacyMode.subscribe((value) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('iniuangku_privacy_mode', String(value));
  }
});
