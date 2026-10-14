import React, { useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Car,
  Key,
  Clock,
  Wrench,
  Filter
} from 'lucide-react';
import { Vehicle, Rental, Tenant } from '../types.js';
import { formatDate } from '../lib/utils.js';

interface TimelineViewProps {
  tenant: Tenant;
  vehicles: Vehicle[];
  rentals: Rental[];
  onSelectRental: (rental: Rental) => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  tenant,
  vehicles,
  rentals,
  onSelectRental,
  onSelectVehicle,
}) => {
  const [startDateOffset, setStartDateOffset] = useState<number>(0);
  const [filterType, setFilterType] = useState<string>('ALL');

  // Days to show: 10 days
  const DAYS_COUNT = 10;
  const days = Array.from({ length: DAYS_COUNT }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + startDateOffset + i);
    return d;
  });

  const filteredVehicles = vehicles.filter(v => {
    if (filterType === 'ALL') return true;
    return v.type === filterType;
  });

  // Calculate rental position on timeline for a vehicle
  const getRentalsForVehicle = (vehicleId: string) => {
    return rentals.filter(r => r.vehicleId === vehicleId && r.status !== 'cancelled');
  };

  const isToday = (d: Date) => {
    const today = new Date();
    return d.getDate() === today.getDate() &&
           d.getMonth() === today.getMonth() &&
           d.getFullYear() === today.getFullYear();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
            Fleet Schedule & Gantt Timeline
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Visual fleet bookings, maintenance downtime, and vehicle turnover across upcoming dates.
          </p>
        </div>

        {/* Date Navigation & Controls */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-100 rounded-xl p-1 border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setStartDateOffset(prev => prev - 5)}
              className="p-1.5 hover:bg-white rounded-lg transition-colors text-slate-600"
              title="Previous 5 Days"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setStartDateOffset(0)}
              className="px-3 py-1 text-slate-700 hover:bg-white rounded-lg transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => setStartDateOffset(prev => prev + 5)}
              className="p-1.5 hover:bg-white rounded-lg transition-colors text-slate-600"
              title="Next 5 Days"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">All Categories</option>
            <option value="car">Cars Only</option>
            <option value="ebike">E-Bikes Only</option>
            <option value="motorcycle">Motorcycles</option>
            <option value="scooter">Scooters</option>
          </select>
        </div>
      </div>

      {/* Timeline Gantt Grid */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-x-auto">
        <div className="min-w-[850px]">
          {/* Header Row: Dates */}
          <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50/70 text-xs font-bold text-slate-700">
            <div className="col-span-3 p-3.5 border-r border-slate-200 text-slate-500 uppercase tracking-wider text-[10px]">
              Vehicle & Plate
            </div>
            {days.map((day, idx) => {
              const current = isToday(day);
              return (
                <div
                  key={idx}
                  className={`col-span-1 p-2 text-center border-r border-slate-200 last:border-r-0 ${
                    current ? 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-500/20' : ''
                  }`}
                >
                  <div className="text-[10px] uppercase text-slate-400 font-semibold">
                    {day.toLocaleDateString('en-US', { weekday: 'narrow' })}
                  </div>
                  <div className={`text-xs font-extrabold ${current ? 'text-emerald-700' : 'text-slate-800'}`}>
                    {day.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vehicle Rows */}
          <div className="divide-y divide-slate-100">
            {filteredVehicles.map((vehicle) => {
              const vehicleRentals = getRentalsForVehicle(vehicle.id);
              const timelineStart = days[0].getTime();
              const timelineEnd = days[days.length - 1].getTime() + 86400000;

              return (
                <div key={vehicle.id} className="grid grid-cols-12 items-center hover:bg-slate-50/50 transition-colors">
                  {/* Left Column: Vehicle Meta */}
                  <div
                    onClick={() => onSelectVehicle(vehicle)}
                    className="col-span-3 p-3 border-r border-slate-200 flex items-center gap-2.5 cursor-pointer group"
                  >
                    <img
                      src={vehicle.imageUrl}
                      alt={vehicle.name}
                      className="w-10 h-8 object-cover rounded-lg border border-slate-200 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-800 truncate group-hover:text-emerald-600 transition-colors">
                        {vehicle.name}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {vehicle.licensePlate} • <span className="capitalize">{vehicle.type}</span>
                      </div>
                    </div>
                  </div>

                  {/* 9 Columns: Timeline slots */}
                  <div className="col-span-9 grid grid-cols-9 relative h-14 items-center px-1">
                    {/* Background grid lines */}
                    {days.map((d, i) => (
                      <div
                        key={i}
                        className={`h-full border-r border-slate-100 last:border-r-0 ${
                          isToday(d) ? 'bg-emerald-50/20' : ''
                        }`}
                      />
                    ))}

                    {/* Render Booking Bars */}
                    {vehicleRentals.map((r) => {
                      const rStart = new Date(r.startDate).getTime();
                      const rEnd = new Date(r.endDate).getTime();

                      // Check overlap with timeline range
                      if (rEnd < timelineStart || rStart > timelineEnd) return null;

                      const clampedStart = Math.max(rStart, timelineStart);
                      const clampedEnd = Math.min(rEnd, timelineEnd);
                      const totalSpan = timelineEnd - timelineStart;

                      const leftPct = ((clampedStart - timelineStart) / totalSpan) * 100;
                      const widthPct = Math.max(8, ((clampedEnd - clampedStart) / totalSpan) * 100);

                      const isActive = r.status === 'active';
                      const isConfirmed = r.status === 'confirmed';
                      const isOverdue = isActive && rEnd < Date.now();

                      return (
                        <div
                          key={r.id}
                          onClick={() => onSelectRental(r)}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          className={`absolute top-2 bottom-2 rounded-lg p-1.5 shadow-xs flex items-center gap-1.5 cursor-pointer z-10 transition-transform hover:scale-[1.02] text-xs font-bold overflow-hidden ${
                            isOverdue
                              ? 'bg-rose-600 text-white'
                              : isActive
                                ? 'bg-emerald-600 text-white'
                                : isConfirmed
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-700 text-slate-200'
                          }`}
                          title={`${r.rentalNumber}: ${r.customerName} (${formatDate(r.startDate)} - ${formatDate(r.endDate)})`}
                        >
                          <Key className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate text-[11px] leading-tight">
                            {r.customerName}
                          </span>
                        </div>
                      );
                    })}

                    {/* Render Maintenance Block if in maintenance */}
                    {vehicle.status === 'maintenance' && (
                      <div
                        style={{ left: '0%', width: '100%' }}
                        className="absolute top-2 bottom-2 bg-amber-500/80 text-white rounded-lg p-1.5 shadow-xs flex items-center gap-1.5 text-[11px] font-bold z-5"
                      >
                        <Wrench className="w-3 h-3" />
                        <span>Scheduled Maintenance & Service</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend strip */}
      <div className="p-4 bg-white rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs text-slate-600 flex-wrap gap-3">
        <span className="font-bold text-slate-700">Timeline Legend:</span>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-emerald-600" />
            <span>Active Trip</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-blue-600" />
            <span>Upcoming Reservation</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-rose-600" />
            <span>Overdue Return</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-500" />
            <span>Maintenance Downtime</span>
          </div>
        </div>
      </div>
    </div>
  );
};
