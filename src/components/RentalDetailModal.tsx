import React, { useState } from 'react';
import {
  Key,
  Calendar,
  MapPin,
  Clock,
  ShieldCheck,
  DollarSign,
  FileText,
  Printer,
  CheckCircle2,
  AlertCircle,
  Car,
  User as UserIcon,
  Fuel,
  Gauge,
  CreditCard,
  Plus,
  ShieldAlert,
  CheckSquare,
  AlertTriangle
} from 'lucide-react';
import { Rental, Tenant, User } from '../types.js';
import { formatCurrency, formatDateTime } from '../lib/utils.js';

interface RentalDetailModalProps {
  rental: Rental;
  tenant: Tenant;
  currentUser?: User | null;
  onClose: () => void;
  onCheckOut?: (r: Rental) => void;
  onCheckIn?: (r: Rental) => void;
  onRecordPayment?: (rentalId: string, amount: number, method: string, reference?: string, notes?: string) => Promise<void>;
}

export const RentalDetailModal: React.FC<RentalDetailModalProps> = ({
  rental,
  tenant,
  currentUser,
  onClose,
  onCheckOut,
  onCheckIn,
  onRecordPayment,
}) => {
  const isOverdue = rental.status === 'active' && new Date(rental.endDate).getTime() < Date.now();
  const currentBalance = rental.balanceDue !== undefined
    ? rental.balanceDue
    : Math.max(0, rental.totalAmount - (rental.paidAmount ?? 0));
  const currentPaid = rental.paidAmount !== undefined
    ? rental.paidAmount
    : Math.max(0, rental.totalAmount - currentBalance);

  // Manual payment modal state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [payAmount, setPayAmount] = useState<number>(currentBalance > 0 ? currentBalance : 0);
  const [payMethod, setPayMethod] = useState<string>('Cash');
  const [payReference, setPayReference] = useState<string>(`MAN-${Date.now().toString().slice(-6)}`);
  const [payNotes, setPayNotes] = useState<string>('Manual in-person collection at desk');
  const [isSubmittingPay, setIsSubmittingPay] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);
    setPaymentSuccess(null);

    if (payAmount <= 0) {
      setPaymentError('Payment amount must be greater than zero.');
      return;
    }
    if (payAmount > currentBalance) {
      setPaymentError(`Payment amount cannot exceed remaining balance of ${formatCurrency(currentBalance, tenant.currency)}.`);
      return;
    }
    if (!onRecordPayment) {
      setPaymentError('Payment recording is not supported in this view.');
      return;
    }

    setIsSubmittingPay(true);
    try {
      await onRecordPayment(rental.id, payAmount, payMethod, payReference, payNotes);
      setPaymentSuccess(`Successfully recorded payment of ${formatCurrency(payAmount, tenant.currency)}.`);
      setIsPaymentModalOpen(false);
    } catch (err: any) {
      setPaymentError(err.message || 'Failed to record payment.');
    } finally {
      setIsSubmittingPay(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-sm font-extrabold text-emerald-400">
              {rental.rentalNumber}
            </span>
            <span className="text-slate-400 text-xs">• Rental Agreement & Lifecycle</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Agreement</span>
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer">✕</button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-800">
          {/* Status banner */}
          <div className={`p-4 rounded-xl flex items-center justify-between ${
            isOverdue
              ? 'bg-rose-50 border border-rose-200 text-rose-900'
              : rental.status === 'active'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                : rental.status === 'completed'
                  ? 'bg-slate-100 border border-slate-200 text-slate-800'
                  : 'bg-blue-50 border border-blue-200 text-blue-900'
          }`}>
            <div className="flex items-center gap-2">
              {rental.status === 'active' ? <Key className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              <div>
                <span className="font-bold text-xs uppercase block">
                  Booking Status: {isOverdue ? 'Overdue Return' : rental.status}
                </span>
                <span className="text-[11px] opacity-80">
                  {rental.status === 'confirmed' ? 'Awaiting customer arrival for handover' : rental.status === 'active' ? 'Vehicle is currently out on rental' : 'Rental successfully concluded and vehicle checked in'}
                </span>
              </div>
            </div>

            {/* Quick Actions in banner */}
            <div className="flex items-center gap-2">
              {rental.status === 'confirmed' && onCheckOut && (
                <button
                  id="modal-action-checkout-btn"
                  onClick={() => {
                    onClose();
                    onCheckOut(rental);
                  }}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Mark as Picked Up</span>
                </button>
              )}

              {rental.status === 'active' && onCheckIn && (
                <button
                  id="modal-action-checkin-btn"
                  onClick={() => {
                    onClose();
                    onCheckIn(rental);
                  }}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Mark as Returned</span>
                </button>
              )}
            </div>
          </div>

          {/* Lifecycle & Verification Status Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* 1. Booking Status */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Rental Lifecycle</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                rental.status === 'active' ? 'bg-emerald-100 text-emerald-800' :
                rental.status === 'confirmed' ? 'bg-blue-100 text-blue-800' :
                rental.status === 'completed' ? 'bg-slate-200 text-slate-800' : 'bg-rose-100 text-rose-800'
              }`}>
                {rental.status}
              </span>
            </div>

            {/* 2. Payment Status */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Payment Status</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                rental.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                rental.paymentStatus === 'partial' ? 'bg-amber-100 text-amber-800' :
                'bg-rose-100 text-rose-800'
              }`}>
                <DollarSign className="w-2.5 h-2.5" />
                {rental.paymentStatus === 'partial' ? 'Partially Paid' : rental.paymentStatus}
              </span>
            </div>

            {/* 3. Pickup Status */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Pickup Status</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                rental.checkOutInspection || rental.status === 'active' || rental.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}>
                {rental.checkOutInspection || rental.status === 'active' || rental.status === 'completed' ? (
                  <>
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                    <span>Picked Up</span>
                  </>
                ) : (
                  <>
                    <Clock className="w-2.5 h-2.5 text-amber-600" />
                    <span>Awaiting Pickup</span>
                  </>
                )}
              </span>
            </div>

            {/* 4. Return Status */}
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Return Status</span>
              <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                rental.checkInInspection || rental.status === 'completed'
                  ? 'bg-blue-100 text-blue-800'
                  : rental.status === 'active'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-700'
              }`}>
                {rental.checkInInspection || rental.status === 'completed' ? (
                  <>
                    <ShieldCheck className="w-2.5 h-2.5 text-blue-600" />
                    <span>Returned & Checked In</span>
                  </>
                ) : rental.status === 'active' ? (
                  <>
                    <Key className="w-2.5 h-2.5 text-emerald-600" />
                    <span>Active On Road</span>
                  </>
                ) : (
                  <span>Scheduled</span>
                )}
              </span>
            </div>
          </div>

          {/* Outstanding Balance Banner with Record Payment Action */}
          <div className="p-4 bg-slate-900 text-white rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Rental Billing & Balance Tracker
              </span>
              <div className="flex items-center gap-4 text-xs">
                <div>
                  <span className="text-slate-400 text-[10px] block">Total Amount</span>
                  <span className="font-mono font-bold text-sm text-white">
                    {formatCurrency(rental.totalAmount, tenant.currency)}
                  </span>
                </div>
                <div className="border-l border-slate-800 pl-4">
                  <span className="text-slate-400 text-[10px] block">Amount Paid</span>
                  <span className="font-mono font-bold text-sm text-emerald-400">
                    {formatCurrency(currentPaid, tenant.currency)}
                  </span>
                </div>
                <div className="border-l border-slate-800 pl-4">
                  <span className="text-slate-400 text-[10px] block">Outstanding Balance</span>
                  <span className={`font-mono font-extrabold text-sm ${currentBalance > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {formatCurrency(currentBalance, tenant.currency)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-auto">
              {currentBalance > 0 ? (
                <button
                  id="btn-record-payment"
                  onClick={() => {
                    setPayAmount(currentBalance);
                    setIsPaymentModalOpen(true);
                  }}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  <DollarSign className="w-3.5 h-3.5" />
                  <span>Record Payment</span>
                </button>
              ) : (
                <span className="px-3 py-1.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-bold rounded-xl text-xs flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Fully Paid</span>
                </span>
              )}
            </div>
          </div>

          {/* Pickup with Unpaid Balance Warning Notice (Phase 3 requirement) */}
          {rental.status === 'confirmed' && currentBalance > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Pickup Payment Notice:</span>
                <span className="text-[11px] text-amber-800 leading-relaxed block">
                  This reservation has an outstanding balance of <span className="font-mono font-bold">{formatCurrency(currentBalance, tenant.currency)}</span>.
                  Handover before full payment is permitted per operational policy. The pickup action and outstanding balance will be recorded in audit logs.
                </span>
              </div>
            </div>
          )}

          {/* Inline Payment Recording Modal / Dialog */}
          {isPaymentModalOpen && (
            <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-emerald-900">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                  <span>Record Manual Payment</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                >
                  ✕ Cancel
                </button>
              </div>

              {paymentError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{paymentError}</span>
                </div>
              )}

              <form onSubmit={handlePaymentSubmit} className="space-y-3 pt-1">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Payment Amount ({tenant.currency})
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={currentBalance}
                      value={payAmount}
                      onChange={(e) => setPayAmount(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono font-bold text-xs"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Payment Method
                    </label>
                    <select
                      value={payMethod}
                      onChange={(e) => setPayMethod(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Card Terminal">Card Terminal (In-Person)</option>
                      <option value="Credit Card">Credit Card</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-700 block mb-1">
                      Transaction Ref #
                    </label>
                    <input
                      type="text"
                      value={payReference}
                      onChange={(e) => setPayReference(e.target.value)}
                      placeholder="e.g. REC-12345"
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-700 block mb-1">
                    Payment Notes & Staff Attribution
                  </label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Staff notes on transaction..."
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    Recording Staff: <span className="font-semibold">{currentUser ? `${currentUser.name} (${currentUser.role})` : 'Authorized Staff'}</span>
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsPaymentModalOpen(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPay}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    {isSubmittingPay ? 'Recording...' : 'Confirm & Save Payment'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Payment History Section */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Payment History & Receipts
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {(rental.paymentHistory || []).length} Transaction(s)
              </span>
            </div>

            {(rental.paymentHistory && rental.paymentHistory.length > 0) ? (
              <div className="space-y-1.5 pt-1">
                {rental.paymentHistory.map((p) => (
                  <div key={p.id} className="p-2.5 bg-white rounded-xl border border-slate-200/80 flex items-center justify-between text-xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{p.method}</span>
                        <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                          {p.reference}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {formatDateTime(p.date)} {p.staffName ? `• Handled by ${p.staffName}` : ''} {p.notes ? `• ${p.notes}` : ''}
                      </div>
                    </div>
                    <span className="font-mono font-extrabold text-emerald-600">
                      {formatCurrency(p.amount, tenant.currency)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 bg-white rounded-xl border border-slate-200 text-center text-slate-400 text-xs italic">
                No payments recorded yet. Remaining balance of {formatCurrency(currentBalance, tenant.currency)} is pending.
              </div>
            )}
          </div>

          {/* Renter & Vehicle 2-col info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Customer Box */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Renter Profile</span>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>ID & License Verified</span>
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900">{rental.customerName}</div>
              <div className="text-slate-600 text-[11px]">{rental.customerEmail}</div>
              <div className="text-slate-600 text-[11px]">{rental.customerPhone}</div>
            </div>

            {/* Vehicle Box */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center gap-3">
              <img
                src={rental.vehicleImage}
                alt={rental.vehicleName}
                className="w-20 h-16 object-cover rounded-lg border border-slate-200 flex-shrink-0"
              />
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">{rental.vehicleType}</span>
                <div className="text-sm font-bold text-slate-900">{rental.vehicleName}</div>
                <div className="font-mono text-xs font-bold text-slate-600 mt-1">{rental.vehiclePlate}</div>
              </div>
            </div>
          </div>

          {/* Dates & Pickup/Dropoff */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Pickup Departure</span>
              <div className="font-bold text-slate-900 text-xs">{formatDateTime(rental.startDate)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{rental.pickupLocation}</div>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Scheduled Return</span>
              <div className="font-bold text-slate-900 text-xs">{formatDateTime(rental.endDate)}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{rental.dropoffLocation}</div>
            </div>
          </div>

          {/* Departure Inspection Log */}
          {rental.checkOutInspection && (
            <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-200/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Departure Handover Inspection Record</span>
                </span>
                <span className="text-[10px] text-slate-500">
                  {formatDateTime(rental.checkOutInspection.date)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                <div>
                  <span className="text-[10px] text-slate-500 block">Departure Odometer</span>
                  <span className="font-mono font-bold">{(rental.checkOutInspection.odometer ?? 0).toLocaleString()} mi</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Departure Fuel/Charge</span>
                  <span className="font-mono font-bold">{rental.checkOutInspection.fuelOrBattery}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Agent In-Charge</span>
                  <span className="font-medium">{rental.checkOutInspection.agentName}</span>
                </div>
              </div>
              {rental.checkOutInspection.existingDamages && rental.checkOutInspection.existingDamages.length > 0 && (
                <div className="text-[11px] text-slate-600 pt-1">
                  <span className="font-semibold">Condition notes: </span>
                  {rental.checkOutInspection.existingDamages.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Return Inspection Log */}
          {rental.checkInInspection && (
            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-200/80 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-blue-600" />
                  <span>Return Inspection & Settlement</span>
                </span>
                <span className="text-[10px] text-slate-500">
                  {formatDateTime(rental.checkInInspection.date)}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                <div>
                  <span className="text-[10px] text-slate-500 block">Return Odometer</span>
                  <span className="font-mono font-bold">{(rental.checkInInspection.returnOdometer ?? 0).toLocaleString()} mi</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Return Fuel/Charge</span>
                  <span className="font-mono font-bold">{rental.checkInInspection.returnFuelOrBattery}%</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">Deposit Settlement</span>
                  <span className="font-mono font-bold text-emerald-600">
                    {formatCurrency(rental.checkInInspection.refundedDeposit, tenant.currency)}
                  </span>
                </div>
              </div>
              {rental.checkInInspection.notes && (
                <div className="text-[11px] text-slate-600 pt-1">
                  <span className="font-semibold">Settlement notes: </span>
                  {rental.checkInInspection.notes}
                </div>
              )}
            </div>
          )}

          {/* Financial Breakdown */}
          <div className="p-4 bg-slate-900 text-white rounded-xl space-y-2">
            <span className="text-[10px] font-bold uppercase text-slate-400 block mb-1">Financial Billing Summary</span>
            <div className="flex justify-between text-slate-300">
              <span>Base Vehicle Hire ({rental.durationUnits} {rental.rentalRateType === 'hourly' ? 'Hours' : 'Days'} @ {formatCurrency(rental.rateAmount, tenant.currency)})</span>
              <span className="font-mono">{formatCurrency(rental.basePrice, tenant.currency)}</span>
            </div>
            {rental.insuranceOption && rental.insuranceOption.total > 0 && (
              <div className="flex justify-between text-slate-300">
                <span>{rental.insuranceOption.name}</span>
                <span className="font-mono">{formatCurrency(rental.insuranceOption.total, tenant.currency)}</span>
              </div>
            )}
            {rental.addOns.map((a, i) => (
              <div key={i} className="flex justify-between text-slate-300">
                <span>{a.name}</span>
                <span className="font-mono">{formatCurrency(a.price, tenant.currency)}</span>
              </div>
            ))}
            <div className="flex justify-between text-slate-300">
              <span>Sales Tax ({tenant.taxRate}%)</span>
              <span className="font-mono">{formatCurrency(rental.tax, tenant.currency)}</span>
            </div>
            <div className="pt-2 border-t border-slate-800 flex justify-between font-extrabold text-sm">
              <span className="text-slate-100">Total Rental Cost:</span>
              <span className="text-emerald-400 font-mono">{formatCurrency(rental.totalAmount, tenant.currency)}</span>
            </div>
            <div className="pt-1 flex justify-between text-[11px] text-amber-400">
              <span>Security Deposit:</span>
              <span className="font-mono">{formatCurrency(rental.depositAmount, tenant.currency)} ({rental.depositStatus})</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
