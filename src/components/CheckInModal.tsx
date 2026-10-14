import React, { useState, useMemo } from 'react';
import {
  CheckSquare,
  CheckCircle2,
  AlertTriangle,
  Gauge,
  Fuel,
  DollarSign,
  ShieldCheck,
  Clock,
  ArrowDown
} from 'lucide-react';
import { Rental, Tenant, User } from '../types.js';
import { formatCurrency, formatDateTime } from '../lib/utils.js';

interface CheckInModalProps {
  tenant: Tenant;
  rental: Rental;
  currentUser?: User | null;
  onClose: () => void;
  onConfirmCheckIn: (rentalId: string, inspectionData: any) => Promise<void>;
}

export const CheckInModal: React.FC<CheckInModalProps> = ({
  tenant,
  rental,
  currentUser,
  onClose,
  onConfirmCheckIn,
}) => {
  const initialOdo = rental.checkOutInspection?.odometer || 14200;
  const initialFuel = rental.checkOutInspection?.fuelOrBattery || 100;

  const [returnOdometer, setReturnOdometer] = useState<number>(initialOdo + 85);
  const [returnFuel, setReturnFuel] = useState<number>(initialFuel);
  const [hasDamages, setHasDamages] = useState<boolean>(false);
  const [damageFee, setDamageFee] = useState<number>(0);
  const [damageNotes, setDamageNotes] = useState<string>('');
  const [agentName, setAgentName] = useState<string>(
    currentUser ? `${currentUser.name} (${currentUser.role})` : 'Operations Staff'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Overdue check
  const isOverdue = new Date(rental.endDate).getTime() < Date.now();
  const overdueHours = useMemo(() => {
    if (!isOverdue) return 0;
    const diffMs = Date.now() - new Date(rental.endDate).getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
  }, [rental.endDate, isOverdue]);

  const [lateFee, setLateFee] = useState<number>(isOverdue ? overdueHours * tenant.lateFeePerHour : 0);

  // Dynamic fuel shortfall surcharge based on tenant settings
  const fuelSurcharge = useMemo(() => {
    if (returnFuel >= initialFuel) return 0;
    const diffPct = initialFuel - returnFuel;
    const penaltyRate = tenant.fuelPenaltyPerPercent || 0.85;
    return Math.round(diffPct * penaltyRate * 100) / 100;
  }, [returnFuel, initialFuel, tenant.fuelPenaltyPerPercent]);

  // Miles traveled
  const milesDriven = Math.max(0, returnOdometer - initialOdo);

  // Deposit settlement math
  const initialDeposit = rental.depositAmount;
  const totalDeductions = (hasDamages ? damageFee : 0) + lateFee + fuelSurcharge;
  const depositRefund = Math.max(0, initialDeposit - totalDeductions);
  const balanceOwed = totalDeductions > initialDeposit ? totalDeductions - initialDeposit : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (returnOdometer < initialOdo) {
      setErrorMessage(`Return odometer (${returnOdometer} mi) cannot be lower than departure odometer (${initialOdo} mi).`);
      return;
    }
    if (returnFuel < 0 || returnFuel > 100) {
      setErrorMessage(`Return fuel level (${returnFuel}%) must be between 0% and 100%.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirmCheckIn(rental.id, {
        returnOdometer,
        returnFuelOrBattery: returnFuel,
        newDamages: hasDamages && damageNotes ? [damageNotes] : [],
        lateFee,
        fuelSurcharge,
        damageFee: hasDamages ? damageFee : 0,
        refundedDeposit: depositRefund,
        agentName,
        date: new Date().toISOString(),
        notes: `Returned successfully. ${milesDriven} miles driven.`
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete check-in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center">
              <CheckSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Process Return & Check-In</h2>
              <p className="text-xs text-slate-400">Condition review, odometer audit, and deposit settlement</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Summary Strip */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
            <div>
              <span className="font-mono font-bold text-slate-900 block">{rental.rentalNumber}</span>
              <span className="text-slate-600 font-medium">{rental.customerName}</span>
            </div>
            <div className="text-right">
              <span className="font-bold text-slate-900 block">{rental.vehicleName}</span>
              <span className="font-mono text-[10px] text-slate-500">{rental.vehiclePlate}</span>
            </div>
          </div>

          {/* Odometer return */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800">
              <span className="flex items-center gap-1.5">
                <Gauge className="w-4 h-4 text-slate-500" />
                <span>Odometer Audit</span>
              </span>
              <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded text-[11px]">
                +{milesDriven} Miles Driven
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Start Reading</label>
                <input
                  type="text"
                  readOnly
                  value={`${initialOdo} mi`}
                  className="w-full px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-600 block mb-0.5 font-semibold">Return Reading</label>
                <input
                  type="number"
                  value={returnOdometer}
                  onChange={(e) => setReturnOdometer(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:border-emerald-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Fuel / Battery audit */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-800">
              <span className="flex items-center gap-1.5">
                <Fuel className="w-4 h-4 text-amber-500" />
                <span>Fuel / Battery Level</span>
              </span>
              {fuelSurcharge > 0 && (
                <span className="text-amber-800 bg-amber-100 px-2 py-0.5 rounded text-[11px] font-bold">
                  Surcharge: +{formatCurrency(fuelSurcharge, tenant.currency)}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Start Fuel/Charge</label>
                <input
                  type="text"
                  readOnly
                  value={`${initialFuel}%`}
                  className="w-full px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-600 block mb-0.5 font-semibold">Return Fuel/Charge (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={returnFuel}
                  onChange={(e) => setReturnFuel(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-900 focus:border-emerald-500"
                  required
                />
              </div>
            </div>
          </div>

          {/* Overdue / Late Fee */}
          {isOverdue && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-rose-900">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-rose-600" />
                  <span>Late Return ({overdueHours}h Overdue)</span>
                </span>
                <span className="font-mono">+{formatCurrency(lateFee, tenant.currency)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Adjust Late Fee:</span>
                <input
                  type="number"
                  value={lateFee}
                  onChange={(e) => setLateFee(Number(e.target.value))}
                  className="w-24 px-2 py-1 bg-white border border-rose-200 rounded text-xs font-bold"
                />
              </div>
            </div>
          )}

          {/* Damages Check */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={hasDamages}
                onChange={(e) => setHasDamages(e.target.checked)}
                className="w-4 h-4 text-rose-600 rounded border-slate-300"
              />
              <span>Report New Scratches or Mechanical Damage</span>
            </label>

            {hasDamages && (
              <div className="pt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={damageFee}
                    onChange={(e) => setDamageFee(Number(e.target.value))}
                    placeholder="Damage fee amount"
                    className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-rose-600"
                  />
                  <span className="text-[11px] text-slate-500 flex items-center">
                    Charged to security deposit
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={damageNotes}
                  onChange={(e) => setDamageNotes(e.target.value)}
                  placeholder="Describe damage location (e.g. cracked left mirror, scratch on rear door)..."
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                />
              </div>
            )}
          </div>

          {/* Deposit Settlement Summary */}
          <div className="p-4 bg-slate-900 text-white rounded-xl space-y-2 text-xs">
            <div className="flex justify-between text-slate-300">
              <span>Original Security Deposit Held</span>
              <span className="font-semibold">{formatCurrency(initialDeposit, tenant.currency)}</span>
            </div>

            {totalDeductions > 0 && (
              <div className="py-1 space-y-1 text-[11px] text-rose-300 border-t border-slate-800">
                {fuelSurcharge > 0 && (
                  <div className="flex justify-between">
                    <span>Fuel Refill Surcharge</span>
                    <span>-{formatCurrency(fuelSurcharge, tenant.currency)}</span>
                  </div>
                )}
                {lateFee > 0 && (
                  <div className="flex justify-between">
                    <span>Late Return Fee</span>
                    <span>-{formatCurrency(lateFee, tenant.currency)}</span>
                  </div>
                )}
                {hasDamages && damageFee > 0 && (
                  <div className="flex justify-between">
                    <span>Damage Repair Fee</span>
                    <span>-{formatCurrency(damageFee, tenant.currency)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline">
              <span className="font-bold text-slate-200">Net Refund to Customer:</span>
              <span className="text-base font-extrabold text-emerald-400">
                {formatCurrency(depositRefund, tenant.currency)}
              </span>
            </div>
            {balanceOwed > 0 && (
              <div className="text-rose-400 font-bold text-[11px]">
                Additional Balance Owed by Customer: {formatCurrency(balanceOwed, tenant.currency)}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
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
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>{isSubmitting ? 'Finalizing...' : 'Settle Return & Release Deposit'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
