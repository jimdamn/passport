export function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 86400) return 'Today';
  if (diff < 172800) return 'Yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}

// Accepts either unix seconds (this app's own tables) or the
// "YYYY-MM-DD HH:MM:SS" UTC string KKCredits' ledger returns (its history
// rows carry no timezone marker, so a bare `new Date(str)` would be parsed
// as local time and skew by hours - force UTC by converting to ISO first).
export function formatDate(value: number | string): string {
  const date = typeof value === 'number'
    ? new Date(value * 1000)
    : new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
