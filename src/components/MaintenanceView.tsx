import React, { useState } from 'react';
import {
  Wrench,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  DollarSign,
  Calendar,
  Gauge,
  Car,
  FileText
} from 'lucide-react';
import { MaintenanceRecord, Vehicle, Tenant } from '../types.js';
import { formatCurrency, formatDate } from '../lib/utils.js';

interface MaintenanceViewProps {
  tenant: Tenant;
  vehicles: Vehicle[];
  records: MaintenanceRecord[];
  onAddRecord: (record: Partial<MaintenanceRecord>) => Promise<void>;
  onCompleteRecord: (recordId: string) => Promise<void>;
}

export const MaintenanceView: React.FC<MaintenanceViewProps> = ({
  tenant,
  vehicles,
  records,
  onAddRecord,
  onCompleteRecord,
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  const filteredRecords = records.filter(r => {
    if (filterStatus === 'ALL') return true;
    return r.status === filterStatus;
  });

  const vehiclesInService = vehicles.filter(v => v.status === 'maintenance');
  const totalSpent = records.reduce((s, r) => s + r.cost, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Fleet Maintenance & Inspections
            </h1>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {records.length} Service Logs
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Preventative oil changes, tire rotations, brake calibrations, and unscheduled repairs.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Log Service / Work Order</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Vehicles in Service Now
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-2xl font-extrabold ${vehiclesInService.length > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
              {vehiclesInService.length}
            </span>
            <span className="text-xs text-slate-500">
              ({Math.round((vehiclesInService.length / Math.max(1, vehicles.length)) * 100)}% of fleet)
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Total Maintenance Expenditure
          </span>
          <span className="text-2xl font-extrabold text-slate-900 mt-1 block">
            {formatCurrency(totalSpent, tenant.currency)}
          </span>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Scheduled Routine Services
          </span>
          <span className="text-2xl font-extrabold text-blue-600 mt-1 block">
            {records.filter(r => r.status === 'scheduled').length}
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 bg-white p-3 rounded-2xl border border-slate-200/80 text-xs">
        <span className="font-bold text-slate-700 ml-2">Status Filter:</span>
        {['ALL', 'in_progress', 'scheduled', 'completed'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilterStatus(tab)}
            className={`px-3 py-1.5 rounded-lg font-semibold capitalize cursor-pointer transition-colors ${
              filterStatus === tab
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Service Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/70 border-b border-slate-200 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
              <tr>
                <th className="p-4">Vehicle</th>
                <th className="p-4">Service Type</th>
                <th className="p-4">Date</th>
                <th className="p-4">Odometer</th>
                <th className="p-4">Workshop / Provider</th>
                <th className="p-4">Cost</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.map((rec) => {
                const vehicle = vehicles.find(v => v.id === rec.vehicleId);
                return (
                  <tr key={rec.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-4">
                      <div className="font-bold text-slate-900">{rec.vehicleName}</div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {vehicle?.licensePlate || 'Fleet Asset'}
                      </div>
                    </td>
                    <td className="p-4 font-semibold text-slate-800">
                      {rec.serviceType}
                      {rec.notes && (
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5 max-w-xs truncate">
                          {rec.notes}
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-slate-600">
                      {formatDate(rec.date)}
                    </td>
                    <td className="p-4 font-mono text-slate-700">
                      {(rec.odometerAtService ?? rec.odometer ?? 0).toLocaleString()} mi
                    </td>
                    <td className="p-4 text-slate-700">
                      {rec.serviceProvider}
                    </td>
                    <td className="p-4 font-mono font-bold text-slate-900">
                      {formatCurrency(rec.cost, tenant.currency)}
                    </td>
                    <td className="p-4">
                      {rec.status === 'completed' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3" />
                          Completed
                        </span>
                      ) : rec.status === 'in_progress' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                          <Wrench className="w-3 h-3" />
                          In Shop
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3" />
                          Scheduled
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {rec.status !== 'completed' && (
                        <button
                          onClick={() => onCompleteRecord(rec.id)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          Mark Completed
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Maintenance Modal */}
      {isAddModalOpen && (
        <AddMaintenanceModal
          tenant={tenant}
          vehicles={vehicles}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={async (data) => {
            await onAddRecord(data);
            setIsAddModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

interface AddMaintenanceModalProps {
  tenant: Tenant;
  vehicles: Vehicle[];
  onClose: () => void;
  onAdd: (record: Partial<MaintenanceRecord>) => Promise<void>;
}

const AddMaintenanceModal: React.FC<AddMaintenanceModalProps> = ({
  tenant,
  vehicles,
  onClose,
  onAdd,
}) => {
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id || '');
  const [serviceType, setServiceType] = useState('Routine 10k Oil & Filter Inspection');
  const [cost, setCost] = useState(120);
  const [serviceProvider, setServiceProvider] = useState('Speedy Fleet Services Bay 3');
  const [odometer, setOdometer] = useState(14500);
  const [notes, setNotes] = useState('Inspect brake pads and top up washer fluid');
  const [status, setStatus] = useState<'in_progress' | 'scheduled' | 'completed'>('in_progress');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedVehicle = vehicles.find(v => v.id === vehicleId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;
    setIsSubmitting(true);
    try {
      await onAdd({
        tenantId: tenant.id,
        vehicleId,
        vehicleName: selectedVehicle.name,
        serviceType,
        date: new Date().toISOString(),
        cost: Number(cost),
        serviceProvider,
        odometerAtService: Number(odometer),
        odometer: Number(odometer),
        notes,
        status,
        scheduledNextDate: new Date(Date.now() + 90 * 86400000).toISOString()
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">Create Maintenance Work Order</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Target Fleet Vehicle</label>
            <select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            >
              {vehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.licensePlate}) - Status: {v.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Service Description</label>
            <input
              type="text"
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Estimated Cost ({tenant.currency})</label>
              <input
                type="number"
                value={cost}
                onChange={(e) => setCost(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                required
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Current Odometer</label>
              <input
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                required
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Workshop / Service Facility</label>
            <input
              type="text"
              value={serviceProvider}
              onChange={(e) => setServiceProvider(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              required
            />
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            >
              <option value="in_progress">In Progress (Marks vehicle as in Maintenance)</option>
              <option value="scheduled">Scheduled for Future</option>
              <option value="completed">Already Completed</option>
            </select>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Technician Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs text-slate-600">Cancel</button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-emerald-600 text-white font-bold rounded-lg text-xs"
            >
              {isSubmitting ? 'Logging...' : 'Save Work Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
