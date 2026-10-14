import React from 'react';
import {
  Car,
  Gauge,
  Fuel,
  BatteryCharging,
  Wrench,
  Key,
  MapPin,
  Calendar,
  DollarSign,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { Vehicle, Rental, Tenant } from '../types.js';
import { formatCurrency, formatDate } from '../lib/utils.js';

interface VehicleDetailModalProps {
  vehicle: Vehicle;
  tenant: Tenant;
  rentals: Rental[];
  onClose: () => void;
  onBookVehicle: (vehicle: Vehicle) => void;
  onScheduleService?: (vehicle: Vehicle) => void;
}

export const VehicleDetailModal: React.FC<VehicleDetailModalProps> = ({
  vehicle,
  tenant,
  rentals,
  onClose,
  onBookVehicle,
  onScheduleService,
}) => {
  const vehicleRentals = rentals.filter(r => r.vehicleId === vehicle.id);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Vehicle Image Banner */}
        <div className="relative h-48 bg-slate-100">
          <img
            src={vehicle.imageUrl}
            alt={vehicle.name}
            className="w-full h-full object-cover"
          />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-900/60 text-white flex items-center justify-center text-sm font-bold backdrop-blur-xs hover:bg-slate-900 transition-colors"
          >
            ✕
          </button>
          <div className="absolute bottom-3 left-3 flex items-center gap-2">
            <span className="font-mono text-xs font-bold bg-white/95 text-slate-900 px-2.5 py-1 rounded-lg shadow-sm">
              {vehicle.licensePlate}
            </span>
            <span className="text-[11px] font-bold uppercase bg-slate-900/80 text-white px-2 py-0.5 rounded-md backdrop-blur-xs">
              {vehicle.type}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-800">
          <div>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{vehicle.name}</h3>
                <p className="text-slate-500 text-[11px]">
                  {vehicle.year} • {vehicle.color} • VIN: <span className="font-mono">{vehicle.vin}</span>
                </p>
              </div>
              <div className="text-right">
                <span className="text-base font-extrabold text-emerald-600 block">
                  {formatCurrency(vehicle.dailyRate, tenant.currency)}
                </span>
                <span className="text-[10px] text-slate-400">per day</span>
              </div>
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Odometer</span>
              <span className="font-mono text-xs font-bold text-slate-800">{(vehicle.odometer ?? 0).toLocaleString()} mi</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Fuel / Battery</span>
              <span className="font-mono text-xs font-bold text-slate-800">{vehicle.fuelOrBatteryLevel}%</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-semibold block">Current Station</span>
              <span className="text-xs font-semibold text-slate-800 truncate block">{vehicle.location}</span>
            </div>
          </div>

          {/* Specifications */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase text-slate-400 block">Features & Equipment</span>
            <div className="flex flex-wrap gap-1.5">
              {vehicle.features.map((feat, idx) => (
                <span key={idx} className="bg-slate-100 text-slate-700 font-medium px-2.5 py-1 rounded-lg text-[11px]">
                  ✓ {feat}
                </span>
              ))}
            </div>
          </div>

          {/* Trip History Summary */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase text-slate-400 block">
              Recent Bookings ({vehicleRentals.length})
            </span>
            {vehicleRentals.length === 0 ? (
              <p className="text-slate-400 text-[11px] py-2">No past bookings recorded for this asset.</p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {vehicleRentals.map(r => (
                  <div key={r.id} className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-[11px]">
                    <div>
                      <span className="font-bold text-slate-800 block">{r.customerName}</span>
                      <span className="text-slate-400">{formatDate(r.startDate)} - {formatDate(r.endDate)}</span>
                    </div>
                    <span className="font-semibold capitalize text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase ${
              vehicle.status === 'available' ? 'bg-emerald-100 text-emerald-800' : vehicle.status === 'rented' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
            }`}>
              Status: {vehicle.status}
            </span>

            <div className="flex items-center gap-2">
              {vehicle.status === 'available' && (
                <button
                  onClick={() => {
                    onClose();
                    onBookVehicle(vehicle);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Book This Vehicle</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
