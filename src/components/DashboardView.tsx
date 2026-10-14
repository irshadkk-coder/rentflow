import React from 'react';
import {
  TrendingUp,
  Car,
  CalendarCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  IndianRupee,
  Wrench,
  ArrowUpRight,
  ArrowRight,
  Key,
  ShieldAlert,
  Bike
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Tenant, Vehicle, Rental, DashboardStats } from '../types.js';
import { formatCurrency, formatDate } from '../lib/utils.js';

interface DashboardViewProps {
  tenant: Tenant;
  selectedLocation?: string;
  stats?: DashboardStats | null;
  metrics?: DashboardStats | null;
  vehicles?: Vehicle[];
  rentals?: Rental[];
  onNavigate?: (tab: string) => void;
  onNavigateToFleet?: () => void;
  onNavigateToRentals?: (filter?: string) => void;
  onOpenCheckOut: (rental: Rental) => void;
  onOpenCheckIn: (rental: Rental) => void;
  onOpenNewBooking: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  tenant,
  selectedLocation = 'ALL',
  stats: propStats,
  metrics,
  vehicles = [],
  rentals = [],
  onNavigate,
  onNavigateToFleet,
  onNavigateToRentals,
  onOpenCheckOut,
  onOpenCheckIn,
  onOpenNewBooking,
}) => {
  const navigateToFleet = onNavigateToFleet || (() => onNavigate?.('fleet'));
  const navigateToRentals = onNavigateToRentals || ((filter?: string) => onNavigate?.('rentals'));

  const activeRentals = (rentals || []).filter(r => r.status === 'active');
  const upcomingRentals = (rentals || []).filter(r => r.status === 'confirmed');
  const overdueRentals = (rentals || []).filter(r => {
    if (r.status !== 'active') return false;
    return new Date(r.endDate).getTime() < Date.now();
  });

  const rawStats = propStats || metrics;

  const stats: DashboardStats = rawStats || {
    totalVehicles: vehicles?.length || 0,
    activeRentals: activeRentals.length,
    availableVehicles: (vehicles || []).filter(v => v.status === 'available').length,
    maintenanceVehicles: (vehicles || []).filter(v => v.status === 'maintenance').length,
    fleetUtilizationRate: vehicles?.length ? Math.round((activeRentals.length / vehicles.length) * 100) : 0,
    monthlyRevenue: (rentals || []).reduce((acc, r) => acc + (r.totalAmount || 0), 0),
    revenueGrowth: 14.2,
    overdueCount: overdueRentals.length,
    todayPickups: upcomingRentals.length,
    todayDropoffs: activeRentals.length,
    revenueChart: [
      { day: 'Mon', revenue: 352, rentals: 3 },
      { day: 'Tue', revenue: 419, rentals: 1 },
      { day: 'Wed', revenue: 222, rentals: 1 },
      { day: 'Thu', revenue: 304, rentals: 1 },
      { day: 'Fri', revenue: 275, rentals: 1 },
      { day: 'Sat', revenue: 480, rentals: 2 },
      { day: 'Sun', revenue: 390, rentals: 2 },
    ],
    fleetDistribution: [
      { name: 'CAR', value: (vehicles || []).filter(v => v.type === 'car').length || 3, color: '#0ea5e9' },
      { name: 'MOTORCYCLE', value: (vehicles || []).filter(v => v.type === 'motorcycle').length || 1, color: '#f59e0b' },
      { name: 'EBIKE', value: (vehicles || []).filter(v => v.type === 'ebike').length || 2, color: '#10b981' },
      { name: 'SCOOTER', value: (vehicles || []).filter(v => v.type === 'scooter').length || 1, color: '#8b5cf6' }
    ],
    recentActivity: []
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Fleet Operations Overview
            </h1>
            {selectedLocation && selectedLocation !== 'ALL' ? (
              <span id="dashboard-active-branch-badge" className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Branch: {selectedLocation}
              </span>
            ) : (
              <span id="dashboard-active-branch-badge" className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                All Branches ({tenant.locations?.length || 1})
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time fleet utilization, dispatch schedule, and revenue tracking for <span className="font-semibold text-slate-700">{tenant.name}</span>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            id="dashboard-new-booking-btn"
            onClick={onOpenNewBooking}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Create Reservation</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Fleet Utilization */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Fleet Utilization
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {stats.fleetUtilizationRate}%
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {stats.activeRentals} of {stats.totalVehicles} units active
            </span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, stats.fleetUtilizationRate)}%` }}
            />
          </div>
        </div>

        {/* Metric 2: Monthly Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Monthly Revenue
            </span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {formatCurrency(stats.monthlyRevenue, tenant.currency)}
            </span>
            <span className="text-xs font-semibold text-emerald-600 flex items-center">
              +{stats.revenueGrowth}%
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Tracked across rentals, waivers & add-ons
          </p>
        </div>

        {/* Metric 3: Active Rentals & Overdue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Active Rentals
            </span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <CalendarCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900">
              {stats.activeRentals}
            </span>
            {stats.overdueCount > 0 ? (
              <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {stats.overdueCount} Overdue
              </span>
            ) : (
              <span className="text-xs font-medium text-emerald-600">All on track</span>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {upcomingRentals.length} upcoming reservations confirmed
          </p>
        </div>

        {/* Metric 4: Available Units vs Maintenance */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Ready for Rent
            </span>
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-600">
              {stats.availableVehicles}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              / {stats.totalVehicles} total units
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
            <Wrench className="w-3 h-3 text-amber-500" />
            <span className="font-semibold text-slate-700">{stats.maintenanceVehicles}</span> units in maintenance
          </p>
        </div>
      </div>

      {/* Analytics Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Velocity Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Weekly Revenue Trend
              </h2>
              <p className="text-xs text-slate-400">
                Daily rental turnover and volume
              </p>
            </div>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
              Last 7 Days
            </span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.revenueChart}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#059669" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={{ stroke: '#e2e8f0' }}
                  tickLine={false}
                  tickFormatter={(v) => `${tenant.currency}${v}`}
                />
                <Tooltip
                  formatter={(val: any) => [`${tenant.currency}${val}`, 'Revenue']}
                  labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#059669"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#revenueGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Fleet Composition Donut */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-slate-900">
                Fleet Distribution
              </h2>
              <button
                onClick={navigateToFleet}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Breakdown by vehicle category
            </p>

            <div className="h-44 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.fleetDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={68}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {stats.fleetDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: any, name: any) => [`${val} Units`, name]}
                    contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-100">
            {stats.fleetDistribution.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-xs">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-slate-600 font-medium">{item.name}</span>
                <span className="ml-auto font-bold text-slate-800">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Fast Dispatch & Operations Action Center */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active & Pending Handover / Check-out */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-600" />
                <span>Today's Pickups & Departures</span>
              </h2>
              <p className="text-xs text-slate-400">
                Customer arrivals and key handovers
              </p>
            </div>
            <button
              onClick={() => navigateToRentals('confirmed')}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              See All
            </button>
          </div>

          {upcomingRentals.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No pending departures scheduled for immediate pickup.
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingRentals.slice(0, 3).map((r) => (
                <div
                  key={r.id}
                  className="p-3.5 rounded-xl border border-slate-200/70 bg-slate-50/50 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={r.vehicleImage}
                      alt={r.vehicleName}
                      className="w-12 h-10 object-cover rounded-lg border border-slate-200"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800">{r.customerName}</div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        {r.vehicleName} • <span className="font-mono">{r.vehiclePlate}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {r.pickupLocation}
                      </div>
                    </div>
                  </div>

                  <button
                    id={`checkout-btn-${r.id}`}
                    onClick={() => onOpenCheckOut(r)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <span>Check-Out</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Due Returns / Check-in */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <span>Active Rentals & Returns</span>
              </h2>
              <p className="text-xs text-slate-400">
                Vehicles currently out with customers
              </p>
            </div>
            <button
              onClick={() => navigateToRentals('active')}
              className="text-xs font-semibold text-emerald-600 hover:text-emerald-700"
            >
              See All
            </button>
          </div>

          {activeRentals.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No vehicles currently out on rental.
            </div>
          ) : (
            <div className="space-y-3">
              {activeRentals.slice(0, 3).map((r) => {
                const isOverdue = new Date(r.endDate).getTime() < Date.now();
                return (
                  <div
                    key={r.id}
                    className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                      isOverdue
                        ? 'border-rose-200 bg-rose-50/40'
                        : 'border-slate-200/70 bg-slate-50/50 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={r.vehicleImage}
                        alt={r.vehicleName}
                        className="w-12 h-10 object-cover rounded-lg border border-slate-200"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-800">{r.customerName}</span>
                          {isOverdue && (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.2 rounded">
                              Overdue Return
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 font-medium">
                          {r.vehicleName} • Due {formatDate(r.endDate)}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Deposit: {formatCurrency(r.depositAmount, tenant.currency)} (Held)
                        </div>
                      </div>
                    </div>

                    <button
                      id={`checkin-btn-${r.id}`}
                      onClick={() => onOpenCheckIn(r)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <span>Process Return</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
