import React, { useState, useMemo } from 'react';
import {
  X,
  Calendar,
  Car,
  User,
  ShieldCheck,
  Plus,
  Check,
  Clock,
  DollarSign,
  AlertCircle,
  MapPin,
  FileCheck
} from 'lucide-react';
import { Vehicle, Customer, Rental, Tenant, AddOnItem, Enquiry } from '../types.js';
import { formatCurrency, calculateDaysBetween } from '../lib/utils.js';

interface NewBookingModalProps {
  tenant: Tenant;
  vehicles: Vehicle[];
  customers: Customer[];
  preselectedVehicle?: Vehicle;
  prefillEnquiry?: Enquiry;
  onClose: () => void;
  onCreateRental: (rental: Partial<Rental>) => Promise<void>;
  onCreateCustomer: (customer: Partial<Customer>) => Promise<Customer>;
}

export const NewBookingModal: React.FC<NewBookingModalProps> = ({
  tenant,
  vehicles,
  customers,
  preselectedVehicle,
  prefillEnquiry,
  onClose,
  onCreateRental,
  onCreateCustomer,
}) => {
  // If prefilling from customer enquiry or preselected vehicle, jump to vehicle/dates step
  const [step, setStep] = useState<number>(preselectedVehicle || prefillEnquiry ? 2 : 1);

  // Match existing customer if prefill email matches, otherwise default
  const matchedCustomer = prefillEnquiry
    ? customers.find(c => c.email.toLowerCase() === prefillEnquiry.customerEmail.toLowerCase())
    : null;

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(matchedCustomer?.id || customers[0]?.id || '');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(
    preselectedVehicle?.id || prefillEnquiry?.preferredVehicleId || vehicles[0]?.id || ''
  );

  // Date states
  const now = new Date();
  const defaultStart = prefillEnquiry?.startDate ? prefillEnquiry.startDate.slice(0, 16) : now.toISOString().slice(0, 16);
  const defaultEnd = prefillEnquiry?.endDate ? prefillEnquiry.endDate.slice(0, 16) : new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 16);

  const [startDate, setStartDate] = useState<string>(defaultStart);
  const [endDate, setEndDate] = useState<string>(defaultEnd);
  const [pickupLocation, setPickupLocation] = useState<string>(tenant.locations[0] || 'Main Hub');
  const [dropoffLocation, setDropoffLocation] = useState<string>(tenant.locations[0] || 'Main Hub');

  // Add-ons & Insurance
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [selectedInsuranceTier, setSelectedInsuranceTier] = useState<'none' | 'basic' | 'premium'>('basic');
  const [paymentMethod, setPaymentMethod] = useState<'credit_card' | 'cash' | 'stripe' | 'wire'>('credit_card');

  // Fast new customer state
  const [showNewCustForm, setShowNewCustForm] = useState(prefillEnquiry && !matchedCustomer ? true : false);
  const [newCustName, setNewCustName] = useState(prefillEnquiry?.customerName || '');
  const [newCustEmail, setNewCustEmail] = useState(prefillEnquiry?.customerEmail || '');
  const [newCustPhone, setNewCustPhone] = useState(prefillEnquiry?.customerPhone || '');
  const [newCustLicense, setNewCustLicense] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Available vehicles
  const availableVehicles = vehicles.filter(v => v.status === 'available' || v.id === selectedVehicleId);
  const currentVehicle = vehicles.find(v => v.id === selectedVehicleId) || vehicles[0];
  const currentCustomer = customers.find(c => c.id === selectedCustomerId);

  // Duration calculation
  const durationDays = useMemo(() => {
    return calculateDaysBetween(startDate, endDate);
  }, [startDate, endDate]);

  // Pricing add-ons definition - reconciled with server canonical catalog
  const ADD_ON_OPTIONS: AddOnItem[] = [
    { id: 'helmet', name: 'Safety Helmet', price: 5, type: 'daily' },
    { id: 'gps', name: 'GPS Navigation System', price: 10, type: 'daily' },
    { id: 'child_seat', name: 'Child Safety Seat', price: 12, type: 'daily' },
    { id: 'additional_driver', name: 'Additional Driver Coverage', price: 15, type: 'daily' },
    { id: 'roadside', name: 'Premium Roadside Assistance', price: 8, type: 'daily' },
    { id: 'prepaid_fuel', name: 'Prepaid Fuel / Fast Charge Option', price: 75, type: 'fixed' },
    { id: 'delivery_service', name: 'Hub Delivery Service', price: 50, type: 'fixed' },
    { id: 'cleaning_fee', name: 'Post-Trip Detailing', price: 40, type: 'fixed' },
    { id: 'bike_rack', name: 'Luggage & Bike Rack', price: 15, type: 'daily' },
    { id: 'ski_rack', name: 'Ski & Snowboard Rack', price: 15, type: 'daily' }
  ];

  // Pricing math
  const basePrice = (currentVehicle ? currentVehicle.dailyRate : 60) * durationDays;

  const addOnsTotal = selectedAddOns.reduce((acc, id) => {
    const item = ADD_ON_OPTIONS.find(a => a.id === id);
    if (!item) return acc;
    return acc + (item.type === 'daily' ? item.price * durationDays : item.price);
  }, 0);

  const insuranceDaily = selectedInsuranceTier === 'premium' ? 18 : selectedInsuranceTier === 'basic' ? 9 : 0;
  const insuranceTotal = insuranceDaily * durationDays;

  const subtotal = basePrice + addOnsTotal + insuranceTotal;
  const tax = Math.round((subtotal * (tenant.taxRate / 100)) * 100) / 100;
  const totalAmount = Math.round((subtotal + tax) * 100) / 100;
  const depositAmount = currentVehicle ? currentVehicle.deposit : tenant.securityDepositDefault;

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName || !newCustEmail) return;
    const created = await onCreateCustomer({
      name: newCustName,
      email: newCustEmail,
      phone: newCustPhone || '+1 (555) 000-0000',
      driverLicense: {
        number: newCustLicense || 'DL-PENDING',
        stateOrCountry: 'USA',
        expiryDate: '2028-01-01',
        verified: false
      },
      address: 'Pending Verification',
      status: 'active'
    });
    setSelectedCustomerId(created.id);
    setShowNewCustForm(false);
  };

  const handleCompleteBooking = async () => {
    setErrorMessage(null);
    if (!currentVehicle || !currentCustomer) {
      setErrorMessage('Please select both a vehicle and a customer.');
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      setErrorMessage('Return date must be strictly after pickup date.');
      return;
    }

    setIsSubmitting(true);
    try {
      const rentalPayload: Partial<Rental> = {
        tenantId: tenant.id,
        customerId: currentCustomer.id,
        customerName: currentCustomer.name,
        customerEmail: currentCustomer.email,
        customerPhone: currentCustomer.phone,
        vehicleId: currentVehicle.id,
        vehicleName: currentVehicle.name,
        vehicleType: currentVehicle.type,
        vehiclePlate: currentVehicle.licensePlate,
        vehicleImage: currentVehicle.imageUrl,
        pickupLocation,
        dropoffLocation,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        status: 'confirmed',
        rentalRateType: 'daily',
        rateAmount: currentVehicle.dailyRate,
        durationUnits: durationDays,
        basePrice,
        addOns: selectedAddOns.map(id => {
          const item = ADD_ON_OPTIONS.find(a => a.id === id)!;
          return {
            id: item.id,
            name: item.name,
            price: item.type === 'daily' ? item.price * durationDays : item.price
          };
        }),
        insuranceOption: {
          name: selectedInsuranceTier === 'premium' ? 'Full Comprehensive Waiver' : selectedInsuranceTier === 'basic' ? 'Standard Road & Collision Protection' : 'Declined / Self Insured',
          dailyRate: insuranceDaily,
          total: insuranceTotal
        },
        discount: 0,
        tax,
        totalAmount,
        depositAmount,
        depositStatus: 'held',
        paymentStatus: 'paid',
        paymentMethod
      };

      await onCreateRental(rentalPayload);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900">Create New Reservation</h2>
            <p className="text-xs text-slate-500">
              Book a vehicle with dates, rates, protection waivers, and deposit hold
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Wizard Steps indicator */}
        <div className="px-6 py-2.5 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-xs">
          {[
            { num: 1, label: 'Customer' },
            { num: 2, label: 'Vehicle' },
            { num: 3, label: 'Dates & Location' },
            { num: 4, label: 'Add-Ons & Pricing' }
          ].map(s => (
            <button
              key={s.num}
              onClick={() => setStep(s.num)}
              className={`flex items-center gap-1.5 font-semibold cursor-pointer ${
                step === s.num
                  ? 'text-emerald-700'
                  : step > s.num
                    ? 'text-slate-700'
                    : 'text-slate-400'
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step === s.num
                  ? 'bg-emerald-600 text-white'
                  : step > s.num
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-200 text-slate-500'
              }`}>
                {s.num}
              </span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Wizard Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* STEP 1: Select Customer */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800">Select Existing Renter</label>
                <button
                  type="button"
                  onClick={() => setShowNewCustForm(!showNewCustForm)}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showNewCustForm ? 'Choose from list' : 'Register new customer'}</span>
                </button>
              </div>

              {showNewCustForm ? (
                <form onSubmit={handleCreateCustomer} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <div className="text-xs font-bold text-slate-800">Fast Customer Registration</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Full Name</label>
                      <input
                        type="text"
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        placeholder="John Doe"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Email</label>
                      <input
                        type="email"
                        value={newCustEmail}
                        onChange={(e) => setNewCustEmail(e.target.value)}
                        placeholder="john@example.com"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Phone</label>
                      <input
                        type="tel"
                        value={newCustPhone}
                        onChange={(e) => setNewCustPhone(e.target.value)}
                        placeholder="+1 (555) 123-4567"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-1">Driver's License / ID #</label>
                      <input
                        type="text"
                        value={newCustLicense}
                        onChange={(e) => setNewCustLicense(e.target.value)}
                        placeholder="D8392100"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-2xs"
                  >
                    Save & Select Customer
                  </button>
                </form>
              ) : (
                <div className="space-y-2">
                  {customers.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedCustomerId(c.id)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        selectedCustomerId === c.id
                          ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 font-bold flex items-center justify-center text-xs">
                          {c.name.charAt(0)}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800">{c.name}</span>
                            {c.status === 'vip' && (
                              <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded">
                                VIP
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500">{c.email} • {c.phone}</span>
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        <span className="text-[11px] text-slate-400 block font-mono">
                          License: {c.driverLicense.number}
                        </span>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                          Verified ID
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Select Vehicle */}
          {step === 2 && (
            <div className="space-y-4">
              <label className="text-xs font-bold text-slate-800 block">
                Choose Available Fleet Vehicle
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-72 overflow-y-auto">
                {availableVehicles.map((v) => (
                  <div
                    key={v.id}
                    onClick={() => setSelectedVehicleId(v.id)}
                    className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all ${
                      selectedVehicleId === v.id
                        ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500 shadow-xs'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <img
                      src={v.imageUrl}
                      alt={v.name}
                      className="w-16 h-12 object-cover rounded-lg border border-slate-200 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-slate-400">
                          {v.type}
                        </span>
                        <span className="font-mono text-[10px] font-bold text-slate-600">
                          {v.licensePlate}
                        </span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 truncate">
                        {v.name}
                      </h4>
                      <div className="text-xs font-extrabold text-emerald-600 mt-1">
                        {formatCurrency(v.dailyRate, tenant.currency)} <span className="text-[10px] text-slate-400 font-normal">/day</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 3: Dates & Location */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Pickup Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Return Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold"
                    required
                  />
                </div>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between text-xs text-emerald-900 font-semibold">
                <span>Calculated Duration:</span>
                <span className="text-sm font-bold bg-emerald-200/70 text-emerald-950 px-2 py-0.5 rounded">
                  {durationDays} Day{durationDays > 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Pickup Station
                  </label>
                  <select
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                  >
                    {tenant.locations.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Return Station
                  </label>
                  <select
                    value={dropoffLocation}
                    onChange={(e) => setDropoffLocation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                  >
                    {tenant.locations.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Add-Ons, Protection & Financial Summary */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Protection Tiers */}
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-2">
                  Damage & Theft Protection Waiver
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'none', label: 'Basic Liability', rate: 0, desc: 'Renter covers full damages' },
                    { id: 'basic', label: 'Standard Protection', rate: 9, desc: '₹500 max deductible' },
                    { id: 'premium', label: 'Full Zero-Excess', rate: 18, desc: 'Zero liability coverage' }
                  ].map((tier) => (
                    <div
                      key={tier.id}
                      onClick={() => setSelectedInsuranceTier(tier.id as any)}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                        selectedInsuranceTier === tier.id
                          ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-900">{tier.label}</div>
                      <div className="text-[11px] font-extrabold text-emerald-600 mt-0.5">
                        +{formatCurrency(tier.rate, tenant.currency)}/day
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">{tier.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add-ons Checklist */}
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-2">
                  Optional Equipment & Add-ons
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ADD_ON_OPTIONS.map((addon) => {
                    const isChecked = selectedAddOns.includes(addon.id);
                    return (
                      <div
                        key={addon.id}
                        onClick={() => {
                          if (isChecked) {
                            setSelectedAddOns(selectedAddOns.filter(x => x !== addon.id));
                          } else {
                            setSelectedAddOns([...selectedAddOns, addon.id]);
                          }
                        }}
                        className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          isChecked
                            ? 'border-emerald-500 bg-emerald-50/40 text-emerald-950 font-semibold'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-medium leading-tight">{addon.name}</div>
                          <div className="text-[10px] text-slate-400">
                            +{formatCurrency(addon.price, tenant.currency)} {addon.type === 'daily' ? '/day' : 'fixed'}
                          </div>
                        </div>
                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                          isChecked ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                        }`}>
                          {isChecked && <Check className="w-3 h-3" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as any)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium"
                >
                  <option value="credit_card">Credit Card (Stripe Integrated)</option>
                  <option value="cash">Cash / Front Desk Terminal</option>
                  <option value="wire">Bank Wire / Corporate Invoice</option>
                </select>
              </div>

              {/* Price Calculation Box */}
              <div className="p-4 bg-slate-900 text-white rounded-xl space-y-2">
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Rental Charge ({durationDays} Days @ {formatCurrency(currentVehicle?.dailyRate || 0, tenant.currency)})</span>
                  <span>{formatCurrency(basePrice, tenant.currency)}</span>
                </div>
                {addOnsTotal > 0 && (
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>Add-ons & Equipment</span>
                    <span>{formatCurrency(addOnsTotal, tenant.currency)}</span>
                  </div>
                )}
                {insuranceTotal > 0 && (
                  <div className="flex justify-between text-xs text-slate-300">
                    <span>Protection Waiver</span>
                    <span>{formatCurrency(insuranceTotal, tenant.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs text-slate-300">
                  <span>Sales Tax ({tenant.taxRate}%)</span>
                  <span>{formatCurrency(tax, tenant.currency)}</span>
                </div>
                <div className="pt-2 border-t border-slate-800 flex justify-between items-baseline">
                  <span className="text-xs font-bold text-slate-200">Total Rental Cost:</span>
                  <span className="text-lg font-extrabold text-emerald-400">
                    {formatCurrency(totalAmount, tenant.currency)}
                  </span>
                </div>
                <div className="pt-1 flex justify-between text-[11px] text-amber-400/90 font-medium">
                  <span>Refundable Security Deposit (Hold):</span>
                  <span>{formatCurrency(depositAmount, tenant.currency)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50/50">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 cursor-pointer"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-xs cursor-pointer"
            >
              Continue to {step === 1 ? 'Vehicle' : step === 2 ? 'Dates' : 'Pricing'}
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleCompleteBooking}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-2"
            >
              {isSubmitting ? 'Confirming...' : 'Confirm & Create Reservation'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
