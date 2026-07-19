// בחירת חשבון סליקה לבקשה: מפורש > יחיד > דורש בחירה
export function pickAccount<T extends { provider: string }>(
  accounts: T[], requested?: string | null,
): { account?: T; error?: 'no_active_provider' | 'provider_required' } {
  if (requested) {
    const account = accounts.find((a) => a.provider === requested)
    return account ? { account } : { error: 'no_active_provider' }
  }
  if (accounts.length === 0) return { error: 'no_active_provider' }
  if (accounts.length > 1) return { error: 'provider_required' }
  return { account: accounts[0] }
}
