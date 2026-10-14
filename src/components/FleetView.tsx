import React, { useState } from 'react';
import {
  Plus,
  Search,
  Filter,
  Car,
  Bike,
  Fuel,
  BatteryCharging,
  Gauge,
  MapPin,
  CheckCircle2,
  Clock,
  Wrench,
  AlertCircle,
  MoreVertical,
  SlidersHorizontal,
  Trash2,
  Edit2,
  Calendar,
  Sparkles
} from 'lucide-react';
import { Vehicle, VehicleType, VehicleStatus, Tenant } from '../types.js';
import { formatCurrency } from '../lib/utils.js';

interface FleetViewProps {
  tenant: Tenant;
  vehicles: Vehicle[];
  onAddVehicle: (v: Partial<Vehicle>) => Promise<void>;
  onUpdateVehicle: (id: string, updates: Partial<Vehicle>) => Promise<void>;
  onDeleteVehicle: (id: string) => Promise<void>;
  onSelectVehicleForRent: (v: Vehicle) => void;
  onOpenVehicleDetails: (v: Vehicle) => void;
  onOpenServiceModal: (v: Vehicle) => void;
}

export const FleetView: React.FC<FleetViewProps> = ({
  tenant,
  vehicles,
  onAddVehicle,
  onUpdateVehicle,
  onDeleteVehicle,
  onSelectVehicleForRent,
  onOpenVehicleDetails,
  onOpenServiceModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Filter logic
  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.category.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'ALL' || v.type === selectedCategory;
    const matchesStatus = selectedStatus === 'ALL' || v.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getStatusBadge = (status: VehicleStatus) => {
    switch (status) {
      case 'available':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Available</span>;
      case 'rented':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">Rented Out</span>;
      case 'maintenance':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">In Maintenance</span>;
      case 'reserved':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Reserved</span>;
      case 'cleaning':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800">Cleaning</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Fleet & Inventory Management
            </h1>
            <span className="text-xs font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
              {vehicles.length} Units
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Manage cars, motorbikes, e-bikes, and scooters with rates, telemetry, and live status.
          </p>
        </div>

        <button
          id="add-vehicle-btn"
          onClick={() => setIsAddModalOpen(true)}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Add New Vehicle</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by model, brand, license plate..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          {/* Status Dropdown */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-medium">Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700 focus:outline-hidden"
            >
              <option value="ALL">All Statuses</option>
              <option value="available">Available Only</option>
              <option value="rented">Currently Rented</option>
              <option value="maintenance">In Maintenance</option>
              <option value="reserved">Reserved</option>
            </select>
          </div>
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1 text-xs scrollbar-none">
          {[
            { id: 'ALL', label: 'All Fleet' },
            { id: 'car', label: 'Cars' },
            { id: 'motorcycle', label: 'Motorcycles' },
            { id: 'ebike', label: 'E-Bikes' },
            { id: 'scooter', label: 'Scooters' },
            { id: 'bike', label: 'City & Mountain Bikes' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-lg font-semibold transition-all whitespace-nowrap cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vehicles Grid */}
      {filteredVehicles.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center">
          <Car className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-800">No vehicles found</h3>
          <p className="text-xs text-slate-500 mt-1">
            Try adjusting your search query or status filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filteredVehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              className="bg-white rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-all flex flex-col overflow-hidden group"
            >
              {/* Image & Badges */}
              <div className="relative h-48 bg-slate-100 overflow-hidden">
                <img
                  src={vehicle.imageUrl}
                  alt={vehicle.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute top-3 left-3">
                  {getStatusBadge(vehicle.status)}
                </div>
                <div className="absolute top-3 right-3 bg-slate-900/80 backdrop-blur-xs text-white text-[11px] font-bold px-2 py-0.5 rounded-md font-mono">
                  {vehicle.licensePlate}
                </div>
                <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs text-slate-800 text-[11px] font-bold px-2.5 py-1 rounded-lg shadow-xs flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-emerald-600" />
                  <span>{vehicle.location}</span>
                </div>
              </div>

              {/* Card Body */}
              <div className="p-5 flex-1 flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {vehicle.year} • {vehicle.brand} • {vehicle.category}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 leading-tight mt-0.5">
                        {vehicle.name}
                      </h3>
                    </div>
                  </div>

                  {/* Telemetry row */}
                  <div className="grid grid-cols-2 gap-3 my-4 py-3 border-y border-slate-100">
                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <Gauge className="w-4 h-4 text-slate-400" />
                      <div>
                        <span className="text-slate-400 text-[10px] block">Odometer</span>
                        <span className="font-bold text-slate-800">{(vehicle.odometer ?? 0).toLocaleString()} mi</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      {vehicle.batteryLevel !== undefined ? (
                        <BatteryCharging className="w-4 h-4 text-emerald-500" />
                      ) : (
                        <Fuel className="w-4 h-4 text-amber-500" />
                      )}
                      <div>
                        <span className="text-slate-400 text-[10px] block">
                          {vehicle.batteryLevel !== undefined ? 'Battery' : 'Fuel'} Level
                        </span>
                        <span className="font-bold text-slate-800">
                          {vehicle.batteryLevel ?? vehicle.fuelLevel}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Pricing line */}
                  <div className="flex items-baseline justify-between mb-4">
                    <div>
                      <span className="text-lg font-extrabold text-slate-900">
                        {formatCurrency(vehicle.dailyRate, tenant.currency)}
                      </span>
                      <span className="text-xs text-slate-400 font-medium"> / day</span>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <span>{formatCurrency(vehicle.hourlyRate, tenant.currency)}/hr</span>
                      <span className="mx-1.5">•</span>
                      <span>Deposit: {formatCurrency(vehicle.deposit, tenant.currency)}</span>
                    </div>
                  </div>
                </div>

                {/* Actions Footer */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => onOpenVehicleDetails(vehicle)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                  >
                    Specs & Logs
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenServiceModal(vehicle)}
                      title="Log Service / Maintenance"
                      className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Wrench className="w-4 h-4" />
                    </button>

                    {vehicle.status === 'available' ? (
                      <button
                        onClick={() => onSelectVehicleForRent(vehicle)}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-all cursor-pointer"
                      >
                        Rent Vehicle
                      </button>
                    ) : (
                      <button
                        disabled
                        className="px-3 py-1.5 bg-slate-100 text-slate-400 text-xs font-semibold rounded-lg cursor-not-allowed"
                      >
                        {vehicle.status === 'rented' ? 'In Use' : 'Unavailable'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Add New Vehicle */}
      {isAddModalOpen && (
        <AddVehicleModal
          tenant={tenant}
          onClose={() => setIsAddModalOpen(false)}
          onAdd={async (v) => {
            await onAddVehicle(v);
            setIsAddModalOpen(false);
          }}
        />
      )}
    </div>
  );
};

interface AddVehicleModalProps {
  tenant: Tenant;
  onClose: () => void;
  onAdd: (vehicle: Partial<Vehicle>) => Promise<void>;
}

const AddVehicleModal: React.FC<AddVehicleModalProps> = ({ tenant, onClose, onAdd }) => {
  const [formData, setFormData] = useState<Partial<Vehicle>>({
    tenantId: tenant.id,
    name: '',
    type: 'car',
    category: 'Sedan',
    brand: '',
    model: '',
    year: 2024,
    licensePlate: '',
    color: 'White',
    status: 'available',
    location: tenant.locations[0] || 'Main Hub',
    hourlyRate: 15,
    dailyRate: 65,
    weeklyRate: 380,
    deposit: 200,
    odometer: 1000,
    fuelLevel: 100,
    batteryLevel: 100,
    seats: 5,
    imageUrl: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80',
    features: ['GPS Navigation', 'Bluetooth Audio']
  });

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onAdd({
        ...formData,
        name: formData.name || `${formData.brand} ${formData.model}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Add New Vehicle to Fleet</h3>
            <p className="text-xs text-slate-500">Register a car, e-bike, scooter or motorcycle</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg font-bold"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Vehicle Type</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as VehicleType })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
              >
                <option value="car">Car / SUV</option>
                <option value="motorcycle">Motorcycle</option>
                <option value="ebike">E-Bike</option>
                <option value="scooter">Scooter / Moped</option>
                <option value="bike">City / Mountain Bike</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Category / Class</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="e.g. Electric Sedan, Commuter E-Bike"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Brand / Make</label>
              <input
                type="text"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                placeholder="Tesla, Trek, Vespa..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Model</label>
              <input
                type="text"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                placeholder="Model 3, Primavera..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Year</label>
              <input
                type="number"
                value={formData.year}
                onChange={(e) => setFormData({ ...formData, year: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">License Plate / Reg #</label>
              <input
                type="text"
                value={formData.licensePlate}
                onChange={(e) => setFormData({ ...formData, licensePlate: e.target.value })}
                placeholder="8XYZ123 or BIK-09"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Station / Branch</label>
              <select
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                {tenant.locations.map(loc => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Pricing Rates */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <span className="text-xs font-bold text-slate-800 block">Rental Pricing ({tenant.currency})</span>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] text-slate-500 block">Hourly Rate</label>
                <input
                  type="number"
                  value={formData.hourlyRate}
                  onChange={(e) => setFormData({ ...formData, hourlyRate: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block">Daily Rate</label>
                <input
                  type="number"
                  value={formData.dailyRate}
                  onChange={(e) => setFormData({ ...formData, dailyRate: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-emerald-700"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 block">Deposit Amount</label>
                <input
                  type="number"
                  value={formData.deposit}
                  onChange={(e) => setFormData({ ...formData, deposit: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                  required
                />
              </div>
            </div>
          </div>

          {/* Image URL */}
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">Image URL</label>
            <input
              type="url"
              value={formData.imageUrl}
              onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              required
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
              disabled={loading}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {loading ? 'Saving...' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
