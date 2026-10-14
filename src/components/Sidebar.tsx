import React from 'react';
import {
  LayoutDashboard,
  Car,
  CalendarCheck,
  CalendarDays,
  Users,
  Receipt,
  Wrench,
  Settings,
  KeyRound,
  ShieldCheck,
  Globe,
  Inbox,
  ScrollText,
  LogOut
} from 'lucide-react';
import { User } from '../types.js';

export type NavTab =
  | 'dashboard'
  | 'fleet'
  | 'rentals'
  | 'timeline'
  | 'customers'
  | 'enquiries'
  | 'invoices'
  | 'maintenance'
  | 'audit-logs'
  | 'settings'
  | 'public-portal';

interface SidebarProps {
  currentTab?: NavTab | string;
  activeTab?: string;
  currentUser?: User | null;
  onSelectTab: (tab: NavTab) => void;
  onLogout?: () => void;
  activeRentalsCount?: number;
  activeTripsCount?: number;
  maintenanceCount?: number;
  overdueCount?: number;
  enquiriesCount?: number;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  activeTab,
  currentUser,
  onSelectTab,
  onLogout,
  activeRentalsCount,
  activeTripsCount,
  maintenanceCount = 0,
  overdueCount = 0,
  enquiriesCount = 0,
  isMobileOpen = false,
  onCloseMobile,
}) => {
  const selectedTab = (currentTab || activeTab || 'dashboard') as NavTab;
  const rentalsBadge = activeRentalsCount ?? activeTripsCount ?? 0;

  const navItems: { id: NavTab; label: string; icon: React.FC<{ className?: string }>; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'fleet', label: 'Fleet & Inventory', icon: Car },
    { id: 'rentals', label: 'Bookings & Rentals', icon: CalendarCheck, badge: rentalsBadge },
    { id: 'timeline', label: 'Fleet Timeline', icon: CalendarDays },
    { id: 'customers', label: 'Customers', icon: Users },
    { id: 'enquiries', label: 'Leads & Enquiries', icon: Inbox, badge: enquiriesCount },
    { id: 'invoices', label: 'Invoices & Billing', icon: Receipt },
    { id: 'maintenance', label: 'Maintenance Logs', icon: Wrench, badge: maintenanceCount },
    { id: 'audit-logs', label: 'Audit Trail', icon: ScrollText },
    { id: 'settings', label: 'Business Settings', icon: Settings },
    { id: 'public-portal', label: 'Customer Storefront', icon: Globe },
  ];

  const userInitials = currentUser?.name
    ? currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'OP';

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside className={`w-64 bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 h-screen sticky top-0 border-r border-slate-800 select-none z-50 transition-transform duration-200 ${
        isMobileOpen ? 'fixed inset-y-0 left-0 translate-x-0' : 'hidden lg:flex'
      }`}>
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center text-white shadow-md shadow-emerald-950/40">
              <KeyRound className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-extrabold text-white tracking-tight font-display">
                  RENTFLOW
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
                  SaaS
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Multi-Tenant Rental Ops</p>
            </div>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden text-slate-400 hover:text-white p-1 text-sm font-bold"
            >
              ✕
            </button>
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Operations
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = selectedTab === item.id;
            return (
              <button
                key={item.id}
                id={`sidebar-nav-${item.id}`}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm font-bold'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-800 text-emerald-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Multi-Tenant Security Badge */}
        <div className="p-4 mx-3 mb-4 rounded-xl bg-slate-800/70 border border-slate-700/60 text-xs text-slate-300">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Multi-Tenant Isolated</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Strict JWT tenant scoping, automated conflict locks & canonical pricing active.
          </p>
        </div>

        {/* Footer User Profile (Dynamic, No Hardcoded MG) */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-emerald-700 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
              {userInitials}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-200 truncate">
                {currentUser?.name || 'Staff User'}
              </div>
              <div className="text-[11px] text-emerald-400 font-medium capitalize flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>{currentUser?.role || 'staff'} • Active</span>
              </div>
            </div>
          </div>
          {onLogout && (
            <button
              id="sidebar-logout-btn"
              onClick={onLogout}
              title="Log Out of RentFlow"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>
    </>
  );
};
