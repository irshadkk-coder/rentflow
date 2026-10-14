import React, { useState, useEffect } from 'react';
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  Calendar,
  Car,
  Bike,
  Clock,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  ArrowLeft,
  AlertCircle,
  CreditCard,
  UserCheck,
  Fuel
} from 'lucide-react';
import { Tenant, PublicVehicle, PricingQuote } from '../types.js';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/utils.js';
import { BotVerification } from './BotVerification.js';

interface PublicBookingViewProps {
  currentTenant: Tenant;
  onBackToConsole: () => void;
}

export const PublicBookingView: React.FC<PublicBookingViewProps> = ({
  currentTenant,
  onBackToConsole,
}) => {
  const [vehicles, setVehicles] = useState<PublicVehicle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  // Booking Flow State
  const [selectedVehicle, setSelectedVehicle] = useState<PublicVehicle | null>(null);
  const [pickupDate, setPickupDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [returnDate, setReturnDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 4);
    d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [pickupLocation, setPickupLocation] = useState<string>(currentTenant.locations[0] || 'Main Station');
  const [insuranceTier, setInsuranceTier] = useState<'none' | 'basic' | 'premium'>('basic');
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);

  const PUBLIC_ADD_ONS = [
    { id: 'helmet', name: 'Safety Helmet', price: '₹5/day', desc: 'DOT/ECE certified safety helmet' },
    { id: 'gps', name: 'GPS Navigation System', price: '₹10/day', desc: 'Dedicated GPS unit & mount' },
    { id: 'child_seat', name: 'Child Safety Seat', price: '₹12/day', desc: 'ISOFIX approved toddler seat' }
  ];

  // Guest Customer Form
  const [customerName, setCustomerName] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerAddress, setCustomerAddress] = useState<string>('');
  const [driverLicenseNumber, setDriverLicenseNumber] = useState<string>('');
  const [captchaToken, setCaptchaToken] = useState<string>('');
  const [isBotVerified, setIsBotVerified] = useState<boolean>(false);

  // Calculation & Booking Confirmation
  const [quote, setQuote] = useState<PricingQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState<boolean>(false);
  const [bookingSubmitting, setBookingSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<any | null>(null);

  // Load public catalog
  useEffect(() => {
    async function loadCatalog() {
      setLoading(true);
      try {
        const list = await api.publicGetVehicles(currentTenant.slug);
        setVehicles(list);
      } catch (err) {
        console.error('Failed to load public fleet:', err);
      } finally {
        setLoading(false);
      }
    }
    loadCatalog();
  }, [currentTenant.slug]);

  // Recalculate quote whenever dates, vehicle, insurance, or addons change
  useEffect(() => {
    if (!selectedVehicle) {
      setQuote(null);
      return;
    }

    async function fetchQuote() {
      setQuoteLoading(true);
      setErrorMessage(null);
      try {
        const res = await api.publicGetQuote({
          slug: currentTenant.slug,
          vehicleId: selectedVehicle!.id,
          startDate: new Date(pickupDate).toISOString(),
          endDate: new Date(returnDate).toISOString(),
          rentalRateType: 'daily',
          insuranceTier,
          addOnIds: selectedAddOns
        });
        setQuote(res);
      } catch (err: any) {
        setErrorMessage(err.message || 'Unable to calculate quote for selected dates.');
        setQuote(null);
      } finally {
        setQuoteLoading(false);
      }
    }

    const start = new Date(pickupDate).getTime();
    const end = new Date(returnDate).getTime();
    if (!isNaN(start) && !isNaN(end) && start < end) {
      fetchQuote();
    } else {
      setErrorMessage('Return date must be after pickup date.');
      setQuote(null);
    }
  }, [selectedVehicle, pickupDate, returnDate, insuranceTier, selectedAddOns, currentTenant.slug]);

  const handleSelectVehicle = (v: PublicVehicle) => {
    setSelectedVehicle(v);
    setErrorMessage(null);
    setConfirmation(null);
    setCaptchaToken('');
    setIsBotVerified(false);
  };

  const handleToggleAddOn = (id: string) => {
    setSelectedAddOns(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) return;

    if (!customerName || !customerName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!customerPhone || !customerPhone.trim()) {
      setErrorMessage('Please enter a valid contact phone number.');
      return;
    }

    const cleanPhoneDigits = customerPhone.replace(/\D/g, '');
    if (cleanPhoneDigits.length < 7 || cleanPhoneDigits.length > 15) {
      setErrorMessage('Phone number must contain between 7 and 15 digits.');
      return;
    }

    if (customerEmail && customerEmail.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmail.trim())) {
        setErrorMessage('Please enter a valid email address.');
        return;
      }
    }

    if (!captchaToken) {
      setErrorMessage('Please complete the anti-bot verification challenge before confirming your reservation.');
      return;
    }

    setBookingSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await api.publicCreateBooking({
        slug: currentTenant.slug,
        vehicleId: selectedVehicle.id,
        startDate: new Date(pickupDate).toISOString(),
        endDate: new Date(returnDate).toISOString(),
        rentalRateType: 'daily',
        insuranceTier,
        addOnIds: selectedAddOns,
        addOns: selectedAddOns,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || undefined,
        customerPhone: customerPhone.trim(),
        customerAddress: customerAddress.trim() || undefined,
        driverLicenseNumber: driverLicenseNumber.trim() || undefined,
        pickupLocation,
        dropoffLocation: pickupLocation,
        captchaToken,
      });

      setConfirmation(res);
      setSelectedVehicle(null);
      setCaptchaToken('');
      setIsBotVerified(false);
    } catch (err: any) {
      // Keep customer form values intact on error!
      setErrorMessage(err.message || 'Failed to submit reservation.');
    } finally {
      setBookingSubmitting(false);
    }
  };

  const filteredVehicles = vehicles.filter(v => {
    if (categoryFilter === 'ALL') return true;
    return v.type.toLowerCase() === categoryFilter.toLowerCase();
  });

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Banner indicating preview mode with switch back to console */}
      <div className="bg-slate-900 text-slate-300 px-4 py-2 text-xs flex items-center justify-between border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-white">Public Customer Storefront Preview</span>
          <span className="text-slate-400 hidden sm:inline">— Guest reservation flow for /rent/{currentTenant.slug}</span>
        </div>
        <button
          id="back-to-console-btn"
          onClick={onBackToConsole}
          className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 font-semibold rounded-lg border border-slate-700 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Return to Staff Console</span>
        </button>
      </div>

      {/* Public Storefront Header */}
      <header className="bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
                {currentTenant.name.charAt(0)}
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight font-display">
                  {currentTenant.name}
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">
                  {currentTenant.tagline}
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              <span>{currentTenant.locations.join(' • ')}</span>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
              <Phone className="w-3.5 h-3.5 text-emerald-600" />
              <span>{currentTenant.phone}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full">
        {/* Success Confirmation Card */}
        {confirmation && (
          <div className={`mb-8 p-6 border rounded-2xl shadow-sm animate-in fade-in ${
            confirmation.duplicate
              ? 'bg-amber-50/80 border-amber-200'
              : 'bg-emerald-50 border-emerald-200'
          }`}>
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center flex-shrink-0 ${
                confirmation.duplicate ? 'bg-amber-600' : 'bg-emerald-600'
              }`}>
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    confirmation.duplicate
                      ? 'text-amber-800 bg-amber-100'
                      : 'text-emerald-800 bg-emerald-100'
                  }`}>
                    {confirmation.duplicate ? 'Existing Booking Verified' : 'Reservation Confirmed'}
                  </span>
                  <span className={`text-xs font-mono font-bold ${
                    confirmation.duplicate ? 'text-amber-800' : 'text-emerald-700'
                  }`}>
                    #{confirmation.bookingNumber}
                  </span>
                </div>
                <h2 className="text-xl font-bold text-slate-900 mt-1">
                  {confirmation.duplicate
                    ? 'Identical Booking Detected & Retained'
                    : 'Thank you! Your booking is locked in.'}
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  {confirmation.duplicate
                    ? `An identical booking for ${confirmation.vehicleName} covering these exact dates was recently placed. Your reservation is safely retained under booking #${confirmation.bookingNumber}. No duplicate charges or double bookings were generated.`
                    : `We have reserved your ${confirmation.vehicleName} from ${new Date(confirmation.startDate).toLocaleDateString()} to ${new Date(confirmation.endDate).toLocaleDateString()}. Total estimated billing is ${formatCurrency(confirmation.totalAmount, currentTenant.currency)} with a refundable security deposit of ${formatCurrency(confirmation.depositAmount, currentTenant.currency)}.`}
                </p>
                <div className="mt-4 pt-4 border-t border-emerald-200/80 flex flex-wrap gap-3">
                  <button
                    onClick={() => setConfirmation(null)}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
                  >
                    Book Another Trip
                  </button>
                  <button
                    onClick={onBackToConsole}
                    className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl border border-slate-200 transition-all cursor-pointer"
                  >
                    Inspect in Dispatch CRM
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fleet Filtering Strip */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Select Your Rental Vehicle</h2>
            <p className="text-xs text-slate-500">Transparent rates, fully serviced fleet, and comprehensive coverage options.</p>
          </div>

          {/* Category Chips */}
          <div className="flex items-center gap-1.5 p-1 bg-white border border-slate-200 rounded-xl shadow-2xs">
            {['ALL', 'car', 'motorcycle', 'ebike', 'bike', 'scooter'].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {cat === 'ALL' ? 'All Fleet' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* Fleet Grid */}
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-xs">Loading available vehicles...</div>
        ) : filteredVehicles.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-2xl border border-slate-200 p-8">
            <Car className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">No vehicles available in this category</p>
            <p className="text-xs text-slate-400 mt-1">Please select another category or contact station dispatch.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredVehicles.map(vehicle => (
              <div
                key={vehicle.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs hover:shadow-md transition-all flex flex-col"
              >
                {/* Image */}
                <div className="h-48 bg-slate-100 relative overflow-hidden">
                  <img
                    src={vehicle.imageUrl}
                    alt={vehicle.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur-xs text-white text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
                    {vehicle.category}
                  </div>
                  <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-lg shadow-xs text-xs font-bold text-slate-900">
                    {formatCurrency(vehicle.dailyRate, currentTenant.currency)}<span className="text-[10px] font-normal text-slate-500">/day</span>
                  </div>
                </div>

                {/* Details */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{vehicle.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {vehicle.year} • {vehicle.transmission} • {vehicle.seats} Seats • {vehicle.color}
                    </p>

                    {/* Features */}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {vehicle.features.slice(0, 3).map((feat, idx) => (
                        <span key={idx} className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">
                          {feat}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Refundable Deposit</span>
                      <span className="text-xs font-bold text-slate-700 font-mono">
                        {formatCurrency(vehicle.deposit, currentTenant.currency)}
                      </span>
                    </div>

                    <button
                      id={`book-vehicle-btn-${vehicle.id}`}
                      onClick={() => handleSelectVehicle(vehicle)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Reserve Now</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Guest Reservation Modal */}
      {selectedVehicle && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Reserve {selectedVehicle.name}</h3>
                  <p className="text-xs text-slate-400">Live verified pricing & instant booking confirmation</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedVehicle(null)}
                className="text-slate-400 hover:text-white text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmitBooking} className="p-6 overflow-y-auto space-y-5">
              {/* Error banner */}
              {errorMessage && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Step 1: Trip Dates & Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pickup Date & Time</label>
                  <input
                    type="datetime-local"
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Return Date & Time</label>
                  <input
                    type="datetime-local"
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pickup & Return Station</label>
                  <select
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium"
                  >
                    {currentTenant.locations.map(loc => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Step 2: Protection & Add-ons */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">Select Protection Package</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { id: 'none', title: 'Declined', price: '₹0', desc: 'Customer takes full collision & theft liability' },
                    { id: 'basic', title: 'Basic Cover', price: '₹9/day', desc: 'Standard collision damage waiver' },
                    { id: 'premium', title: 'Premium Shield', price: '₹18/day', desc: 'Zero deductible, roadside assistance, tire cover' }
                  ].map(plan => (
                    <button
                      type="button"
                      key={plan.id}
                      onClick={() => setInsuranceTier(plan.id as any)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                        insuranceTier === plan.id
                          ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">{plan.title}</span>
                        <span className="text-[11px] font-bold text-emerald-700">{plan.price}</span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 leading-snug">{plan.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Step 2b: Optional Equipment & Add-ons */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">Optional Equipment & Add-ons</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PUBLIC_ADD_ONS.map(addon => {
                    const isSelected = selectedAddOns.includes(addon.id);
                    return (
                      <button
                        type="button"
                        key={addon.id}
                        onClick={() => handleToggleAddOn(addon.id)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900">{addon.name}</span>
                          <span className="text-[11px] font-bold text-emerald-700">{addon.price}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1 leading-snug">{addon.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 3: Guest Customer Details */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-800">Customer Details (Guest Booking)</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Rahul Sharma"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Phone Number *</label>
                    <input
                      type="tel"
                      placeholder="e.g. +91 98765 43210"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Email (Optional)</label>
                    <input
                      type="email"
                      placeholder="e.g. rahul@example.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Address / City (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Indiranagar, Bengaluru"
                      value={customerAddress}
                      onChange={(e) => setCustomerAddress(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Driver License / ID (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. DL-0420110012345"
                      value={driverLicenseNumber}
                      onChange={(e) => setDriverLicenseNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">
                  * Physical driver license is verified in person by station dispatch during pickup.
                </p>

                {/* Anti-Bot Verification Challenge */}
                <BotVerification
                  isVerified={isBotVerified}
                  onVerify={(token) => {
                    setCaptchaToken(token);
                    setIsBotVerified(true);
                    setErrorMessage(null);
                  }}
                  onExpireOrReset={() => {
                    setCaptchaToken('');
                    setIsBotVerified(false);
                  }}
                />
              </div>

              {/* Pricing Breakdown (Server-Calculated Canonical) */}
              {quote && (
                <div className="p-4 bg-slate-900 text-white rounded-xl space-y-2 text-xs">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Base Duration ({quote.durationUnits} {quote.rateType}s × {formatCurrency(quote.rateAmount, currentTenant.currency)})</span>
                    <span>{formatCurrency(quote.basePrice, currentTenant.currency)}</span>
                  </div>
                  {quote.insuranceTotal > 0 && (
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Protection Plan ({insuranceTier})</span>
                      <span>{formatCurrency(quote.insuranceTotal, currentTenant.currency)}</span>
                    </div>
                  )}
                  {quote.addOnsTotal > 0 && (
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Selected Equipment & Add-ons</span>
                      <span>{formatCurrency(quote.addOnsTotal, currentTenant.currency)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Sales Tax & Surcharges ({currentTenant.taxRate}%)</span>
                    <span>{formatCurrency(quote.tax, currentTenant.currency)}</span>
                  </div>
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between font-bold text-sm">
                    <span className="text-white">Estimated Rental Total</span>
                    <span className="text-emerald-400 text-base">{formatCurrency(quote.totalAmount, currentTenant.currency)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>Refundable Security Deposit (Held on card at pickup)</span>
                    <span className="font-mono">{formatCurrency(quote.depositAmount, currentTenant.currency)}</span>
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedVehicle(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bookingSubmitting || !quote}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>{bookingSubmitting ? 'Securing Reservation...' : 'Confirm & Reserve Vehicle'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
