/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Tenant,
  Vehicle,
  Customer,
  Rental,
  Invoice,
  MaintenanceRecord,
  DashboardMetrics,
  User,
  Enquiry,
  AuditLog
} from './types.js';
import { api } from './lib/api.js';
import { formatCurrency } from './lib/utils.js';
import { isDemoModeActive, isDemoUser } from './lib/auth-utils.js';

import { Navbar } from './components/Navbar.js';
import { Sidebar, NavTab } from './components/Sidebar.js';
import { DashboardView } from './components/DashboardView.js';
import { FleetView } from './components/FleetView.js';
import { RentalsView } from './components/RentalsView.js';
import { TimelineView } from './components/TimelineView.js';
import { CustomersView } from './components/CustomersView.js';
import { EnquiriesView } from './components/EnquiriesView.js';
import { InvoicesView } from './components/InvoicesView.js';
import { MaintenanceView } from './components/MaintenanceView.js';
import { AuditLogsView } from './components/AuditLogsView.js';
import { SettingsView } from './components/SettingsView.js';
import { PublicBookingView } from './components/PublicBookingView.js';
import { LoginView } from './components/LoginView.js';
import { SignupView } from './components/SignupView.js';
import { VerifyEmailView } from './components/VerifyEmailView.js';
import { ForgotPasswordView } from './components/ForgotPasswordView.js';
import { VerifyPasswordResetOTPView } from './components/VerifyPasswordResetOTPView.js';
import { ResetPasswordView } from './components/ResetPasswordView.js';
import { AcceptInvitationView } from './components/AcceptInvitationView.js';

