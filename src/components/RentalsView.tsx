import React, { useState } from 'react';
import {
  Plus,
  Search,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  FileText,
  DollarSign,
  UserCheck,
  Key,
  Eye,
  ShieldCheck,
  CheckSquare
} from 'lucide-react';
import { Rental, RentalStatus, Tenant } from '../types.js';
import { formatCurrency, formatDate, formatDateTime } from '../lib/utils.js';

interface RentalsViewProps {
  tenant: Tenant;
  rentals: Rental[];
  initialStatusFilter?: string;
  onOpenNewBooking: () => void;
  onOpenCheckOut: (r: Rental) => void;
  onOpenCheckIn: (r: Rental) => void;
  onViewRentalDetails: (r: Rental) => void;
  onRecordPayment?: (r: Rental) => void;
}

export const RentalsView: React.FC<RentalsViewProps> = ({
  tenant,
  rentals,
  initialStatusFilter = 'ALL',
  onOpenNewBooking,
  onOpenCheckOut,
  onOpenCheckIn,
  onViewRentalDetails,
  onRecordPayment,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>(initialStatusFilter);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRentals = rentals.filter((r) => {
    const isOverdue = r.status === 'active' && new Date(r.endDate).getTime() < Date.now();

    let matchesStatus = true;
    if (statusFilter === 'overdue') {
      matchesStatus = isOverdue;
    } else if (statusFilter !== 'ALL') {
      matchesStatus = r.status === statusFilter;
    }

    const q = searchQuery.toLowerCase();
    const matchesSearch =
      r.rentalNumber.toLowerCase().includes(q) ||
      r.customerName.toLowerCase().includes(q) ||
      r.vehicleName.toLowerCase().includes(q) ||
      r.vehiclePlate.toLowerCase().includes(q);

    return matchesStatus && matchesSearch;
  });

  const getStatusBadge = (r: Rental) => {
    const isOverdue = r.status === 'active' && new Date(r.endDate).getTime() < Date.now();
    if (isOverdue) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800">
          <AlertCircle className="w-3 h-3" />
          Overdue Return
        </span>
      );
    }
    switch (r.status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
            <Key className="w-3 h-3" />
            Active Trip
          </span>
        );
      case 'confirmed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
            <Clock className="w-3 h-3" />
            Confirmed (Awaiting Pickup)
          </span>
        );
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
            <CheckCircle2 className="w-3 h-3" />
            Completed & Returned
          </span>
        );
      case 'cancelled':
        return (
          <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-400">
            Cancelled
          </span>
        );
      default:
        return null;
    }
  };

  const overdueCount = rentals.filter(r => r.status === 'active' && new Date(r.endDate).getTime() < Date.now()).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Bookings & Rental Agreements
            </h1>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {rentals.length} Total
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Track active rentals, perform digital check-out handovers, and process returns with condition inspection.
          </p>
        </div>

        <button
          id="rentals-new-booking-btn"
          onClick={onOpenNewBooking}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>New Reservation</span>
        </button>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by customer, rental #, vehicle or plate..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Quick status tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {[
              { id: 'ALL', label: 'All Rentals' },
              { id: 'active', label: 'Active Trips' },
              { id: 'confirmed', label: 'Upcoming / Pickup' },
              { id: 'completed', label: 'Completed' },
              ...(overdueCount > 0 ? [{ id: 'overdue', label: `Overdue (${overdueCount})` }] : [])
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  statusFilter === tab.id
                    ? tab.id === 'overdue'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'bg-slate-900 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rentals List */}
      {filteredRentals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-800">No rental records found</h3>
          <p className="text-xs text-slate-500 mt-1">
            There are no bookings matching your selected status filter.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRentals.map((rental) => {
            const isOverdue = rental.status === 'active' && new Date(rental.endDate).getTime() < Date.now();
            return (
              <div
                key={rental.id}
                className={`bg-white rounded-2xl border p-5 shadow-xs transition-all hover:border-slate-300 ${
                  isOverdue ? 'border-rose-200 bg-rose-50/20' : 'border-slate-200/80'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Vehicle & Customer Info */}
                  <div className="flex items-start gap-4">
                    <img
                      src={rental.vehicleImage}
                      alt={rental.vehicleName}
                      className="w-20 h-16 object-cover rounded-xl border border-slate-200 shadow-2xs flex-shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs font-extrabold text-slate-900">
                          {rental.rentalNumber}
                        </span>
                        {getStatusBadge(rental)}
                        <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono">
                          {rental.vehiclePlate}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-800">
                        {rental.vehicleName}
                      </h3>

                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-slate-700">{rental.customerName}</span>
                        <span>•</span>
                        <span>{rental.customerPhone}</span>
                      </div>
                    </div>
                  </div>

                  {/* Dates & Locations */}
                  <div className="grid grid-cols-2 gap-4 text-xs py-2 lg:py-0 border-y lg:border-y-0 lg:border-x border-slate-100 lg:px-6">
                    <div>
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        Departure / Pickup
                      </span>
                      <span className="font-bold text-slate-800 block">
                        {formatDateTime(rental.startDate)}
                      </span>
                      <span className="text-[11px] text-slate-500">{rental.pickupLocation}</span>
                    </div>

                    <div>
                      <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                        Return / Due
                      </span>
                      <span className={`font-bold block ${isOverdue ? 'text-rose-600' : 'text-slate-800'}`}>
                        {formatDateTime(rental.endDate)}
                      </span>
                      <span className="text-[11px] text-slate-500">{rental.dropoffLocation}</span>
                    </div>
                  </div>

                  {/* Financials & Action Buttons */}
                  <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between gap-3 flex-shrink-0">
                    <div className="text-left sm:text-right">
                      <div className="text-base font-extrabold text-slate-900">
                        {formatCurrency(rental.totalAmount, tenant.currency)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {(rental.balanceDue ?? 0) > 0 ? (
                          <span className="text-amber-700 font-bold">
                            Due: {formatCurrency(rental.balanceDue ?? 0, tenant.currency)}
                          </span>
                        ) : (
                          <span className="text-emerald-700 font-bold">Paid</span>
                        )}
                        <span className="mx-1">•</span>
                        <span>Deposit: {formatCurrency(rental.depositAmount, tenant.currency)}</span>
                      </div>
                    </div>

                    {/* Dynamic Action Buttons */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onViewRentalDetails(rental)}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        Details
                      </button>

                      {(rental.balanceDue ?? 0) > 0 && onRecordPayment && (
                        <button
                          id={`action-pay-${rental.id}`}
                          onClick={() => onRecordPayment(rental)}
                          className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                          title="Record Manual Payment"
                        >
                          <DollarSign className="w-3 h-3 text-emerald-600" />
                          <span>Pay</span>
                        </button>
                      )}

                      {rental.status === 'confirmed' && (
                        <button
                          id={`action-checkout-${rental.id}`}
                          onClick={() => onOpenCheckOut(rental)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <Key className="w-3.5 h-3.5" />
                          <span>Handover & Check-Out</span>
                        </button>
                      )}

                      {rental.status === 'active' && (
                        <button
                          id={`action-checkin-${rental.id}`}
                          onClick={() => onOpenCheckIn(rental)}
                          className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Process Return</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inspection Checklist Status strip */}
                {(rental.checkOutInspection || rental.checkInInspection) && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <div className="flex items-center gap-4 flex-wrap">
                      {rental.checkOutInspection && (
                        <span className="flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          Check-Out verified ({rental.checkOutInspection.odometer} mi, {rental.checkOutInspection.fuelOrBattery}% fuel)
                        </span>
                      )}
                      {rental.checkInInspection && (
                        <span className="flex items-center gap-1 text-blue-700 font-medium">
                          <ShieldCheck className="w-3 h-3 text-blue-600" />
                          Return check-in completed ({rental.checkInInspection.returnOdometer} mi)
                        </span>
                      )}
                    </div>

                    <span className="text-slate-400">
                      Payment: <span className="font-semibold uppercase text-slate-700">{rental.paymentStatus}</span> ({rental.paymentMethod.replace('_', ' ')})
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
