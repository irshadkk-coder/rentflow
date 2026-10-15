export type VehicleType = 'car' | 'bike' | 'scooter' | 'ebike' | 'motorcycle';

export type VehicleStatus = 'available' | 'rented' | 'maintenance' | 'reserved' | 'cleaning';

export type RentalStatus = 'pending' | 'confirmed' | 'active' | 'completed' | 'cancelled' | 'overdue';

export type PaymentStatus = 'paid' | 'partial' | 'pending' | 'refunded';

export type UserRole = 'owner' | 'manager' | 'staff';

export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  branch?: string;
  isActive?: boolean;
  avatarUrl?: string;
  createdAt?: string;
  isDemo?: boolean;
}

export type TeamInvitationStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

export interface TeamMember {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: UserRole;
  branch?: string;
  isActive: boolean;
  createdAt?: string;
}

export interface TeamInvitation {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'manager' | 'staff';
  branch?: string;
  status: TeamInvitationStatus;
  invitedByName: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  cancelledAt?: string;
}

export interface InviteTeamMemberPayload {
  name: string;
  email: string;
  role: 'manager' | 'staff';
  branch?: string;
}

export interface AcceptInvitationPayload {
  token: string;
  password: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  currencyCode: string;
  taxRate: number;
  securityDepositDefault: number;
  lateFeePerHour: number;
  fuelPenaltyPerPercent?: number;
  locations: string[];
  categories: VehicleType[];
}

