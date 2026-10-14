import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  Plus,
  Search,
  MapPin,
  Menu,
  Shield,
  User,
  Globe,
  LogOut
} from 'lucide-react';
import { Tenant, User as AppUser } from '../types.js';
import { isDemoModeActive, isDemoUser } from '../lib/auth-utils.js';

interface NavbarProps {
  tenants: Tenant[];
  currentTenant: Tenant;
  currentUser?: AppUser | null;
  onSelectTenant: (tenantId: string) => void;
  onSwitchPersona?: (email: string) => void;
  onLogout?: () => void;
  onOpenNewBooking: () => void;
  onOpenPublicPortal?: () => void;
  selectedLocation?: string;
  onSelectLocation?: (loc: string) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onToggleMobileSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  tenants,
  currentTenant,
  currentUser,
  onSelectTenant,
  onSwitchPersona,
  onLogout,
  onOpenNewBooking,
  onOpenPublicPortal,
  selectedLocation = 'ALL',
  onSelectLocation,
  searchQuery = '',
  onSearchChange,
  onToggleMobileSidebar,
}) => {
  const [tenantDropdownOpen, setTenantDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);

  const isDemo = isDemoUser(currentUser);
  const demoModeActive = isDemoModeActive();
  const showDemoPersonaSwitcher = demoModeActive && isDemo;
  const canSwitchTenants = showDemoPersonaSwitcher && tenants.length > 1;

  const DEMO_PERSONAS = !import.meta.env.PROD ? [
    { name: 'Alex Rivera', email: 'alex.rivera@apexrentals.com', role: 'Owner', tenantName: 'Apex Ride & Drive Co.' },
    { name: 'Sarah Chen', email: 'sarah.chen@apexrentals.com', role: 'Manager', tenantName: 'Apex Ride & Drive Co.' },
    { name: 'Jordan Lee', email: 'jordan.lee@apexrentals.com', role: 'Staff', tenantName: 'Apex Ride & Drive Co.' },
    { name: 'Maya Lin', email: 'maya.lin@coastalrentals.com', role: 'Owner', tenantName: 'Coastal Coast & Trail Rentals' }
  ] : [];

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {/* Mobile menu button */}
        {onToggleMobileSidebar && (
          <button
            id="mobile-sidebar-toggle-btn"
            onClick={onToggleMobileSidebar}
            className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}

        {/* Tenant Switcher */}
        <div className="relative flex-shrink-0">
          <button
            id="tenant-switcher-button"
            disabled={!canSwitchTenants}
            onClick={() => {
              if (canSwitchTenants) setTenantDropdownOpen(!tenantDropdownOpen);
            }}
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50/70 text-left max-w-[200px] sm:max-w-[260px] min-w-0 transition-colors ${
              canSwitchTenants ? 'hover:border-slate-300 hover:bg-slate-100/80 cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="w-7 h-7 rounded-md bg-emerald-600 text-white flex-shrink-0 flex items-center justify-center font-bold text-xs shadow-xs">
              {currentTenant.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-800 leading-none truncate max-w-[120px] sm:max-w-[160px]">
                  {currentTenant.name}
                </span>
                <span className="text-[10px] font-medium bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded flex-shrink-0">
                  {canSwitchTenants ? 'Tenant' : 'Business'}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 font-normal block leading-tight truncate max-w-[140px] sm:max-w-[190px] mt-0.5">
                {currentTenant.tagline}
              </span>
            </div>
            {canSwitchTenants && (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1 flex-shrink-0" />
            )}
          </button>

          {canSwitchTenants && tenantDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setTenantDropdownOpen(false)}
              />
              <div className="absolute left-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  Switch Rental Business
                </div>
                {tenants.map(t => (
                  <button
                    key={t.id}
                    id={`tenant-option-${t.id}`}
                    onClick={() => {
                      onSelectTenant(t.id);
                      setTenantDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left flex items-center justify-between hover:bg-slate-50 transition-colors cursor-pointer ${
                      t.id === currentTenant.id ? 'bg-emerald-50/60 font-medium' : ''
                    }`}
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-800">{t.name}</div>
                      <div className="text-[11px] text-slate-500">{t.locations.length} branches • {t.currency}</div>
                    </div>
                    {t.id === currentTenant.id && (
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Location / Branch filter */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100/80 px-2.5 py-1.5 rounded-lg border border-slate-200 flex-shrink-0">
          <MapPin className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          <span className="font-medium text-slate-500">Branch:</span>
          {currentUser && currentUser.role !== 'owner' ? (
            <div className="flex items-center gap-1.5" title={`Assigned branch: ${currentUser.branch || 'None'}`}>
              <span id="location-assigned-display" className="font-semibold text-slate-800 text-xs">
                {currentUser.branch || 'Assigned Branch'}
              </span>
              <span className="text-[10px] bg-slate-200/80 text-slate-700 font-semibold px-1.5 py-0.5 rounded-sm">
                Assigned
              </span>
            </div>
          ) : (
            <select
              id="location-filter-select"
              value={selectedLocation}
              onChange={(e) => onSelectLocation?.(e.target.value)}
              className="bg-transparent font-semibold text-slate-800 text-xs focus:outline-hidden cursor-pointer"
            >
              <option value="ALL">All Branches ({currentTenant.locations.length})</option>
              {currentTenant.locations.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Global Search & Actions */}
      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <div className="relative hidden sm:block w-36 md:w-48 lg:w-56">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="global-search-input"
            type="text"
            placeholder="Search fleet, bookings..."
            value={searchQuery}
            onChange={(e) => onSearchChange?.(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
          />
        </div>

        {/* Customer Portal Link */}
        {onOpenPublicPortal && (
          <button
            id="public-portal-nav-btn"
            onClick={onOpenPublicPortal}
            title="Preview Customer Storefront (/rent/slug)"
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-200 transition-colors cursor-pointer"
          >
            <Globe className="w-3.5 h-3.5 text-emerald-600" />
            <span>Storefront</span>
          </button>
        )}

        {/* Auth User Persona Switcher & RBAC Indicator */}
        <div className="relative flex-shrink-0">
          <button
            id="user-persona-btn"
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-white text-left cursor-pointer transition-colors"
          >
            <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[10px] font-bold">
              {currentUser?.name ? currentUser.name.charAt(0) : 'U'}
            </div>
            <div className="hidden md:block">
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold text-slate-800 leading-tight">
                  {currentUser?.name || 'Staff User'}
                </span>
                <span className={`text-[9px] font-extrabold uppercase px-1 py-0.2 rounded ${
                  currentUser?.role === 'owner' ? 'bg-purple-100 text-purple-700' :
                  currentUser?.role === 'manager' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                }`}>
                  {currentUser?.role || 'staff'}
                </span>
              </div>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {userDropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserDropdownOpen(false)} />
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 animate-in fade-in zoom-in-95">
                {/* Active User Information */}
                <div className="px-3 py-2 border-b border-slate-100 mb-1">
                  <div className="text-xs font-bold text-slate-900 leading-tight">
                    {currentUser?.name || 'User'}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {currentUser?.email || ''}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                      currentUser?.role === 'owner' ? 'bg-purple-100 text-purple-700' :
                      currentUser?.role === 'manager' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {currentUser?.role || 'staff'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium truncate">
                      {currentTenant.name}
                    </span>
                  </div>
                </div>

                {showDemoPersonaSwitcher && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Switch User Role & Persona (Demo Only)
                    </div>
                    {DEMO_PERSONAS.map(p => (
                      <button
                        key={p.email}
                        onClick={() => {
                          onSwitchPersona?.(p.email);
                          setUserDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left hover:bg-slate-50 transition-colors flex items-center justify-between cursor-pointer ${
                          currentUser?.email === p.email ? 'bg-emerald-50/50 font-bold' : ''
                        }`}
                      >
                        <div>
                          <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                            <span>{p.name}</span>
                            <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded ${
                              p.role === 'Owner' ? 'bg-purple-100 text-purple-700' :
                              p.role === 'Manager' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {p.role}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">{p.tenantName}</div>
                        </div>
                      </button>
                    ))}
                  </>
                )}

                {onLogout && (
                  <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                      id="navbar-logout-btn"
                      onClick={() => {
                        setUserDropdownOpen(false);
                        onLogout();
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-600 transition-colors flex items-center gap-2 text-xs font-semibold cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Log Out</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* New Booking Button */}
        <button
          id="new-booking-header-btn"
          onClick={onOpenNewBooking}
          className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all active:scale-98 cursor-pointer flex-shrink-0 whitespace-nowrap"
        >
          <Plus className="w-4 h-4 flex-shrink-0" />
          <span>New Booking</span>
        </button>
      </div>
    </header>
  );
};
