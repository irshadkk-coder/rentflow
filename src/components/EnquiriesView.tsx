import React, { useState } from 'react';
import {
  Inbox,
  Search,
  Plus,
  CheckCircle2,
  Clock,
  ArrowRight,
  Mail,
  Phone,
  Calendar,
  DollarSign,
  Car,
  AlertCircle,
  X,
  Filter,
  TrendingUp,
  UserCheck
} from 'lucide-react';
import { Enquiry, EnquiryStatus, Tenant, Vehicle } from '../types.js';
import { formatCurrency, formatDate } from '../lib/utils.js';

interface EnquiriesViewProps {
  tenant: Tenant;
  enquiries: Enquiry[];
  vehicles: Vehicle[];
  onAddEnquiry: (enquiry: Partial<Enquiry>) => Promise<Enquiry>;
  onUpdateEnquiry: (id: string, updates: Partial<Enquiry>) => Promise<Enquiry>;
  onConvertToBooking: (enquiry: Enquiry) => void;
}

export const EnquiriesView: React.FC<EnquiriesViewProps> = ({
  tenant,
  enquiries,
  vehicles,
  onAddEnquiry,
  onUpdateEnquiry,
  onConvertToBooking
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Form State for New Enquiry
  const [newEnquiry, setNewEnquiry] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    vehicleCategory: '',
    preferredVehicleId: '',
    startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
    endDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 16),
    estimatedBudget: '',
    notes: '',
    source: 'direct' as const
  });

  const filteredEnquiries = enquiries.filter(e => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      e.customerName.toLowerCase().includes(q) ||
      e.customerEmail.toLowerCase().includes(q) ||
      e.customerPhone.includes(q) ||
      (e.preferredVehicleName && e.preferredVehicleName.toLowerCase().includes(q)) ||
      (e.notes && e.notes.toLowerCase().includes(q));

    const matchesStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts = {
    all: enquiries.length,
    new: enquiries.filter(e => e.status === 'new').length,
    contacted: enquiries.filter(e => e.status === 'contacted').length,
    quoted: enquiries.filter(e => e.status === 'quoted').length,
    converted: enquiries.filter(e => e.status === 'converted').length,
    lost: enquiries.filter(e => e.status === 'lost').length,
  };

  const handleStatusChange = async (id: string, newStatus: EnquiryStatus) => {
    try {
      await onUpdateEnquiry(id, { status: newStatus });
    } catch (err: any) {
      alert(`Failed to update enquiry: ${err.message}`);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!newEnquiry.customerName.trim() || !newEnquiry.customerEmail.trim()) {
      setFormError('Customer name and email are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const preferredVeh = vehicles.find(v => v.id === newEnquiry.preferredVehicleId);
      await onAddEnquiry({
        customerName: newEnquiry.customerName,
        customerEmail: newEnquiry.customerEmail,
        customerPhone: newEnquiry.customerPhone,
        vehicleCategory: newEnquiry.vehicleCategory || preferredVeh?.category,
        preferredVehicleId: newEnquiry.preferredVehicleId || undefined,
        preferredVehicleName: preferredVeh ? `${preferredVeh.make} ${preferredVeh.model}` : undefined,
        startDate: new Date(newEnquiry.startDate).toISOString(),
        endDate: new Date(newEnquiry.endDate).toISOString(),
        estimatedBudget: newEnquiry.estimatedBudget ? Number(newEnquiry.estimatedBudget) : undefined,
        notes: newEnquiry.notes,
        source: newEnquiry.source
      });
      setIsAddModalOpen(false);
      setNewEnquiry({
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        vehicleCategory: '',
        preferredVehicleId: '',
        startDate: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
        endDate: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 16),
        estimatedBudget: '',
        notes: '',
        source: 'direct'
      });
    } catch (err: any) {
      setFormError(err.message || 'Failed to create enquiry');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: EnquiryStatus) => {
    switch (status) {
      case 'new':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">New Lead</span>;
      case 'contacted':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Contacted</span>;
      case 'quoted':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">Quoted</span>;
      case 'converted':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">Converted</span>;
      case 'lost':
        return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">Lost</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Enquiries & Lead Pipeline (CRM)
            </h1>
            <span className="text-xs font-bold bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full">
              {counts.new} New Leads
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Incoming customer queries, storefront leads, and 1-click booking conversion.
          </p>
        </div>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Record New Enquiry</span>
        </button>
      </div>

      {/* Pipeline Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <button
          onClick={() => setStatusFilter('all')}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === 'all'
              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
              : 'bg-white text-slate-800 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <p className="text-xs font-medium opacity-70">Total Leads</p>
          <p className="text-2xl font-black mt-1">{counts.all}</p>
        </button>

        <button
          onClick={() => setStatusFilter('new')}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === 'new'
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-white text-slate-800 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <p className="text-xs font-medium opacity-70">New / Uncontacted</p>
          <p className="text-2xl font-black mt-1 text-blue-600">{counts.new}</p>
        </button>

        <button
          onClick={() => setStatusFilter('contacted')}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === 'contacted'
              ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
              : 'bg-white text-slate-800 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <p className="text-xs font-medium opacity-70">Contacted</p>
          <p className="text-2xl font-black mt-1 text-amber-600">{counts.contacted}</p>
        </button>

        <button
          onClick={() => setStatusFilter('quoted')}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === 'quoted'
              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
              : 'bg-white text-slate-800 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <p className="text-xs font-medium opacity-70">Quote Sent</p>
          <p className="text-2xl font-black mt-1 text-purple-600">{counts.quoted}</p>
        </button>

        <button
          onClick={() => setStatusFilter('converted')}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === 'converted'
              ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
              : 'bg-white text-slate-800 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <p className="text-xs font-medium opacity-70">Converted Bookings</p>
          <p className="text-2xl font-black mt-1 text-emerald-600">{counts.converted}</p>
        </button>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search leads by name, email, phone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {['all', 'new', 'contacted', 'quoted', 'converted', 'lost'].map(tab => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Enquiries List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {filteredEnquiries.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No enquiries found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              There are no customer leads matching the current filter criteria.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEnquiries.map(enq => (
              <div key={enq.id} className="p-5 hover:bg-slate-50/60 transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-900 text-sm">{enq.customerName}</span>
                    {getStatusBadge(enq.status)}
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                      Via {enq.source} • {formatDate(enq.createdAt)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span className="flex items-center gap-1">
                      <Mail className="w-3.5 h-3.5 text-slate-400" />
                      {enq.customerEmail}
                    </span>
                    {enq.customerPhone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-slate-400" />
                        {enq.customerPhone}
                      </span>
                    )}
                    {(enq.preferredVehicleName || enq.vehicleCategory) && (
                      <span className="flex items-center gap-1 font-medium text-slate-800">
                        <Car className="w-3.5 h-3.5 text-emerald-600" />
                        {enq.preferredVehicleName || enq.vehicleCategory}
                      </span>
                    )}
                    {enq.estimatedBudget && (
                      <span className="flex items-center gap-1 font-semibold text-slate-900">
                        Budget: {formatCurrency(enq.estimatedBudget, tenant.currency)}
                      </span>
                    )}
                  </div>

                  {enq.startDate && enq.endDate && (
                    <div className="flex items-center gap-1 text-[11px] text-slate-500">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>Requested: {formatDate(enq.startDate)} → {formatDate(enq.endDate)}</span>
                    </div>
                  )}

                  {enq.notes && (
                    <p className="text-xs text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100 max-w-2xl">
                      "{enq.notes}"
                    </p>
                  )}
                </div>

                {/* Actions & Conversion */}
                <div className="flex items-center gap-2 self-end lg:self-center shrink-0">
                  <select
                    value={enq.status}
                    onChange={(e) => handleStatusChange(enq.id, e.target.value as EnquiryStatus)}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-hidden"
                  >
                    <option value="new">Mark New</option>
                    <option value="contacted">Mark Contacted</option>
                    <option value="quoted">Mark Quoted</option>
                    <option value="lost">Mark Lost</option>
                    <option value="converted" disabled>Converted</option>
                  </select>

                  {enq.status !== 'converted' ? (
                    <button
                      onClick={() => onConvertToBooking(enq)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs active:scale-[0.98]"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Convert to Booking</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Booking Created
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Enquiry Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Inbox className="w-5 h-5 text-emerald-600" />
                <h3 className="font-extrabold text-slate-900 text-base">Record New Customer Lead</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Jessica Taylor"
                    value={newEnquiry.customerName}
                    onChange={e => setNewEnquiry({ ...newEnquiry, customerName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    placeholder="jessica@example.com"
                    value={newEnquiry.customerEmail}
                    onChange={e => setNewEnquiry({ ...newEnquiry, customerEmail: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={newEnquiry.customerPhone}
                    onChange={e => setNewEnquiry({ ...newEnquiry, customerPhone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Lead Source</label>
                  <select
                    value={newEnquiry.source}
                    onChange={e => setNewEnquiry({ ...newEnquiry, source: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                  >
                    <option value="direct">Direct Walk-in / Phone</option>
                    <option value="website">Public Storefront</option>
                    <option value="phone">Telephone Enquiry</option>
                    <option value="email">Email Outreach</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Interested Vehicle</label>
                <select
                  value={newEnquiry.preferredVehicleId}
                  onChange={e => setNewEnquiry({ ...newEnquiry, preferredVehicleId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                >
                  <option value="">Any available vehicle</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.category} - {formatCurrency(v.dailyRate, tenant.currency)}/day)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Desired Pickup</label>
                  <input
                    type="datetime-local"
                    value={newEnquiry.startDate}
                    onChange={e => setNewEnquiry({ ...newEnquiry, startDate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Desired Return</label>
                  <input
                    type="datetime-local"
                    value={newEnquiry.endDate}
                    onChange={e => setNewEnquiry({ ...newEnquiry, endDate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes / Special Requests</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Needs child seat, wedding weekend rental, corporate client..."
                  value={newEnquiry.notes}
                  onChange={e => setNewEnquiry({ ...newEnquiry, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isSubmitting ? 'Recording...' : 'Create Enquiry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
