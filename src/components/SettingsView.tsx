import React, { useState } from 'react';
import {
  Building2,
  MapPin,
  IndianRupee,
  Percent,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  Building,
  Users
} from 'lucide-react';
import { Tenant, User } from '../types.js';
import { TeamManagementView } from './TeamManagementView.js';

interface SettingsViewProps {
  tenant: Tenant;
  tenants: Tenant[];
  currentUser?: User | null;
  onUpdateTenant: (data: Partial<Tenant>) => Promise<void>;
  onResetData: () => Promise<void>;
  showToast?: (msg: string) => void;
  showErrorToast?: (msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  tenant,
  tenants,
  currentUser,
  onUpdateTenant,
  onResetData,
  showToast = () => {},
  showErrorToast = () => {},
}) => {
  const isOwner = currentUser?.role === 'owner';
  const isManagerOrOwner = currentUser?.role === 'owner' || currentUser?.role === 'manager';
  const [activeSubTab, setActiveSubTab] = useState<'business' | 'team'>('business');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [name, setName] = useState(tenant.name);
  const [tagline, setTagline] = useState(tenant.tagline);
  const [email, setEmail] = useState(tenant.email);
  const [phone, setPhone] = useState(tenant.phone);
  const [address, setAddress] = useState(tenant.address);
  const [taxId, setTaxId] = useState(tenant.taxId);
  const [currency, setCurrency] = useState(tenant.currency);
  const [taxRate, setTaxRate] = useState(tenant.taxRate);
  const [securityDepositDefault, setSecurityDepositDefault] = useState(tenant.securityDepositDefault);
  const [lateFeePerHour, setLateFeePerHour] = useState(tenant.lateFeePerHour);
  const [locations, setLocations] = useState<string[]>(tenant.locations);
  const [newLocation, setNewLocation] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleAddLocation = () => {
    if (!newLocation.trim()) return;
    setLocations([...locations, newLocation.trim()]);
    setNewLocation('');
  };

  const handleRemoveLocation = (index: number) => {
    setLocations(locations.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedSuccess(false);
    try {
      await onUpdateTenant({
        name,
        tagline,
        email,
        phone,
        address,
        taxId,
        currency,
        taxRate: Number(taxRate),
        securityDepositDefault: Number(securityDepositDefault),
        lateFeePerHour: Number(lateFeePerHour),
        locations
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Navigation Sub-Tabs (Owner can toggle between Business & Team Management) */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveSubTab('business')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
            activeSubTab === 'business'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Business & Branch Settings</span>
        </button>

        {isOwner && (
          <button
            type="button"
            id="team-management-tab-btn"
            onClick={() => setActiveSubTab('team')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeSubTab === 'team'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Team Management</span>
          </button>
        )}
      </div>

      {activeSubTab === 'team' && isOwner ? (
        <TeamManagementView
          tenant={tenant}
          currentUser={currentUser}
          showToast={showToast}
          showErrorToast={showErrorToast}
        />
      ) : (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
            <div>
              <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Tenant & Branch Settings
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Configure multi-tenant branding, tax policies, security deposits, and rental stations.
              </p>
            </div>

            {savedSuccess && (
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Settings saved successfully!</span>
              </div>
            )}
          </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Company Profile Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <span>Company Branding & Contact Details</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Company / Branch Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Tagline / Business Description</label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Billing Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Customer Support Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="font-bold text-slate-700 block mb-1">Headquarters Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Tax ID / Business Registration #</label>
              <input
                type="text"
                value={taxId}
                onChange={(e) => setTaxId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
              />
            </div>
          </div>
        </div>

        {/* Financial & Rental Policies */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <IndianRupee className="w-4 h-4 text-emerald-600" />
            <span>Financial Policies, Deposits & Taxes</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="font-bold text-slate-700 block mb-1">Operating Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
              >
                <option value="INR">INR (₹ - Indian Rupee)</option>
                <option value="USD">USD ($ - US Dollar)</option>
                <option value="EUR">EUR (€ - Euro)</option>
                <option value="GBP">GBP (£ - British Pound)</option>
                <option value="CAD">CAD ($ - Canadian Dollar)</option>
                <option value="AUD">AUD ($ - Australian Dollar)</option>
              </select>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Default Sales Tax Rate (%)</label>
              <input
                type="number"
                step="0.1"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                required
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Default Security Deposit Hold</label>
              <input
                type="number"
                value={securityDepositDefault}
                onChange={(e) => setSecurityDepositDefault(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                required
              />
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">Late Return Fee (₹/Hour)</label>
              <input
                type="number"
                value={lateFeePerHour}
                onChange={(e) => setLateFeePerHour(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                required
              />
            </div>
          </div>
        </div>

        {/* Pickup & Dropoff Stations */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <MapPin className="w-4 h-4 text-emerald-600" />
            <span>Station Locations & Hubs</span>
          </div>

          <div className="space-y-2">
            {locations.map((loc, idx) => (
              <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                <span className="font-semibold text-slate-800">{loc}</span>
                {locations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveLocation(idx)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="e.g. Marina District Station or Pier 39 Depot..."
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              />
              <button
                type="button"
                onClick={handleAddLocation}
                className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>Add Station</span>
              </button>
            </div>
          </div>
        </div>

        {/* Save & Reset Controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-2">
          {isOwner ? (
            <div>
              {showResetConfirm ? (
                <div className="flex items-center gap-2 bg-rose-50 p-2 rounded-xl border border-rose-200">
                  <span className="text-xs text-rose-700 font-semibold">Confirm database reset?</span>
                  <button
                    type="button"
                    onClick={async () => {
                      setShowResetConfirm(false);
                      await onResetData();
                    }}
                    className="px-2.5 py-1 bg-rose-600 text-white text-xs font-bold rounded-lg cursor-pointer hover:bg-rose-700"
                  >
                    Yes, Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    className="px-2.5 py-1 bg-white border border-slate-200 text-slate-700 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  id="reset-db-btn"
                  onClick={() => setShowResetConfirm(true)}
                  className="px-4 py-2 text-rose-600 hover:bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Demo Database to Initial Seeds</span>
                </button>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400 italic">
              * Database reset and tax modifications restricted to Owner role ({currentUser?.role || 'staff'}).
            </div>
          )}

          <button
            type="submit"
            disabled={isSaving || !isManagerOrOwner}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving Changes...' : 'Save All Settings'}</span>
          </button>
        </div>
      </form>
      </>
      )}
    </div>
  );
};
