import React, { useState } from 'react';
import {
  Key,
  CheckCircle2,
  AlertCircle,
  Gauge,
  Fuel,
  BatteryCharging,
  FileCheck,
  UserCheck,
  ShieldAlert
} from 'lucide-react';
import { Rental, Tenant, User } from '../types.js';
import { formatCurrency, formatDateTime } from '../lib/utils.js';

interface CheckOutModalProps {
  tenant: Tenant;
  rental: Rental;
  currentUser?: User | null;
  onClose: () => void;
  onConfirmCheckOut: (rentalId: string, inspectionData: any) => Promise<void>;
}

export const CheckOutModal: React.FC<CheckOutModalProps> = ({
  tenant,
  rental,
  currentUser,
  onClose,
  onConfirmCheckOut,
}) => {
  const [odometer, setOdometer] = useState<number>(14200);
  const [fuelOrBattery, setFuelOrBattery] = useState<number>(100);
  const [damagesNote, setDamagesNote] = useState<string>('Clean condition. No prior body or mechanical defects noted.');
  const [agentName, setAgentName] = useState<string>(
    currentUser ? `${currentUser.name} (${currentUser.role})` : 'Operations Staff'
  );
  const [customerSignatureName, setCustomerSignatureName] = useState<string>(rental.customerName);
  const [signedByCustomer, setSignedByCustomer] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Checkboxes
  const [keysHanded, setKeysHanded] = useState(true);
  const [docsVerified, setDocsVerified] = useState(true);
  const [walkaroundDone, setWalkaroundDone] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!signedByCustomer || !keysHanded || !docsVerified) {
      setErrorMessage('Please complete all verification checkboxes (key handover, license verification, and inspection) before departing.');
      return;
    }
    if (odometer < 0) {
      setErrorMessage('Odometer cannot be negative.');
      return;
    }
    if (fuelOrBattery < 0 || fuelOrBattery > 100) {
      setErrorMessage('Fuel or battery percentage must be between 0% and 100%.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirmCheckOut(rental.id, {
        departureOdometer: odometer,
        odometer,
        departureFuelOrBattery: fuelOrBattery,
        fuelOrBattery,
        existingDamages: damagesNote ? [damagesNote] : [],
        signedByCustomer: true,
        customerSignatureName,
        agentName,
        date: new Date().toISOString(),
        notes: 'Handover completed at station. Customer briefed on emergency support.'
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete check out.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-emerald-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Vehicle Handover & Check-Out</h2>
              <p className="text-xs text-slate-500">Departure inspection and digital agreement</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Renter & Vehicle strip */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Customer</span>
              <span className="text-xs font-bold text-slate-800">{rental.customerName}</span>
              <span className="text-[11px] text-slate-500 block">{rental.customerPhone}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Vehicle</span>
              <span className="text-xs font-bold text-slate-800">{rental.vehicleName}</span>
              <span className="text-[10px] font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                {rental.vehiclePlate}
              </span>
            </div>
          </div>

          {/* Handover & Financial Info */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Scheduled Pickup</span>
              <span className="font-semibold text-slate-800">{formatDateTime(rental.startDate)}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Payment Status</span>
              <span className={`inline-block font-extrabold uppercase text-[10px] px-2 py-0.5 rounded-full ${
                rental.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {rental.paymentStatus}
              </span>
              <span className="block text-[11px] font-mono text-slate-600 mt-0.5">
                Balance: {formatCurrency(rental.balanceDue ?? (rental.totalAmount - (rental.paidAmount ?? 0)), tenant.currency)}
              </span>
            </div>
          </div>

          {/* Outstanding Balance Warning */}
          {(rental.balanceDue ?? (rental.totalAmount - (rental.paidAmount ?? 0))) > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 flex-shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span className="font-bold">Handover with Unpaid Balance:</span>
                <p className="text-[11px] text-amber-800 mt-0.5">
                  This reservation has an outstanding balance of{' '}
                  <span className="font-mono font-bold">
                    {formatCurrency(rental.balanceDue ?? (rental.totalAmount - (rental.paidAmount ?? 0)), tenant.currency)}
                  </span>
                  . Authorized staff may proceed with vehicle handover. This action and balance are recorded in audit logs.
                </p>
              </div>
            </div>
          )}

          {/* Odometer & Fuel / Battery */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Departure Odometer (Miles)
              </label>
              <div className="relative">
                <Gauge className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  value={odometer}
                  onChange={(e) => setOdometer(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Departure Fuel / Charge (%)
              </label>
              <div className="relative">
                <Fuel className="w-4 h-4 text-amber-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={fuelOrBattery}
                  onChange={(e) => setFuelOrBattery(Number(e.target.value))}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                  required
                />
              </div>
            </div>
          </div>

          {/* Pre-existing condition inspection */}
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">
              Pre-Existing Condition & Damages Notes
            </label>
            <textarea
              rows={2}
              value={damagesNote}
              onChange={(e) => setDamagesNote(e.target.value)}
              placeholder="Note any preexisting scratches, chips or wear..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800"
            />
          </div>

          {/* Handover protocol checklist */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Handover Verification Checklist</span>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={docsVerified}
                onChange={(e) => setDocsVerified(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300"
              />
              <span>Driver's license verified & contract terms acknowledged</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={walkaroundDone}
                onChange={(e) => setWalkaroundDone(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300"
              />
              <span>Joint physical walkaround inspection completed</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={keysHanded}
                onChange={(e) => setKeysHanded(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300"
              />
              <span>Keys, helmets, and vehicle accessories handed to renter</span>
            </label>
          </div>

          {/* Digital Signature & Staff Acknowledgement */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Staff Agent</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 block mb-1">Customer Signature (Typed)</label>
              <input
                type="text"
                value={customerSignatureName}
                onChange={(e) => setCustomerSignatureName(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-serif italic"
                required
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Processing...' : 'Complete Handover'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
