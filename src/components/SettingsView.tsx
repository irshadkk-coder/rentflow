import React, { useState, useEffect, useCallback } from 'react';
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
  Users,
  Edit2,
  Phone,
  Navigation,
  ExternalLink,
  Power,
  X,
  AlertCircle,
  Compass
} from 'lucide-react';
import { Tenant, User, Branch } from '../types.js';
import { TeamManagementView } from './TeamManagementView.js';
import { api } from '../lib/api.js';
import { MapLocationPickerModal, SelectedLocationData } from './MapLocationPickerModal.js';
import {
  parseLatitude,
  parseLongitude,
  formatLatitude,
  formatLongitude
} from '../lib/coordinates.js';
import { ErrorBoundary } from './ErrorBoundary.js';

interface SettingsViewProps {
  tenant: Tenant;
  tenants: Tenant[];
  currentUser?: User | null;
  onUpdateTenant: (data: Partial<Tenant>) => Promise<void>;
  onResetData: () => Promise<void>;
  showToast?: (_msg: string) => void;
  showErrorToast?: (_msg: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  tenant,
  tenants,
  currentUser,
  onUpdateTenant,
  onResetData,
  showToast = (_msg: string) => {},
  showErrorToast = (_msg: string) => {},
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

  // Branch management state
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchFormSubmitting, setBranchFormSubmitting] = useState(false);
  const [branchFormErrors, setBranchFormErrors] = useState<Record<string, string>>({});
  const [branchForm, setBranchForm] = useState({
    name: '',
    address: '',
    city: '',
    pincode: '',
    latitude: '',
    longitude: '',
    phone: '',
    is_active: true
  });

  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Interactive Map Picker modal state
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false);

  const handleMapLocationConfirm = (loc: SelectedLocationData) => {
    setBranchForm(prev => ({
      ...prev,
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      ...(loc.address && !prev.address.trim() ? { address: loc.address } : {}),
      ...(loc.city && !prev.city.trim() ? { city: loc.city } : {}),
      ...(loc.pincode && !prev.pincode.trim() ? { pincode: loc.pincode } : {})
    }));

    setBranchFormErrors(prev => {
      const next = { ...prev };
      delete next.latitude;
      delete next.longitude;
      return next;
    });

    const latFormatted = formatLatitude(loc.latitude, 4);
    const lngFormatted = formatLongitude(loc.longitude, 4);
    if (latFormatted && lngFormatted) {
      showToast(`Coordinates selected from map: ${latFormatted}, ${lngFormatted}`);
    } else {
      showToast('Coordinates selected from map.');
    }
  };

  const fetchBranches = useCallback(async () => {
    try {
      setIsLoadingBranches(true);
      const data = await api.getBranches();
      if (Array.isArray(data)) {
        setBranches(data);
        if (data.length > 0) {
          // Sync locations array with active branches
          setLocations(data.filter(b => (b.isActive ?? b.is_active ?? true)).map(b => b.name));
        }
      }
    } catch (err) {
      console.warn('Could not load rich branch records, falling back to tenant settings:', err);
    } finally {
      setIsLoadingBranches(false);
    }
  }, []);

  useEffect(() => {
    fetchBranches();
  }, [fetchBranches, tenant.id]);

  const handleOpenAddBranch = () => {
    setEditingBranch(null);
    setBranchForm({
      name: '',
      address: '',
      city: '',
      pincode: '',
      latitude: '',
      longitude: '',
      phone: phone || '',
      is_active: true
    });
    setBranchFormErrors({});
    setIsBranchModalOpen(true);
  };

  const handleOpenEditBranch = (branch: Branch) => {
    setEditingBranch(branch);
    const parsedLat = parseLatitude(branch.latitude);
    const parsedLng = parseLongitude(branch.longitude);
    setBranchForm({
      name: branch.name,
      address: branch.address,
      city: branch.city,
      pincode: branch.pincode,
      latitude: parsedLat !== null ? String(parsedLat) : (branch.latitude != null ? String(branch.latitude) : ''),
      longitude: parsedLng !== null ? String(parsedLng) : (branch.longitude != null ? String(branch.longitude) : ''),
      phone: branch.phone || branch.contactNumber || '',
      is_active: branch.isActive ?? branch.is_active ?? true
    });
    setBranchFormErrors({});
    setIsBranchModalOpen(true);
  };

  const validateBranchForm = () => {
    const errors: Record<string, string> = {};
    if (!branchForm.name.trim()) errors.name = 'Branch name is required';
    if (!branchForm.address.trim()) errors.address = 'Street address is required';
    if (!branchForm.city.trim()) errors.city = 'City is required';
    if (!branchForm.pincode.trim()) errors.pincode = 'Pincode / Postal code is required';

    const lat = parseLatitude(branchForm.latitude);
    if (lat === null) {
      errors.latitude = 'Latitude must be a valid number between -90 and 90';
    }

    const lng = parseLongitude(branchForm.longitude);
    if (lng === null) {
      errors.longitude = 'Longitude must be a valid number between -180 and 180';
    }

    if (!branchForm.phone.trim()) errors.phone = 'Contact number is required';

    setBranchFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateBranchForm()) return;

    setBranchFormSubmitting(true);
    try {
      const validLat = parseLatitude(branchForm.latitude);
      const validLng = parseLongitude(branchForm.longitude);

      const payload: Partial<Branch> = {
        name: branchForm.name.trim(),
        address: branchForm.address.trim(),
        city: branchForm.city.trim(),
        pincode: branchForm.pincode.trim(),
        latitude: validLat !== null ? validLat : parseFloat(branchForm.latitude),
        longitude: validLng !== null ? validLng : parseFloat(branchForm.longitude),
        phone: branchForm.phone.trim(),
        isActive: branchForm.is_active,
        is_active: branchForm.is_active
      };

      if (editingBranch) {
        await api.updateBranch(editingBranch.id, payload);
        showToast('Branch updated successfully');
      } else {
        await api.createBranch(payload);
        showToast('Branch created successfully');
      }

      setIsBranchModalOpen(false);
      await fetchBranches();
    } catch (err: any) {
      const msg = err.message || err.response?.data?.error || 'Failed to save branch';
      showErrorToast(msg);
    } finally {
      setBranchFormSubmitting(false);
    }
  };

  const handleToggleBranchActive = async (branch: Branch) => {
    try {
      const currentActive = branch.isActive ?? branch.is_active ?? true;
      const newStatus = !currentActive;
      await api.updateBranch(branch.id, { isActive: newStatus, is_active: newStatus });
      showToast(`Branch "${branch.name}" ${newStatus ? 'activated' : 'deactivated'}`);
      await fetchBranches();
    } catch (err: any) {
      const msg = err.message || 'Failed to change branch status';
      showErrorToast(msg);
    }
  };

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

        {/* Station Locations & Hubs (Branch Management) */}
        <ErrorBoundary fallbackTitle="Station Locations & Branches" fallbackMessage="Could not render station locations. Other business settings remain available.">
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <MapPin className="w-4 h-4 text-emerald-600" />
                  <span>Station Locations & Branches</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage physical rental hubs, geographic coordinates for customer proximity search, and active operating status.
                </p>
              </div>

              {isOwner && (
                <button
                  type="button"
                  id="add-branch-modal-btn"
                  onClick={handleOpenAddBranch}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer self-start sm:self-auto"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Branch</span>
                </button>
              )}
            </div>

            {isLoadingBranches ? (
              <div className="p-6 text-center text-xs text-slate-400">Loading branches...</div>
            ) : branches.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                {branches.map((b) => {
                  const isActive = b.isActive ?? b.is_active ?? true;
                  return (
                    <div
                      key={b.id}
                      className={`p-3.5 rounded-xl border transition-all ${
                        isActive
                          ? 'bg-slate-50/70 border-slate-200 hover:border-emerald-300'
                          : 'bg-slate-100/50 border-slate-200/70 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs truncate">{b.name}</span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                                isActive
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-600' : 'bg-slate-400'}`} />
                              {isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1 line-clamp-1">{b.address}</p>
                          <p className="text-[11px] text-slate-500">
                            {b.city}{b.pincode ? `, ${b.pincode}` : ''}
                          </p>
                        </div>

                        {isOwner && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenEditBranch(b)}
                              title="Edit Branch"
                              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-white rounded-lg border border-transparent hover:border-slate-200 transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleBranchActive(b)}
                              title={isActive ? 'Deactivate Branch' : 'Activate Branch'}
                              className={`p-1.5 rounded-lg border border-transparent transition-colors ${
                                isActive
                                  ? 'text-slate-500 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200'
                                  : 'text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 hover:border-emerald-200'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] text-slate-500">
                      <div className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>{b.phone || b.contactNumber || 'No phone'}</span>
                      </div>

                      {(() => {
                        const latStr = formatLatitude(b.latitude, 4);
                        const lngStr = formatLongitude(b.longitude, 4);
                        if (latStr !== null && lngStr !== null) {
                          return (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${latStr},${lngStr}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-700 hover:underline"
                            >
                              <Navigation className="w-3 h-3 text-emerald-600" />
                              <span>{latStr}, {lngStr}</span>
                              <ExternalLink className="w-2.5 h-2.5 opacity-70" />
                            </a>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400 italic">
                            <MapPin className="w-3 h-3 text-slate-300" />
                            <span>Coordinates unconfigured</span>
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
              </div>
            ) : (
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
            )}
          </div>
        </ErrorBoundary>

        {/* Add / Edit Branch Modal Dialog */}
        {isBranchModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      {editingBranch ? 'Edit Rental Branch' : 'Create New Rental Branch'}
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Configure branch coordinates, address, and contact details
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsBranchModalOpen(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveBranch} className="space-y-4 pt-4 text-xs">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Branch Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={branchForm.name}
                    onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                    placeholder="e.g. Downtown Harbor Hub"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                    required
                  />
                  {branchFormErrors.name && (
                    <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.name}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      City <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={branchForm.city}
                      onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })}
                      placeholder="e.g. San Francisco"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                      required
                    />
                    {branchFormErrors.city && (
                      <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.city}</p>
                    )}
                  </div>

                  <div>
                    <label className="font-bold text-slate-700 block mb-1">
                      Pincode / Postal Code <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={branchForm.pincode}
                      onChange={(e) => setBranchForm({ ...branchForm, pincode: e.target.value })}
                      placeholder="e.g. 94105"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                      required
                    />
                    {branchFormErrors.pincode && (
                      <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.pincode}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Street Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={branchForm.address}
                    onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
                    placeholder="e.g. 101 Embarcadero Blvd"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                    required
                  />
                  {branchFormErrors.address && (
                    <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.address}</p>
                  )}
                </div>

                {/* Map Picker Trigger Action */}
                <div className="bg-emerald-50/70 border border-emerald-200/90 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <Compass className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-xs">Pinpoint Location on Map</p>
                      <p className="text-[11px] text-slate-500">
                        Search places or click &amp; drag marker on OpenStreetMap to auto-populate coordinates.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    id="select-location-on-map-btn"
                    onClick={() => setIsMapPickerOpen(true)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs cursor-pointer shrink-0"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Select Location on Map</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700 block">
                        Latitude (-90 to 90) <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[10px] text-slate-400 font-normal">Manual fallback</span>
                    </div>
                    <input
                      type="number"
                      step="any"
                      value={branchForm.latitude}
                      onChange={(e) => setBranchForm({ ...branchForm, latitude: e.target.value })}
                      placeholder="e.g. 37.7937"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                      required
                    />
                    {branchFormErrors.latitude && (
                      <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.latitude}</p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-bold text-slate-700 block">
                        Longitude (-180 to 180) <span className="text-rose-500">*</span>
                      </label>
                      <span className="text-[10px] text-slate-400 font-normal">Manual fallback</span>
                    </div>
                    <input
                      type="number"
                      step="any"
                      value={branchForm.longitude}
                      onChange={(e) => setBranchForm({ ...branchForm, longitude: e.target.value })}
                      placeholder="e.g. -122.3965"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                      required
                    />
                    {branchFormErrors.longitude && (
                      <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.longitude}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="font-bold text-slate-700 block mb-1">
                    Contact Phone Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={branchForm.phone}
                    onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                    placeholder="e.g. +1-415-555-0199"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:bg-white focus:border-emerald-500 focus:outline-hidden"
                    required
                  />
                  {branchFormErrors.phone && (
                    <p className="text-[11px] text-rose-600 mt-1">{branchFormErrors.phone}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="branch-active-toggle"
                    checked={branchForm.is_active}
                    onChange={(e) => setBranchForm({ ...branchForm, is_active: e.target.checked })}
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="branch-active-toggle" className="font-bold text-slate-700 cursor-pointer">
                    Branch is Active for Customer Bookings & Nearby Search
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsBranchModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={branchFormSubmitting}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl font-bold shadow-xs transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{branchFormSubmitting ? 'Saving...' : editingBranch ? 'Update Branch' : 'Create Branch'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Interactive OpenStreetMap Location Picker Modal */}
        <MapLocationPickerModal
          isOpen={isMapPickerOpen}
          onClose={() => setIsMapPickerOpen(false)}
          onConfirm={handleMapLocationConfirm}
          initialLat={parseLatitude(branchForm.latitude) ?? undefined}
          initialLng={parseLongitude(branchForm.longitude) ?? undefined}
          initialAddress={branchForm.address || branchForm.city || undefined}
          branchName={branchForm.name || undefined}
        />

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