export interface Branch {
  id: string;
  tenantId?: string;
  name: string;
  address: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  phone?: string;
  contactNumber?: string;
  isActive: boolean;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PublicBranch {
  id: string;
  name: string;
  address: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  phone?: string;
  distanceKm?: number;
}

export interface PublicVehicle {
  id: string;
  name: string;
  type: VehicleType;
  category: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  location: string;
  hourlyRate: number;
  dailyRate: number;
  weeklyRate: number;
  deposit: number;
  seats?: number;
  transmission?: string;
  features: string[];
  imageUrl: string;
}

export interface QuoteRequest {
  vehicleId: string;
  startDate: string;
  endDate: string;
  rentalRateType?: 'hourly' | 'daily' | 'weekly';
  addOnIds?: string[];
  insuranceTier?: 'none' | 'basic' | 'premium';
  discountCode?: string;
}

export interface PricingQuote {
  vehicleId: string;
  vehicleName: string;
  rentalRateType: 'hourly' | 'daily' | 'weekly';
  rateAmount: number;
  durationUnits: number;
  basePrice: number;
  addOns: { id: string; name: string; price: number }[];
  insuranceOption: { name: string; dailyRate: number; total: number };
  discount: number;
  subtotal: number;
  taxRate: number;
  tax: number;
  depositAmount: number;
  totalAmount: number;
}

export interface Vehicle {
  id: string;
  tenantId: string;
  name: string;
  type: VehicleType;
  category: string;
  brand: string;
  model: string;
  year: number;
  licensePlate: string;
  vin?: string;
  color: string;
  status: VehicleStatus;
  location: string;
  hourlyRate: number;
  dailyRate: number;
  weeklyRate: number;
  deposit: number;
  odometer: number;
  fuelLevel: number;
  batteryLevel?: number;
  transmission?: 'Automatic' | 'Manual' | 'Electric';
  seats?: number;
  features: string[];
  imageUrl: string;
  lastServiceDate: string;
  nextServiceOdometer: number;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone: string;
  driverLicense: {
    number: string;
    stateOrCountry: string;
    expiryDate: string;
    verified: boolean;
  };
  address: string;
  totalRentals: number;
  totalSpent: number;
  rating: number;
  notes?: string;
  status: 'active' | 'vip' | 'restricted';
  createdAt: string;
}

export interface AddOnItem {
  id: string;
  name: string;
  price: number;
  type: 'daily' | 'fixed';
  selected?: boolean;
}

export interface CheckOutInspection {
  odometer: number;
  fuelOrBattery: number;
  existingDamages: string[];
  signedByCustomer: boolean;
  customerSignatureName: string;
  agentName: string;
  date: string;
  notes?: string;
}

export interface CheckInInspection {
  returnOdometer: number;
  returnFuelOrBattery: number;
  newDamages: string[];
  lateFee: number;
  fuelSurcharge: number;
  damageFee: number;
  refundedDeposit: number;
  agentName: string;
  date: string;
  notes?: string;
}

export interface Rental {
  id: string;
  rentalNumber: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  vehicleId: string;
  vehicleName: string;
  vehicleType: VehicleType;
  vehiclePlate: string;
  vehicleImage: string;
  pickupLocation: string;
  dropoffLocation: string;
  startDate: string;
  endDate: string;
  actualReturnDate?: string;
  status: RentalStatus;
  rentalRateType: 'hourly' | 'daily' | 'weekly';
  rateAmount: number;
  durationUnits: number;
  basePrice: number;
  addOns: { id: string; name: string; price: number }[];
  insuranceOption: { name: string; dailyRate: number; total: number };
  discount: number;
  tax: number;
  totalAmount: number;
  depositAmount: number;
  depositStatus: 'held' | 'refunded' | 'partially_deducted';
  paymentStatus: PaymentStatus;
  paymentMethod: 'credit_card' | 'cash' | 'stripe' | 'wire' | string;
  balanceDue?: number;
  paidAmount?: number;
  paymentHistory?: PaymentRecord[];
  invoiceId?: string;
  checkOutInspection?: CheckOutInspection;
  checkInInspection?: CheckInInspection;
  notes?: string;
  createdAt: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PaymentRecord {
  id: string;
  date: string;
  amount: number;
  method: string;
  reference: string;
  notes?: string;
  staffName?: string;
  staffId?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  tenantId: string;
  rentalId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  issueDate: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  paidAmount: number;
  balanceDue: number;
  status: 'paid' | 'unpaid' | 'overdue' | 'void';
  paymentHistory: PaymentRecord[];
}

export interface MaintenanceRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  vehicleName: string;
  vehiclePlate: string;
  serviceType: string;
  date: string;
  completedDate?: string;
  status: 'scheduled' | 'in_progress' | 'completed';
  odometerAtService: number;
  odometer?: number;
  cost: number;
  serviceProvider: string;
  notes: string;
}

export interface DashboardStats {
  totalVehicles: number;
  activeRentals: number;
  availableVehicles: number;
  maintenanceVehicles: number;
  fleetUtilizationRate: number;
  monthlyRevenue: number;
  revenueGrowth: number;
  overdueCount: number;
  todayPickups: number;
  todayDropoffs: number;
  revenueChart: { day: string; revenue: number; rentals: number }[];
  fleetDistribution: { name: string; value: number; color: string }[];
  recentActivity: {
    id: string;
    type: 'pickup' | 'dropoff' | 'maintenance' | 'payment';
    title: string;
    subtitle: string;
    time: string;
    statusBadge?: { text: string; variant: 'success' | 'warning' | 'info' | 'danger' };
  }[];
}

export type DashboardMetrics = DashboardStats;

export type EnquiryStatus = 'new' | 'contacted' | 'quoted' | 'converted' | 'lost';

export interface Enquiry {
  id: string;
  tenantId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  vehicleCategory?: string;
  preferredVehicleId?: string;
  preferredVehicleName?: string;
  startDate: string;
  endDate: string;
  estimatedBudget?: number;
  status: EnquiryStatus;
  notes?: string;
  source: 'website' | 'phone' | 'walk_in' | 'referral';
  convertedRentalId?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  action: string;
  entityType: 'rental' | 'vehicle' | 'customer' | 'tenant' | 'invoice' | 'maintenance' | 'enquiry';
  entityId: string;
  details: string;
  ipAddress?: string;
  timestamp: string;
}
