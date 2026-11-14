export type UserRole = 'MANAGER' | 'MEMBER';
export type WalletType = 'BANK' | 'E_WALLET' | 'CASH' | 'INVESTMENT';
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'SINKING_FUND_ALLOCATION';

export interface User {
  id: string;
  familyId: string;
  name: string;
  email?: string;
  role: UserRole;
  countryCode: string;
  whatsappNumber?: string;
  telegramChatId?: string;
  avatarUrl?: string;
}

export interface Family {
  id: string;
  name: string;
  inviteCode: string;
  managerId: string;
}

export interface Wallet {
  id: string;
  name: string;
  type: WalletType;
  accountNumber?: string;
  balance: number;
  colorCode?: string;
  isShared: boolean;
  userId?: string;
  userName?: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  type: TransactionType;
  monthlyBudget?: number;
  alertThreshold: number;
}

export interface Transaction {
  id: string;
  walletId: string;
  walletName?: string;
  categoryId?: string;
  categoryName?: string;
  categoryColor?: string;
  userId?: string;
  userName?: string;
  type: TransactionType;
  amount: number;
  description: string;
  transactionDate: string;
  inputSource: string;
  rawMediaUrl?: string;
}

export interface SinkingFund {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  monthlyAlloc: number;
  sourceWalletId: string;
  sourceWalletName?: string;
  isActive: boolean;
  lastAllocatedAt?: string;
}

export interface FamilyAsset {
  id: string;
  name: string;
  type: string;
  acquisitionCost: number;
  currentValue: number;
  notes?: string;
}

export interface FamilyDebt {
  id: string;
  name: string;
  principalAmount: number;
  remainingAmount: number;
  monthlyPayment: number;
  dueDayOfMonth: number;
  totalTenorMonth: number;
  remainingTenor: number;
  isActive: boolean;
}

export interface PendingAction {
  id: string;
  actionType: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  proposedPayload: any;
  summaryText: string;
  expiresAt: string;
  createdAt: string;
  userName?: string;
}

export interface BotStatus {
  whatsappConnected: boolean;
  whatsappQr?: string;
  telegramConnected: boolean;
  globalTelegramBotRunning?: boolean;
  globalTelegramBotUsername?: string | null;
  familyTelegramConfigured?: boolean;
  familyTelegramUsername?: string | null;
  isFamilyBotRunning?: boolean;
  whitelistCount: number;
}

export interface TelegramWhitelistItem {
  id: string;
  familyId: string;
  platform: string;
  identifier: string;
  name: string;
  canRecord: boolean;
  canViewReports: boolean;
  createdAt: string;
}

export interface TelegramConfigResponse {
  globalBotRunning?: boolean;
  globalBotUsername?: string | null;
  configured: boolean;
  token: string;
  username: string | null;
  isRunning: boolean;
  familyName?: string;
  whitelists: TelegramWhitelistItem[];
  memberUsers: {
    id: string;
    name: string;
    telegramChatId: string;
    role: string;
  }[];
}

export interface LLMConfig {
  activeProvider: 'gemini' | 'openai' | 'claude' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  modelName: string;
  temperature: number;
}
