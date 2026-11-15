const DEFAULT_SERVER_URL = import.meta.env.DEV
  ? 'https://iniuangku.raydrop.web.id'
  : 'https://iniuangku.raydrop.web.id';

export function getServerUrl(): string {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem('iniuangku_server_url') || DEFAULT_SERVER_URL;
  }
  return DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('iniuangku_server_url', url.replace(/\/$/, ''));
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getServerUrl();
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('iniuangku_token') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: 'Terjadi kesalahan pada server.' }));
    throw new Error(errorData.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  register: (data: any) => request<any>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: any) => request<any>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: () => request<any>('/api/auth/me'),
  updateMyProfile: (data: any) => request<any>('/api/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),

  // Family
  getMembers: () => request<any[]>('/api/family/members'),
  addMember: (data: any) => request<any>('/api/family/members', { method: 'POST', body: JSON.stringify(data) }),
  deleteMember: (id: string) => request<any>(`/api/family/members/${id}`, { method: 'DELETE' }),
  getInvite: () => request<{ inviteCode: string; inviteUrl: string; familyName: string }>('/api/family/invite'),
  getFamilyProfile: () => request<any>('/api/family/profile'),
  updateFamilyTimezone: (timezone: string) => request<any>('/api/family/timezone', { method: 'PATCH', body: JSON.stringify({ timezone }) }),

  // Wallets
  getWallets: () => request<any[]>('/api/wallets'),
  createWallet: (data: any) => request<any>('/api/wallets', { method: 'POST', body: JSON.stringify(data) }),
  updateWallet: (id: string, data: any) => request<any>(`/api/wallets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWallet: (id: string) => request<any>(`/api/wallets/${id}`, { method: 'DELETE' }),

  // Transactions
  getTransactions: (params: string = '') => request<any[]>(`/api/transactions${params}`),
  getSummary: () => request<any>('/api/transactions/summary'),
  getAnalytics: (params: string = '') => request<any>(`/api/transactions/analytics${params ? '?' + params : ''}`),
  getFinancialReport: (params: string = '') => request<any>(`/api/transactions/report${params ? '?' + params : ''}`),
  createTransaction: (data: any) => request<any>('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
  deleteTransaction: (id: string) => request<any>(`/api/transactions/${id}`, { method: 'DELETE' }),
  getPendingActions: () => request<any[]>('/api/transactions/pending'),
  respondPendingAction: (id: string, approved: boolean) =>
    request<any>(`/api/transactions/pending/${id}/respond`, { method: 'POST', body: JSON.stringify({ approved }) }),

  // Sinking Funds
  getSinkingFunds: () => request<any[]>('/api/sinking-funds'),
  createSinkingFund: (data: any) => request<any>('/api/sinking-funds', { method: 'POST', body: JSON.stringify(data) }),
  deleteSinkingFund: (id: string) => request<any>(`/api/sinking-funds/${id}`, { method: 'DELETE' }),

  // Assets & Debts
  getNetWorth: () => request<any>('/api/assets-debts/net-worth'),
  getAssets: () => request<any[]>('/api/assets-debts/assets'),
  createAsset: (data: any) => request<any>('/api/assets-debts/assets', { method: 'POST', body: JSON.stringify(data) }),
  getDebts: () => request<any[]>('/api/assets-debts/debts'),
  createDebt: (data: any) => request<any>('/api/assets-debts/debts', { method: 'POST', body: JSON.stringify(data) }),

  // Bot & LLM
  getBotStatus: () => request<any>('/api/bot/status'),
  restartWhatsApp: () => request<any>('/api/bot/restart-whatsapp', { method: 'POST' }),
  getTelegramConfig: () => request<any>('/api/bot/telegram-config'),
  updateTelegramConfig: (data: { botToken: string }) => request<any>('/api/bot/telegram-config', { method: 'PUT', body: JSON.stringify(data) }),
  deleteTelegramConfig: () => request<any>('/api/bot/telegram-config', { method: 'DELETE' }),
  addTelegramWhitelist: (data: { identifier: string; name: string }) => request<any>('/api/bot/telegram-whitelist', { method: 'POST', body: JSON.stringify(data) }),
  deleteTelegramWhitelist: (id: string) => request<any>(`/api/bot/telegram-whitelist/${id}`, { method: 'DELETE' }),
  getLLMConfig: () => request<any>('/api/llm/config'),
  updateLLMConfig: (data: any) => request<any>('/api/llm/config', { method: 'PUT', body: JSON.stringify(data) }),
  testLLMConnection: (data: any) => request<any>('/api/llm/test', { method: 'POST', body: JSON.stringify(data) }),
};
