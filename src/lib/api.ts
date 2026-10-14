import {
  Tenant,
  Vehicle,
  Customer,
  Rental,
  Invoice,
  MaintenanceRecord,
  DashboardStats,
  User,
  PublicVehicle,
  PricingQuote,
  QuoteRequest,
  Enquiry,
  AuditLog,
  TeamMember,
  TeamInvitation,
  InviteTeamMemberPayload,
  AcceptInvitationPayload
} from '../types.js';

const TOKEN_KEY = 'rentflow_jwt_token';
const USER_KEY = 'rentflow_auth_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredAuth(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getStoredToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 401) {
    clearStoredAuth();
  }

  return res;
}

export const api = {
  // ----------------------------------------------------
  // AUTHENTICATION
  // ----------------------------------------------------
  async register(payload: {
    companyName: string;
    companyEmail: string;
    phone: string;
    ownerName: string;
    ownerEmail: string;
    password: string;
    confirmPassword: string;
    captchaToken?: string;
  }): Promise<{ success: boolean; emailVerificationRequired?: boolean; email?: string; message?: string; tenant?: Tenant }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      let message = errData.error || 'Registration failed';
      const fieldErrors: Record<string, string> = {};
      const knownFields = [
        'companyName', 'companyEmail', 'phone',
        'ownerName', 'ownerEmail', 'password', 'confirmPassword'
      ];
      for (const field of knownFields) {
        if (errData[field]) {
          const val = errData[field];
          fieldErrors[field] = Array.isArray(val) ? val[0] : String(val);
        }
      }
      const err: any = new Error(message);
      err.fieldErrors = fieldErrors;
      err.data = errData;
      throw err;
    }
    const data = await res.json();
    return data;
  },

  async verifyEmailOtp(payload: { email: string; otp: string }): Promise<{ success: boolean; message: string; email?: string }> {
    const res = await fetch('/api/auth/verify-email-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || 'Email verification failed.');
      err.data = data;
      throw err;
    }
    return data;
  },

  async verifyEmail(token: string): Promise<{ success: boolean; message: string; email?: string }> {
    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Email verification failed.');
    }
    return data;
  },

  async resendVerification(email: string): Promise<{ success: boolean; message: string; cooldownSeconds?: number }> {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || 'Failed to resend verification code.');
      err.data = data;
      throw err;
    }
    return data;
  },

  async forgotPassword(email: string): Promise<{ success: boolean; message: string; cooldownSeconds?: number }> {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || 'Failed to request password reset.');
      err.data = data;
      throw err;
    }
    return data;
  },

  async verifyPasswordResetOtp(payload: { email: string; otp: string }): Promise<{ success: boolean; message: string; resetToken: string }> {
    const res = await fetch('/api/auth/verify-password-reset-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(data.error || 'Failed to verify password reset code.');
      err.data = data;
      throw err;
    }
    return data;
  },

  async resetPassword(payload: {
    email: string;
    resetToken: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error || 'Password reset failed.';
      const fieldErrors: Record<string, string> = {};
      const knownFields = ['newPassword', 'confirmPassword', 'password'];
      for (const field of knownFields) {
        if (data[field]) {
          const val = data[field];
          fieldErrors[field] = Array.isArray(val) ? val[0] : String(val);
        }
      }
      const err: any = new Error(message);
      err.fieldErrors = fieldErrors;
      err.data = data;
      throw err;
    }
    return data;
  },

  async login(email: string, password: string): Promise<{ token: string; user: User }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error: any = new Error(err.error || 'Authentication failed');
      if (err.unverified) {
        error.unverified = true;
        error.email = err.email || email;
      }
      throw error;
    }
    const data = await res.json();
    setStoredAuth(data.token, data.user);
    return data;
  },

  async switchDemoUser(email: string): Promise<{ token: string; user: User }> {
    const token = getStoredToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch('/api/auth/switch-demo-user', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to switch demo user');
    }
    const data = await res.json();
    setStoredAuth(data.token, data.user);
    return data;
  },

  async getCurrentUser(): Promise<User | null> {
    const token = getStoredToken();
    if (!token) return null;

    const res = await fetchWithAuth('/api/auth/me');
    if (!res.ok) {
      clearStoredAuth();
      return null;
    }
    const data = await res.json();
    return data.user;
  },

  async getTeamUsers(): Promise<User[]> {
    const res = await fetchWithAuth('/api/auth/users');
    if (!res.ok) throw new Error('Failed to fetch team users');
    return res.json();
  },

  logout() {
    clearStoredAuth();
  },

  // ----------------------------------------------------
  // TENANTS
  // ----------------------------------------------------
  async getTenants(): Promise<Tenant[]> {
    const res = await fetchWithAuth('/api/tenants');
    if (!res.ok) throw new Error('Failed to fetch tenants');
    return res.json();
  },

  async getTenant(id: string): Promise<Tenant> {
    const res = await fetchWithAuth(`/api/tenants/${id}`);
    if (!res.ok) throw new Error('Failed to fetch tenant settings');
    return res.json();
  },

  async updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant> {
    const res = await fetchWithAuth(`/api/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update tenant');
    }
    return res.json();
  },

  // ----------------------------------------------------
  // VEHICLES
  // ----------------------------------------------------
  async getVehicles(tenantId?: string, location?: string): Promise<Vehicle[]> {
    const url = location && location !== 'ALL'
      ? `/api/vehicles?location=${encodeURIComponent(location)}`
      : '/api/vehicles';
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch vehicles');
    }
    return res.json();
  },

  async getVehicle(id: string): Promise<Vehicle> {
    const res = await fetchWithAuth(`/api/vehicles/${id}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch vehicle');
    }
    return res.json();
  },

  async createVehicle(vehicle: Partial<Vehicle>): Promise<Vehicle> {
    const res = await fetchWithAuth('/api/vehicles', {
      method: 'POST',
      body: JSON.stringify(vehicle)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create vehicle');
    }
    return res.json();
  },

  async updateVehicle(id: string, updates: Partial<Vehicle>): Promise<Vehicle> {
    const res = await fetchWithAuth(`/api/vehicles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update vehicle');
    }
    return res.json();
  },

  async deleteVehicle(id: string): Promise<boolean> {
    const res = await fetchWithAuth(`/api/vehicles/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete vehicle');
    }
    return true;
  },

  // ----------------------------------------------------
  // CUSTOMERS
  // ----------------------------------------------------
  async getCustomers(tenantId?: string): Promise<Customer[]> {
    const res = await fetchWithAuth('/api/customers');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch customers');
    }
    return res.json();
  },

  async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    const res = await fetchWithAuth('/api/customers', {
      method: 'POST',
      body: JSON.stringify(customer)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create customer');
    }
    return res.json();
  },

  async updateCustomer(id: string, updates: Partial<Customer>): Promise<Customer> {
    const res = await fetchWithAuth(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update customer');
    }
    return res.json();
  },

  async deleteCustomer(id: string): Promise<boolean> {
    const res = await fetchWithAuth(`/api/customers/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete customer');
    }
    return true;
  },

  // ----------------------------------------------------
  // RENTALS & PRICING
  // ----------------------------------------------------
  async getRentals(tenantId?: string, location?: string): Promise<Rental[]> {
    const url = location && location !== 'ALL'
      ? `/api/rentals?location=${encodeURIComponent(location)}`
      : '/api/rentals';
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch rentals');
    }
    return res.json();
  },

  async getQuote(params: QuoteRequest): Promise<PricingQuote> {
    const res = await fetchWithAuth('/api/quote', {
      method: 'POST',
      body: JSON.stringify(params)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to calculate quote');
    }
    return res.json();
  },

  async createRental(rental: Partial<Rental>): Promise<Rental> {
    const res = await fetchWithAuth('/api/rentals', {
      method: 'POST',
      body: JSON.stringify(rental)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create rental reservation');
    }
    return res.json();
  },

  async updateRental(id: string, updates: Partial<Rental>): Promise<Rental> {
    const res = await fetchWithAuth(`/api/rentals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update rental');
    }
    return res.json();
  },

  async checkInRental(id: string, inspection: any, returnDate?: string): Promise<Rental> {
    const res = await fetchWithAuth(`/api/rentals/${id}/check-in`, {
      method: 'POST',
      body: JSON.stringify({ inspection, returnDate })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to complete check-in inspection');
    }
    return res.json();
  },

  async checkOutRental(id: string, inspection: any): Promise<Rental> {
    const res = await fetchWithAuth(`/api/rentals/${id}/check-out`, {
      method: 'POST',
      body: JSON.stringify({ inspection })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to complete check-out departure');
    }
    return res.json();
  },

  // ----------------------------------------------------
  // INVOICES & PAYMENTS
  // ----------------------------------------------------
  async getInvoices(tenantId?: string, location?: string): Promise<Invoice[]> {
    const url = location && location !== 'ALL'
      ? `/api/invoices?location=${encodeURIComponent(location)}`
      : '/api/invoices';
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch invoices');
    }
    return res.json();
  },

  async recordInvoicePayment(id: string, amount: number, method: string, reference?: string, notes?: string): Promise<Invoice> {
    const res = await fetchWithAuth(`/api/invoices/${id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ amount, method, reference, notes })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to record invoice payment');
    }
    return res.json();
  },

  async recordPayment(id: string, amount: number, method: string, reference?: string, notes?: string): Promise<Invoice> {
    return this.recordInvoicePayment(id, amount, method, reference, notes);
  },

  async recordRentalPayment(rentalId: string, amount: number, method: string, reference?: string, notes?: string): Promise<Rental> {
    const res = await fetchWithAuth(`/api/rentals/${rentalId}/pay`, {
      method: 'POST',
      body: JSON.stringify({ amount, method, reference, notes })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to record rental payment');
    }
    return res.json();
  },

  // ----------------------------------------------------
  // MAINTENANCE
  // ----------------------------------------------------
  async getMaintenance(tenantId?: string, location?: string): Promise<MaintenanceRecord[]> {
    const url = location && location !== 'ALL'
      ? `/api/maintenance?location=${encodeURIComponent(location)}`
      : '/api/maintenance';
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch maintenance records');
    }
    return res.json();
  },

  async createMaintenance(record: Partial<MaintenanceRecord>): Promise<MaintenanceRecord> {
    const res = await fetchWithAuth('/api/maintenance', {
      method: 'POST',
      body: JSON.stringify(record)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to schedule maintenance');
    }
    return res.json();
  },

  async updateMaintenance(id: string, updates: Partial<MaintenanceRecord>): Promise<MaintenanceRecord> {
    const res = await fetchWithAuth(`/api/maintenance/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update maintenance record');
    }
    return res.json();
  },

  async completeMaintenance(id: string): Promise<MaintenanceRecord> {
    return this.updateMaintenance(id, {
      status: 'completed',
      completedDate: new Date().toISOString().split('T')[0]
    });
  },

  // ----------------------------------------------------
  // ANALYTICS
  // ----------------------------------------------------
  async getAnalytics(tenantId?: string, location?: string): Promise<DashboardStats> {
    const url = location && location !== 'ALL'
      ? `/api/analytics?location=${encodeURIComponent(location)}`
      : '/api/analytics';
    const res = await fetchWithAuth(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch analytics metrics');
    }
    return res.json();
  },

  async getDashboardMetrics(tenantId?: string, location?: string): Promise<DashboardStats> {
    return this.getAnalytics(tenantId, location);
  },

  // ----------------------------------------------------
  // ENQUIRIES & LEADS
  // ----------------------------------------------------
  async getEnquiries(tenantId?: string): Promise<Enquiry[]> {
    const res = await fetchWithAuth('/api/enquiries');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch enquiries');
    }
    const data = await res.json();
    return Array.isArray(data) ? data : data.data;
  },

  async createEnquiry(enquiry: Partial<Enquiry>): Promise<Enquiry> {
    const res = await fetchWithAuth('/api/enquiries', {
      method: 'POST',
      body: JSON.stringify(enquiry)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create enquiry');
    }
    return res.json();
  },

  async updateEnquiry(id: string, updates: Partial<Enquiry>): Promise<Enquiry> {
    const res = await fetchWithAuth(`/api/enquiries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to update enquiry');
    }
    return res.json();
  },

  async convertEnquiry(id: string, rentalId?: string): Promise<{ success: boolean; enquiry: Enquiry }> {
    const res = await fetchWithAuth(`/api/enquiries/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify({ rentalId })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to convert enquiry');
    }
    return res.json();
  },

  // ----------------------------------------------------
  // AUDIT LOGS
  // ----------------------------------------------------
  async getAuditLogs(limit = 100): Promise<AuditLog[]> {
    const res = await fetchWithAuth(`/api/audit-logs?limit=${limit}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch audit trail');
    }
    return res.json();
  },

  // ----------------------------------------------------
  // SECURED RESET
  // ----------------------------------------------------
  async resetDatabase(): Promise<void> {
    const res = await fetchWithAuth('/api/reset', { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to reset database');
    }
  },

  async resetData(): Promise<void> {
    return this.resetDatabase();
  },

  // ----------------------------------------------------
  // PUBLIC STOREFRONT & CUSTOMER BOOKING FLOW (PHASE 4)
  // ----------------------------------------------------
  async publicGetBusiness(slug: string): Promise<Tenant> {
    const res = await fetch(`/api/public/business/${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error('Business not found');
    return res.json();
  },

  async publicGetVehicles(slug: string): Promise<PublicVehicle[]> {
    const res = await fetch(`/api/public/vehicles?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error('Failed to fetch available fleet');
    return res.json();
  },

  async publicGetQuote(payload: QuoteRequest & { slug: string }): Promise<PricingQuote> {
    const res = await fetch('/api/public/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to calculate quote');
    }
    return res.json();
  },

  async publicCreateBooking(bookingPayload: any): Promise<{
    success: boolean;
    bookingNumber: string;
    rentalId: string;
    vehicleName: string;
    startDate: string;
    endDate: string;
    totalAmount: number;
    depositAmount: number;
    status: string;
    message: string;
    duplicate?: boolean;
  }> {
    const res = await fetch('/api/public/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingPayload)
    });
    if (!res.ok) {
      let err: any = {};
      try {
        err = await res.json();
      } catch {
        // non-JSON response
      }
      const message = err.error || err.message || (err.errors ? Object.values(err.errors).flat().join(', ') : null) || 'Failed to submit booking reservation';
      throw new Error(message);
    }
    return res.json();
  },

  // ----------------------------------------------------
  // TEAM MANAGEMENT & INVITATIONS
  // ----------------------------------------------------
  async getTeamMembers(): Promise<{ members: TeamMember[]; invitations: TeamInvitation[] }> {
    const res = await fetchWithAuth('/api/team-members');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to fetch team members.');
    }
    return res.json();
  },

  async createTeamInvitation(payload: InviteTeamMemberPayload): Promise<{ message: string; invitation: TeamInvitation }> {
    const res = await fetchWithAuth('/api/team-invitations', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to send invitation.');
    }
    return res.json();
  },

  async resendTeamInvitation(invitationId: string): Promise<{ message: string; invitation: TeamInvitation }> {
    const res = await fetchWithAuth(`/api/team-invitations/${invitationId}/resend`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to resend invitation.');
    }
    return res.json();
  },

  async cancelTeamInvitation(invitationId: string): Promise<{ message: string; invitation: TeamInvitation }> {
    const res = await fetchWithAuth(`/api/team-invitations/${invitationId}/cancel`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to cancel invitation.');
    }
    return res.json();
  },

  async updateTeamMemberRole(memberId: string, role: 'manager' | 'staff'): Promise<{ message: string; member: TeamMember }> {
    const res = await fetchWithAuth(`/api/team-members/${memberId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to update member role.');
    }
    return res.json();
  },

  async deactivateTeamMember(memberId: string): Promise<{ message: string; member: TeamMember }> {
    const res = await fetchWithAuth(`/api/team-members/${memberId}/deactivate`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to deactivate team member.');
    }
    return res.json();
  },

  async reactivateTeamMember(memberId: string): Promise<{ message: string; member: TeamMember }> {
    const res = await fetchWithAuth(`/api/team-members/${memberId}/reactivate`, {
      method: 'POST'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to reactivate team member.');
    }
    return res.json();
  },

  async validateTeamInvitation(token: string): Promise<{
    valid: boolean;
    email: string;
    name: string;
    role: string;
    tenantName: string;
    expiresAt: string;
  }> {
    const res = await fetch(`/api/team-invitations/validate?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Invalid or expired invitation token.');
    }
    return res.json();
  },

  async acceptTeamInvitation(payload: AcceptInvitationPayload): Promise<{
    message: string;
    token: string;
    user: User;
  }> {
    const res = await fetch('/api/team-invitations/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to accept invitation.');
    }
    const data = await res.json();
    if (data.token && data.user) {
      setStoredAuth(data.token, data.user);
    }
    return data;
  }
};