import { NewBookingModal } from './components/NewBookingModal.js';
import { CheckOutModal } from './components/CheckOutModal.js';
import { CheckInModal } from './components/CheckInModal.js';
import { RentalDetailModal } from './components/RentalDetailModal.js';
import { VehicleDetailModal } from './components/VehicleDetailModal.js';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  // Navigation
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  // Authentication & User Persona state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  // Multi-tenant state
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string>('tenant-1');
  const [currentTenant, setCurrentTenant] = useState<Tenant | null>(null);

  // Branch / Location filter state
  const [selectedLocation, setSelectedLocation] = useState<string>('ALL');

  // Domain data
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  // Loading & error/notification state
  const [loading, setLoading] = useState<boolean>(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessageToast, setErrorMessageToast] = useState<string | null>(null);

  // Password Reset flow state
  const [resetFlowEmail, setResetFlowEmail] = useState<string>('');
  const [resetFlowToken, setResetFlowToken] = useState<string>('');
  const [resetFlowStep, setResetFlowStep] = useState<'request' | 'verify' | 'reset'>('request');

  // Modal controls
  const [isNewBookingOpen, setIsNewBookingOpen] = useState<boolean>(false);
  const [bookingVehicle, setBookingVehicle] = useState<Vehicle | undefined>(undefined);
  const [prefillEnquiry, setPrefillEnquiry] = useState<Enquiry | undefined>(undefined);

  const [checkOutRental, setCheckOutRental] = useState<Rental | null>(null);
  const [checkInRental, setCheckInRental] = useState<Rental | null>(null);
  const [detailRental, setDetailRental] = useState<Rental | null>(null);
  const [detailVehicle, setDetailVehicle] = useState<Vehicle | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const showErrorToast = (msg: string) => {
    setErrorMessageToast(msg);
    setTimeout(() => {
      setErrorMessageToast(null);
    }, 5000);
  };

  // Synchronize URL path with activeTab, route guards, and tenant slug
  useEffect(() => {
    if (!isAuthReady) return;

    const path = location.pathname;

    // Public Customer Storefront
    if (path.startsWith('/store')) {
      setActiveTab('public-portal');
      const slug = path.split('/store/')[1]?.split('/')[0] || 'apex-rentals';
      if (!currentTenant || currentTenant.slug !== slug) {
        api.publicGetBusiness(slug).then(pt => {
          setCurrentTenant(pt);
          setCurrentTenantId(pt.id);
        }).catch(err => {
          console.error('Failed to load public tenant storefront:', err);
        });
      }
      return;
    }

    // Unauthenticated user -> permit /login, /signup, /verify-email, /forgot-password, /reset-password, /accept-invitation, redirect other routes to /login
    if (!currentUser) {
      const publicPaths = ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password', '/accept-invitation'];
      if (!publicPaths.includes(path)) {
        navigate('/login', { replace: true });
      }
      return;
    }

    // Authenticated user on auth routes -> redirect to dashboard
    if (['/login', '/signup', '/forgot-password', '/reset-password', '/accept-invitation'].includes(path)) {
      navigate('/dashboard', { replace: true });
      return;
    }

    // Authenticated route navigation
    if (path === '/fleet') {
      setActiveTab('fleet');
    } else if (path === '/rentals') {
      setActiveTab('rentals');
    } else if (path === '/timeline') {
      setActiveTab('timeline');
    } else if (path === '/customers') {
      setActiveTab('customers');
    } else if (path === '/enquiries') {
      setActiveTab('enquiries');
    } else if (path === '/invoices') {
      setActiveTab('invoices');
    } else if (path === '/maintenance') {
      setActiveTab('maintenance');
    } else if (path === '/audit-logs') {
      setActiveTab('audit-logs');
    } else if (path === '/settings') {
      setActiveTab('settings');
    } else {
      setActiveTab('dashboard');
      if (path === '/') {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [location.pathname, isAuthReady, currentUser, currentTenant, navigate]);

  const handleNavigateTab = (tab: NavTab | string) => {
    setActiveTab(tab);
    if (tab === 'public-portal') {
      navigate(`/store/${currentTenant?.slug || 'apex-rentals'}`);
    } else if (tab === 'dashboard') {
      navigate('/dashboard');
    } else {
      navigate(`/${tab}`);
    }
  };

  // 1. Initial Load of tenants & Authentication
  useEffect(() => {
    async function loadInitialData() {
      try {
        const user = await api.getCurrentUser();
        setCurrentUser(user);

        if (user) {
          const fetchedTenants = await api.getTenants();
          setTenants(fetchedTenants);
          const targetTenantId = user.tenantId || 'tenant-1';
          const selected = fetchedTenants.find(t => t.id === targetTenantId) || fetchedTenants[0];
          if (selected) {
            setCurrentTenantId(selected.id);
            setCurrentTenant(selected);

            let initialLoc = 'ALL';
            if (user.role !== 'owner') {
              initialLoc = user.branch || '';
            } else {
              const saved = localStorage.getItem(`rentflow_branch_${user.id}`);
              if (saved && (saved === 'ALL' || selected.locations.includes(saved))) {
                initialLoc = saved;
              }
            }
            setSelectedLocation(initialLoc);
            await fetchTenantData(selected.id, initialLoc);
          }
        }
      } catch (err) {
        console.error('Failed to initialize session:', err);
      } finally {
        setIsAuthReady(true);
      }
    }
    loadInitialData();
  }, []);

  const handleLoginSuccess = async (user: User) => {
    setCurrentUser(user);
    showToast(`Welcome back, ${user.name}!`);
    try {
      const fetchedTenants = await api.getTenants();
      setTenants(fetchedTenants);
      const targetTenantId = user.tenantId || 'tenant-1';
      const selected = fetchedTenants.find(t => t.id === targetTenantId) || fetchedTenants[0];
      if (selected) {
        setCurrentTenantId(selected.id);
        setCurrentTenant(selected);
        let initialLoc = 'ALL';
        if (user.role !== 'owner') {
          initialLoc = user.branch || '';
        } else {
          const saved = localStorage.getItem(`rentflow_branch_${user.id}`);
          if (saved && (saved === 'ALL' || selected.locations.includes(saved))) {
            initialLoc = saved;
          }
        }
        setSelectedLocation(initialLoc);
        await fetchTenantData(selected.id, initialLoc);
      }
    } catch (err) {
      console.error('Error loading tenants after login:', err);
    }
    navigate('/dashboard', { replace: true });
  };

  const handleSignupSuccess = async (data: { token: string; user: User; tenant: Tenant }) => {
    setCurrentUser(data.user);
    setTenants([data.tenant]);
    setCurrentTenantId(data.tenant.id);
    setCurrentTenant(data.tenant);
    setSelectedLocation('ALL');
    showToast(`Welcome to RentFlow, ${data.user.name}! Your workspace is ready.`);
    await fetchTenantData(data.tenant.id, 'ALL');
    navigate('/dashboard', { replace: true });
  };

  const handleLogout = () => {
    api.logout();
    setCurrentUser(null);
    setSelectedLocation('ALL');
    setVehicles([]);
    setCustomers([]);
    setRentals([]);
    setInvoices([]);
    setMaintenanceRecords([]);
    setEnquiries([]);
    setAuditLogs([]);
    setMetrics(null);
    navigate('/login', { replace: true });
    showToast('Signed out successfully.');
  };

  // 2. Fetch all data for selected tenant and location
  const fetchTenantData = useCallback(async (tenantId: string, locationFilter?: string) => {
    setLoading(true);
    try {
      const loc = locationFilter !== undefined ? locationFilter : selectedLocation;
      const [vList, cList, rList, iList, mList, mStats, enqList, auditList] = await Promise.all([
        api.getVehicles(tenantId, loc),
        api.getCustomers(tenantId),
        api.getRentals(tenantId, loc),
        api.getInvoices(tenantId, loc),
        api.getMaintenance(tenantId, loc),
        api.getDashboardMetrics(tenantId, loc),
        api.getEnquiries(tenantId).catch(() => []),
        api.getAuditLogs().catch(() => []),
      ]);

      setVehicles(vList);
      setCustomers(cList);
      setRentals(rList);
      setInvoices(iList);
      setMaintenanceRecords(mList);
      setMetrics(mStats);
      setEnquiries(enqList);
      setAuditLogs(auditList);
    } catch (err: any) {
      console.error('Error fetching tenant data:', err);
      showErrorToast(err.message || 'Error loading tenant data');
    } finally {
      setLoading(false);
    }
  }, [selectedLocation]);

  useEffect(() => {
    if (!isAuthReady) return;
    if (currentTenantId) {
      const found = tenants.find(t => t.id === currentTenantId);
      if (found) setCurrentTenant(found);
    }
  }, [isAuthReady, currentTenantId, tenants]);

  // Branch Selection Handler
  const handleSelectLocation = async (loc: string) => {
    if (currentUser && currentUser.role !== 'owner') {
      return; // Non-owners cannot switch away from their assigned branch
    }
    setSelectedLocation(loc);
    if (currentUser) {
      localStorage.setItem(`rentflow_branch_${currentUser.id}`, loc);
    }
    if (currentTenantId) {
      await fetchTenantData(currentTenantId, loc);
    }
  };

  // Tenant Switcher
  const handleSelectTenant = async (tenantId: string) => {
    if (currentUser && currentUser.tenantId !== tenantId) {
      if (import.meta.env.PROD || !isDemoModeActive() || !isDemoUser(currentUser)) {
        showErrorToast('Cross-tenant switching is restricted to demo mode.');
        return;
      }
      try {
        const targetEmail = tenantId === 'tenant-2'
          ? (!import.meta.env.PROD ? 'maya.lin@coastalrentals.com' : '')
          : (!import.meta.env.PROD ? 'alex.rivera@apexrentals.com' : '');
        if (!targetEmail) return;
        const authRes = await api.switchDemoUser(targetEmail);
        setCurrentUser(authRes.user);
        setCurrentTenantId(tenantId);
        const targetTenant = tenants.find(t => t.id === tenantId);
        if (targetTenant) setCurrentTenant(targetTenant);
        const newLoc = authRes.user.role === 'owner' ? 'ALL' : (authRes.user.branch || '');
        setSelectedLocation(newLoc);
        await fetchTenantData(tenantId, newLoc);
        showToast(`Switched active tenant & user to ${authRes.user.name} (${authRes.user.role})`);
        return;
      } catch (err) {
        console.error('Failed to switch demo user during tenant selection:', err);
      }
    }
    setCurrentTenantId(tenantId);
    const targetTenant = tenants.find(t => t.id === tenantId);
    if (targetTenant) setCurrentTenant(targetTenant);
    let nextLoc = selectedLocation;
    if (currentUser && currentUser.role === 'owner') {
      if (targetTenant && !targetTenant.locations.includes(selectedLocation)) {
        nextLoc = 'ALL';
      }
    } else if (currentUser) {
      nextLoc = currentUser.branch || '';
    }
    setSelectedLocation(nextLoc);
    await fetchTenantData(tenantId, nextLoc);
  };

  // Persona Switcher (RBAC)
  const handleSwitchPersona = async (email: string) => {
    if (!isDemoModeActive() || !isDemoUser(currentUser)) {
      showErrorToast('Persona switching is only available for demo accounts in local development.');
      return;
    }
    try {
      const authRes = await api.switchDemoUser(email);
      setCurrentUser(authRes.user);
      const newTenantId = authRes.user.tenantId || currentTenantId;
      if (authRes.user.tenantId !== currentTenantId) {
        setCurrentTenantId(authRes.user.tenantId);
      }
      let targetLoc = 'ALL';
      if (authRes.user.role !== 'owner') {
        targetLoc = authRes.user.branch || '';
      } else {
        const saved = localStorage.getItem(`rentflow_branch_${authRes.user.id}`);
        targetLoc = saved || 'ALL';
      }
      setSelectedLocation(targetLoc);
      await fetchTenantData(newTenantId, targetLoc);
      showToast(`Logged in as ${authRes.user.name} (${authRes.user.role.toUpperCase()})`);
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to switch user persona');
    }
  };

  // Handlers for Rentals
  const handleCreateRental = async (rentalPayload: Partial<Rental>) => {
    try {
      const created = await api.createRental(rentalPayload);
      showToast(`Reservation ${created.rentalNumber} created successfully!`);
      if (prefillEnquiry) {
        await api.convertEnquiry(prefillEnquiry.id, created.id).catch(() => {});
        setPrefillEnquiry(undefined);
      }
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to create reservation');
      throw err;
    }
  };

  const handleConfirmCheckOut = async (rentalId: string, inspectionData: any) => {
    try {
      await api.checkOutRental(rentalId, inspectionData);
      showToast('Handover completed! Vehicle status updated to Rented.');
      setCheckOutRental(null);
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to complete check out');
      throw err;
    }
  };

  const handleConfirmCheckIn = async (rentalId: string, inspectionData: any) => {
    try {
      await api.checkInRental(rentalId, inspectionData);
      showToast('Return check-in completed and security deposit reconciled!');
      setCheckInRental(null);
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to complete check in');
      throw err;
    }
  };

  // Handlers for Vehicles
  const handleAddVehicle = async (vehiclePayload: Partial<Vehicle>) => {
    try {
      await api.createVehicle(vehiclePayload);
      showToast('New fleet vehicle added successfully!');
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to add vehicle');
    }
  };

  const handleUpdateVehicleStatus = async (vehicleId: string, status: any) => {
    try {
      await api.updateVehicle(vehicleId, { status });
      showToast(`Vehicle status changed to ${status}`);
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to update vehicle status');
    }
  };

  // Handlers for Customers
  const handleAddCustomer = async (custPayload: Partial<Customer>): Promise<Customer> => {
    try {
      const created = await api.createCustomer(custPayload);
      showToast(`Customer ${created.name} registered.`);
      await fetchTenantData(currentTenantId);
      return created;
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to register customer');
      throw err;
    }
  };

  // Handlers for Enquiries & CRM
  const handleAddEnquiry = async (enquiryPayload: Partial<Enquiry>): Promise<Enquiry> => {
    try {
      const created = await api.createEnquiry(enquiryPayload);
      showToast(`Lead registered for ${created.customerName}`);
      await fetchTenantData(currentTenantId);
      return created;
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to create enquiry');
      throw err;
    }
  };

  const handleUpdateEnquiry = async (id: string, updates: Partial<Enquiry>): Promise<Enquiry> => {
    try {
      const updated = await api.updateEnquiry(id, updates);
      showToast(`Enquiry updated to ${updated.status}`);
      await fetchTenantData(currentTenantId);
      return updated;
    } catch (err: any) {
      showErrorToast(err.message || 'Failed to update enquiry');
      throw err;
    }
  };

  const handleConvertToBooking = (enquiry: Enquiry) => {
    setPrefillEnquiry(enquiry);
    setBookingVehicle(undefined);
    setIsNewBookingOpen(true);
  };

  // Handlers for Invoices & Payments
  const handleRecordPayment = async (invoiceId: string, amount: number, method: string, reference?: string) => {
    try {
      await api.recordPayment(invoiceId, amount, method, reference);
      showToast(`Payment of ${formatCurrency(amount)} recorded.`);
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to record payment');
    }
  };

  const handleRecordRentalPayment = async (rentalId: string, amount: number, method: string, reference?: string, notes?: string) => {
    try {
      const updated = await api.recordRentalPayment(rentalId, amount, method, reference, notes);
      showToast(`Payment of ${formatCurrency(amount)} recorded.`);
      await fetchTenantData(currentTenantId);
      setDetailRental(updated);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to record payment');
      throw err;
    }
  };

  // Handlers for Maintenance
  const handleAddMaintenance = async (record: Partial<MaintenanceRecord>) => {
    try {
      await api.createMaintenance(record);
      showToast('Maintenance service work order logged.');
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to create maintenance record');
    }
  };

  const handleCompleteMaintenance = async (recordId: string) => {
    try {
      await api.completeMaintenance(recordId);
      showToast('Maintenance completed! Vehicle returned to available fleet.');
      await fetchTenantData(currentTenantId);
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to complete maintenance');
    }
  };

  // Handlers for Settings & Reset
  const handleUpdateTenant = async (data: Partial<Tenant>) => {
    if (!currentTenant) return;
    try {
      const updated = await api.updateTenant(currentTenant.id, data);
      setCurrentTenant(updated);
      setTenants(prev => prev.map(t => t.id === updated.id ? updated : t));
      showToast('Tenant configuration saved.');
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to update tenant configuration');
    }
  };

  const handleResetData = async () => {
    try {
      await api.resetData();
      showToast('Demo database restored to fresh seed data.');
      const allTenants = await api.getTenants();
      setTenants(allTenants);
      if (allTenants.length > 0) {
        setCurrentTenantId(allTenants[0].id);
        setCurrentTenant(allTenants[0]);
        await fetchTenantData(allTenants[0].id);
      }
    } catch (err: any) {
      console.error(err);
      showErrorToast(err.message || 'Failed to reset demo database');
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-slate-400">Verifying RentFlow session...</p>
        </div>
      </div>
    );
  }

  // Email verification route
  if (location.pathname === '/verify-email') {
    return (
      <VerifyEmailView
        onNavigateLogin={() => navigate('/login')}
      />
    );
  }

  // Forgot password flow
  if (!currentUser && location.pathname === '/forgot-password') {
    if (resetFlowStep === 'verify' && resetFlowEmail) {
      return (
        <VerifyPasswordResetOTPView
          email={resetFlowEmail}
          onVerified={(email, token) => {
            setResetFlowToken(token);
            setResetFlowStep('reset');
            navigate('/reset-password');
          }}
          onBackToForgotPassword={() => setResetFlowStep('request')}
          onNavigateLogin={() => navigate('/login')}
        />
      );
    }
    return (
      <ForgotPasswordView
        onOtpRequested={(email) => {
          setResetFlowEmail(email);
          setResetFlowStep('verify');
        }}
        onNavigateLogin={() => navigate('/login')}
      />
    );
  }

  // Reset password route
  if (!currentUser && location.pathname === '/reset-password') {
    return (
      <ResetPasswordView
        email={resetFlowEmail}
        resetToken={resetFlowToken}
        onResetSuccess={() => {
          showToast('Password reset successfully. Please sign in with your new password.');
          setResetFlowStep('request');
          setResetFlowToken('');
          navigate('/login');
        }}
        onNavigateLogin={() => navigate('/login')}
      />
    );
  }

  // Accept invitation route
  if (location.pathname === '/accept-invitation') {
    return (
      <AcceptInvitationView
        onAcceptSuccess={async () => {
          showToast('Welcome to RentFlow! Your account has been activated.');
          const user = await api.getCurrentUser();
          setCurrentUser(user);
          if (user) {
            const fetchedTenants = await api.getTenants();
            setTenants(fetchedTenants);
            const targetTenantId = user.tenantId || 'tenant-1';
            const selected = fetchedTenants.find(t => t.id === targetTenantId) || fetchedTenants[0];
            if (selected) {
              setCurrentTenantId(selected.id);
              setCurrentTenant(selected);
              await fetchTenantData(selected.id);
            }
          }
          navigate('/dashboard');
        }}
        onNavigateLogin={() => navigate('/login')}
      />
    );
  }

  // If user is unauthenticated and on /signup, render SignupView
  if (!currentUser && location.pathname === '/signup') {
    return (
      <SignupView
        onSignupSuccess={handleSignupSuccess}
        onNavigateLogin={() => navigate('/login')}
        onOpenStorefront={() => {
          navigate('/store/apex-rentals');
        }}
      />
    );
  }

  // If user is unauthenticated and not on public customer storefront, render LoginView
  if (!currentUser && !location.pathname.startsWith('/store')) {
    return (
      <LoginView
        onLoginSuccess={handleLoginSuccess}
        onNavigateSignup={() => navigate('/signup')}
        onNavigateForgotPassword={() => {
          setResetFlowStep('request');
          navigate('/forgot-password');
        }}
        onOpenStorefront={() => {
          navigate('/store/apex-rentals');
        }}
      />
    );
  }

  // If user requested Customer Booking Portal, display full storefront
  if (activeTab === 'public-portal' || location.pathname.startsWith('/store')) {
    if (!currentTenant) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-semibold text-slate-400">Loading storefront...</p>
          </div>
        </div>
      );
    }
    return (
      <PublicBookingView
        currentTenant={currentTenant}
        onBackToConsole={currentUser ? () => {
          handleNavigateTab('dashboard');
          fetchTenantData(currentTenantId);
        } : undefined}
      />
    );
  }

  if (!currentTenant) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-600">Initializing RentFlow SaaS Platform...</p>
        </div>
      </div>
    );
  }

  // Count active trips & overdue for sidebar badges
  const activeCount = rentals.filter(r => r.status === 'active').length;
  const overdueCount = rentals.filter(r => r.status === 'active' && new Date(r.endDate).getTime() < Date.now()).length;
  const newEnquiriesCount = enquiries.filter(e => e.status === 'new').length;

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-800 flex">
      {/* Toast Banners */}
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {errorMessageToast && (
        <div className="fixed top-4 right-4 z-50 bg-rose-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 border border-rose-700 animate-in fade-in slide-in-from-top-2 duration-200">
          <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
          <span>{errorMessageToast}</span>
        </div>
      )}

      {/* Responsive Sidebar */}
      <Sidebar
        activeTab={activeTab}
        currentUser={currentUser}
        onSelectTab={(tab: NavTab) => {
          handleNavigateTab(tab);
          setIsMobileSidebarOpen(false);
        }}
        onLogout={handleLogout}
        activeTripsCount={activeCount}
        overdueCount={overdueCount}
        enquiriesCount={newEnquiriesCount}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navbar */}
        <Navbar
          tenants={tenants}
          currentTenant={currentTenant}
          currentUser={currentUser}
          selectedLocation={selectedLocation}
          onSelectLocation={handleSelectLocation}
          onSelectTenant={handleSelectTenant}
          onSwitchPersona={handleSwitchPersona}
          onLogout={handleLogout}
          onOpenPublicPortal={() => handleNavigateTab('public-portal')}
          onOpenNewBooking={() => {
            setBookingVehicle(undefined);
            setPrefillEnquiry(undefined);
            setIsNewBookingOpen(true);
          }}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
        />

        {/* Scrollable View Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto overflow-y-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              tenant={currentTenant}
              selectedLocation={selectedLocation}
              stats={metrics}
              metrics={metrics}
              vehicles={vehicles}
              rentals={rentals}
              onNavigate={handleNavigateTab}
              onNavigateToFleet={() => handleNavigateTab('fleet')}
              onNavigateToRentals={() => handleNavigateTab('rentals')}
              onOpenNewBooking={() => {
                setBookingVehicle(undefined);
                setPrefillEnquiry(undefined);
                setIsNewBookingOpen(true);
              }}
              onOpenCheckOut={(r) => setCheckOutRental(r)}
              onOpenCheckIn={(r) => setCheckInRental(r)}
            />
          )}

          {activeTab === 'fleet' && (
            <FleetView
              tenant={currentTenant}
              vehicles={vehicles}
              onAddVehicle={handleAddVehicle}
              onSelectVehicle={(v) => setDetailVehicle(v)}
              onBookVehicle={(v) => {
                setBookingVehicle(v);
                setPrefillEnquiry(undefined);
                setIsNewBookingOpen(true);
              }}
              onUpdateStatus={handleUpdateVehicleStatus}
            />
          )}

          {activeTab === 'rentals' && (
            <RentalsView
              tenant={currentTenant}
              rentals={rentals}
              onOpenNewBooking={() => {
                setBookingVehicle(undefined);
                setPrefillEnquiry(undefined);
                setIsNewBookingOpen(true);
              }}
              onOpenCheckOut={(r) => setCheckOutRental(r)}
              onOpenCheckIn={(r) => setCheckInRental(r)}
              onViewRentalDetails={(r) => setDetailRental(r)}
              onRecordPayment={(r) => setDetailRental(r)}
            />
          )}

          {activeTab === 'timeline' && (
            <TimelineView
              tenant={currentTenant}
              vehicles={vehicles}
              rentals={rentals}
              onSelectRental={(r) => setDetailRental(r)}
              onSelectVehicle={(v) => setDetailVehicle(v)}
            />
          )}

          {activeTab === 'customers' && (
            <CustomersView
              tenant={currentTenant}
              customers={customers}
              rentals={rentals}
              onAddCustomer={handleAddCustomer}
            />
          )}

          {activeTab === 'enquiries' && (
            <EnquiriesView
              tenant={currentTenant}
              enquiries={enquiries}
              vehicles={vehicles}
              onAddEnquiry={handleAddEnquiry}
              onUpdateEnquiry={handleUpdateEnquiry}
              onConvertToBooking={handleConvertToBooking}
            />
          )}

          {activeTab === 'invoices' && (
            <InvoicesView
              tenant={currentTenant}
              invoices={invoices}
              onRecordPayment={handleRecordPayment}
            />
          )}

          {activeTab === 'maintenance' && (
            <MaintenanceView
              tenant={currentTenant}
              vehicles={vehicles}
              records={maintenanceRecords}
              onAddRecord={handleAddMaintenance}
              onCompleteRecord={handleCompleteMaintenance}
            />
          )}

          {activeTab === 'audit-logs' && (
            <AuditLogsView
              tenant={currentTenant}
              auditLogs={auditLogs}
              onRefresh={() => fetchTenantData(currentTenantId)}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              tenant={currentTenant}
              tenants={tenants}
              currentUser={currentUser}
              onUpdateTenant={handleUpdateTenant}
              onResetData={handleResetData}
              showToast={showToast}
              showErrorToast={showErrorToast}
            />
          )}
        </main>
      </div>

      {/* Global Modals */}

      {/* 1. New Booking Wizard */}
      {isNewBookingOpen && (
        <NewBookingModal
          tenant={currentTenant}
          vehicles={vehicles}
          customers={customers}
          preselectedVehicle={bookingVehicle}
          prefillEnquiry={prefillEnquiry}
          onClose={() => {
            setIsNewBookingOpen(false);
            setBookingVehicle(undefined);
            setPrefillEnquiry(undefined);
          }}
          onCreateRental={handleCreateRental}
          onCreateCustomer={handleAddCustomer}
        />
      )}

      {/* 2. Check-Out Modal */}
      {checkOutRental && (
        <CheckOutModal
          tenant={currentTenant}
          rental={checkOutRental}
          currentUser={currentUser}
          onClose={() => setCheckOutRental(null)}
          onConfirmCheckOut={handleConfirmCheckOut}
        />
      )}

      {/* 3. Check-In Modal */}
      {checkInRental && (
        <CheckInModal
          tenant={currentTenant}
          rental={checkInRental}
          currentUser={currentUser}
          onClose={() => setCheckInRental(null)}
          onConfirmCheckIn={handleConfirmCheckIn}
        />
      )}

      {/* 4. Rental Detail Modal */}
      {detailRental && (
        <RentalDetailModal
          rental={detailRental}
          tenant={currentTenant}
          currentUser={currentUser}
          onClose={() => setDetailRental(null)}
          onCheckOut={(r) => {
            setDetailRental(null);
            setCheckOutRental(r);
          }}
          onCheckIn={(r) => {
            setDetailRental(null);
            setCheckInRental(r);
          }}
          onRecordPayment={handleRecordRentalPayment}
        />
      )}

      {/* 5. Vehicle Detail Modal */}
      {detailVehicle && (
        <VehicleDetailModal
          vehicle={detailVehicle}
          tenant={currentTenant}
          rentals={rentals}
          onClose={() => setDetailVehicle(null)}
          onBookVehicle={(v) => {
            setDetailVehicle(null);
            setBookingVehicle(v);
            setPrefillEnquiry(undefined);
            setIsNewBookingOpen(true);
          }}
        />
      )}
    </div>
  );
}
