export const CURRENCY = 'INR';
export const LOCALE = 'en-IN';
export const CURRENCY_SYMBOL = '₹';

export function formatCurrency(amount: number | string | undefined | null, _currency?: string): string {
  if (amount === undefined || amount === null || amount === '') {
    return `${CURRENCY_SYMBOL}0`;
  }
  const numericAmount = typeof amount === 'number' ? amount : Number(amount);
  if (isNaN(numericAmount)) {
    return `${CURRENCY_SYMBOL}0`;
  }
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: Number.isInteger(numericAmount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
}

export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(dateString || '');
  }
}

export function formatDateTime(dateString: string | undefined | null): string {
  if (!dateString) return '';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return String(dateString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(dateString || '');
  }
}

export function calculateDaysBetween(startDate: string, endDate: string): number {
  try {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    const diffHours = (end - start) / (1000 * 60 * 60);
    const days = Math.max(1, Math.ceil(diffHours / 24));
    return days;
  } catch {
    return 1;
  }
}

export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
