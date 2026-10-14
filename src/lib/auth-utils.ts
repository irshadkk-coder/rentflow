import { User } from '../types.js';

export const DEMO_USER_EMAILS: string[] = !import.meta.env.PROD ? [
  'alex.rivera@apexrentals.com',
  'sarah.chen@apexrentals.com',
  'jordan.lee@apexrentals.com',
  'maya.lin@coastalrentals.com',
  'marcus.vance@metrocarshare.com'
] : [];

/**
 * Checks whether a given user object or email belongs to the predefined demo accounts.
 */
export const isDemoUser = (user?: User | { email?: string; isDemo?: boolean } | null): boolean => {
  if (!user || import.meta.env.PROD) return false;
  if (user.isDemo !== undefined) return Boolean(user.isDemo);
  if (!user.email) return false;
  return DEMO_USER_EMAILS.includes(user.email.toLowerCase());
};

/**
 * Checks whether Demo Mode is enabled based on environment and build configuration.
 * - In production builds (Vite PROD mode), demo persona switching is strictly disabled.
 * - In development, it is active unless explicitly turned off via VITE_ENABLE_DEMO_MODE=false.
 */
export const isDemoModeActive = (): boolean => {
  if (import.meta.env.PROD) return false;
  if (import.meta.env.VITE_ENABLE_DEMO_MODE === 'false' || import.meta.env.VITE_ENABLE_DEMO_MODE === '0') {
    return false;
  }
  return true;
};
