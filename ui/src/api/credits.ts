import { api } from './client';
import type { ApiResponse, CreditEntry } from '../types';

// Full balance endpoint - includes history. Used by StatsPanel.
// balance is null when KKCredits itself is unreachable - a real outage, not
// a zero balance. See resolveBalance() in utils/balance.ts.
export async function getBalance(tenant: string) {
  return api.get<ApiResponse<{ balance: number | null; credits_name: string; history: CreditEntry[] }>>(
    `/t/${tenant}/credits/balance`
  );
}

// Lightweight balance endpoint - number only, no history fetch.
// Lightweight balance endpoint - number only, no history fetch.
// Used by the Topbar badge. Skips the external KKCredits history call and
// tenant-config D1 read, so each focus-triggered refresh is just one KV read.
export async function getBalanceOnly(tenant: string) {
  return api.get<ApiResponse<{ balance: number | null }>>(
    `/t/${tenant}/credits/balance-only`
  );
}

