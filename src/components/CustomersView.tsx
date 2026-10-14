import React, { useState } from 'react';
import {
  Users,
  Search,
  Plus,
  ShieldCheck,
  Star,
  Mail,
  Phone,
  CreditCard,
  CalendarCheck,
  UserCheck,
  Edit2
} from 'lucide-react';
import { Customer, Tenant, Rental } from '../types.js';
import { formatCurrency, formatDate } from '../lib/utils.js';

interface CustomersViewProps {
  tenant: Tenant;
  customers: Customer[];
  rentals: Rental[];
  onAddCustomer: (customer: Partial<Customer>) => Promise<Customer>;
  onSelectCustomerRentals?: (customer: Customer) => void;
}

export const CustomersView: React.FC<CustomersViewProps> = ({
  tenant,
  customers,
  rentals,
  onAddCustomer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedCustomerForDetails, setSelectedCustomerForDetails] = useState<Customer | null>(null);

  const filteredCustomers = customers.filter(c => {
    const q = searchQuery.toLowerCase();
    return c.name.toLowerCase().includes(q) ||
           c.email.toLowerCase().includes(q) ||
           c.phone.includes(q) ||
           c.driverLicense.number.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Customer Directory (CRM)
            </h1>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {customers.length} Renters
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Verified driver profiles, ID verification, lifetime spend, and rental history records.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Customer</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer name, email, phone or driver's license #..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* Customer Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredCustomers.map((customer) => {
          const custRentals = rentals.filter(r => r.customerId === customer.id);
          return (
            <div
              key={customer.id}
              className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between"
            >
              <div>
                {/* Top Row: Avatar, Name, Status */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 text-white font-extrabold text-sm flex items-center justify-center shadow-xs">
                      {customer.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{customer.name}</h3>
                        {customer.status === 'vip' && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                            VIP
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-amber-500 text-xs mt-0.5">
                        <Star className="w-3.5 h-3.5 fill-amber-400" />
                        <span className="font-bold text-slate-700">{customer.rating.toFixed(1)}</span>
                        <span className="text-slate-400 text-[10px] ml-1">
                          ({customer.totalRentals} Completed Trips)
                        </span>
                      </div>
                    </div>
                  </div>

                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    Verified ID
                  </span>
                </div>

                {/* Contact details */}
                <div className="space-y-1.5 text-xs text-slate-600 py-3 border-y border-slate-100">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span>{customer.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{customer.phone}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono text-[11px]">
                      License: {customer.driverLicense.number} ({customer.driverLicense.stateOrCountry})
                    </span>
                  </div>
                </div>

                {/* Notes if any */}
                {customer.notes && (
                  <p className="text-[11px] text-slate-500 italic mt-3 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    "{customer.notes}"
                  </p>
                )}
              </div>

              {/* Financial stats footer */}
              <div className="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Lifetime Spend</span>
                  <span className="text-sm font-extrabold text-slate-900">
                    {formatCurrency(customer.totalSpent, tenant.currency)}
                  </span>
                </div>

                <button
                  onClick={() => setSelectedCustomerForDetails(customer)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  View Trips ({custRentals.length})
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Customer Trips History Modal */}
      {selectedCustomerForDetails && (
        <CustomerDetailsModal
          customer={selectedCustomerForDetails}
          tenant={tenant}
          rentals={rentals.filter(r => r.customerId === selectedCustomerForDetails.id)}
          onClose={() => setSelectedCustomerForDetails(null)}
        />
      )}

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <AddCustomerModal
          tenant={tenant}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={async (c) => {
            await onAddCustomer(c);
            setIsAddModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

interface AddCustomerModalProps {
  tenant: Tenant;
  onClose: () => void;
  onAdd: (cust: Partial<Customer>) => Promise<Customer>;
}

const AddCustomerModal: React.FC<AddCustomerModalProps> = ({ tenant, onClose, onAdd }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseState, setLicenseState] = useState('California, US');
  const [licenseExpiry, setLicenseExpiry] = useState('2028-06-30');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onAdd({
        tenantId: tenant.id,
        name,
        email,
        phone,
        address,
        driverLicense: {
          number: licenseNumber,
          stateOrCountry: licenseState,
          expiryDate: licenseExpiry,
          verified: true
        },
        notes,
        rating: 5.0,
        status: 'active'
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Add New Customer</h3>
            <p className="text-xs text-slate-500">Register verified driver and contact details</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-bold">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Phone Number</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (415) 555-0199"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">Driver's License #</label>
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="D7721890"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">License State / Country</label>
              <input
                type="text"
                value={licenseState}
                onChange={(e) => setLicenseState(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">License Expiry Date</label>
              <input
                type="date"
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Residential Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Ocean View Ave, San Francisco, CA"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">Internal Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="VIP client preferences, corporate affiliation..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const CustomerDetailsModal: React.FC<{ customer: Customer; tenant: Tenant; rentals: Rental[]; onClose: () => void }> = ({
  customer,
  tenant,
  rentals,
  onClose
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base font-bold text-slate-900">{customer.name} — Rental History</h3>
            <p className="text-xs text-slate-500">{customer.email} • {customer.phone}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg font-bold">✕</button>
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto space-y-4">
          <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-center text-xs">
            <div>
              <span className="text-[10px] text-slate-400 block font-bold uppercase">Trips</span>
              <span className="text-base font-extrabold text-slate-800">{customer.totalRentals}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-bold uppercase">Total Spend</span>
              <span className="text-base font-extrabold text-emerald-600">
                {formatCurrency(customer.totalSpent, tenant.currency)}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block font-bold uppercase">License #</span>
              <span className="text-xs font-mono font-bold text-slate-800">{customer.driverLicense.number}</span>
            </div>
          </div>

          <h4 className="text-xs font-bold text-slate-800">Past & Active Reservations</h4>
          {rentals.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No rental records on file for this customer yet.</p>
          ) : (
            <div className="space-y-2">
              {rentals.map(r => (
                <div key={r.id} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-slate-900">{r.vehicleName}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatDate(r.startDate)} - {formatDate(r.endDate)} • {r.rentalNumber}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-800 block">{formatCurrency(r.totalAmount, tenant.currency)}</span>
                    <span className="text-[10px] font-semibold uppercase text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                      {r.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
