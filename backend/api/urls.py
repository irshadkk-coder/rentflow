from django.urls import path, re_path
from . import views

urlpatterns = [
    # System
    re_path(r'^health/?$', views.HealthCheckView.as_view(), name='health'),

    # Auth
    re_path(r'^auth/register/?$', views.AuthRegisterView.as_view(), name='auth_register'),
    re_path(r'^auth/verify-email-otp/?$', views.VerifyEmailOTPView.as_view(), name='auth_verify_email_otp'),
    re_path(r'^auth/verify-email/?$', views.VerifyEmailView.as_view(), name='auth_verify_email'),
    re_path(r'^auth/resend-verification/?$', views.ResendVerificationView.as_view(), name='auth_resend_verification'),
    re_path(r'^auth/forgot-password/?$', views.ForgotPasswordView.as_view(), name='auth_forgot_password'),
    re_path(r'^auth/verify-password-reset-otp/?$', views.VerifyPasswordResetOTPView.as_view(), name='auth_verify_password_reset_otp'),
    re_path(r'^auth/reset-password/?$', views.ResetPasswordView.as_view(), name='auth_reset_password'),
    re_path(r'^auth/login/?$', views.AuthLoginView.as_view(), name='auth_login'),
    re_path(r'^auth/me/?$', views.AuthMeView.as_view(), name='auth_me'),
    re_path(r'^auth/switch-demo-user/?$', views.SwitchDemoUserView.as_view(), name='auth_switch_demo'),
    re_path(r'^auth/users/?$', views.TenantUserListView.as_view(), name='auth_users'),

    # Public Storefront
    re_path(r'^public/business/(?P<slug>[^/]+)/?$', views.PublicBusinessView.as_view(), name='public_business'),
    re_path(r'^public/vehicles/?$', views.PublicVehiclesView.as_view(), name='public_vehicles'),
    re_path(r'^public/quote/?$', views.PublicQuoteView.as_view(), name='public_quote'),
    re_path(r'^public/bookings/?$', views.PublicBookingView.as_view(), name='public_bookings'),

    # Tenants
    re_path(r'^tenants/?$', views.TenantListView.as_view(), name='tenants_list'),
    re_path(r'^tenants/(?P<pk>[^/]+)/?$', views.TenantDetailView.as_view(), name='tenant_detail'),

    # Vehicles
    re_path(r'^vehicles/?$', views.VehicleListCreateView.as_view(), name='vehicles_list_create'),
    re_path(r'^vehicles/(?P<pk>[^/]+)/?$', views.VehicleDetailView.as_view(), name='vehicle_detail'),

    # Customers
    re_path(r'^customers/?$', views.CustomerListCreateView.as_view(), name='customers_list_create'),
    re_path(r'^customers/(?P<pk>[^/]+)/?$', views.CustomerDetailView.as_view(), name='customer_detail'),

    # Quotes
    re_path(r'^quote/?$', views.PrivateQuoteView.as_view(), name='private_quote'),

    # Rentals
    re_path(r'^rentals/?$', views.RentalListCreateView.as_view(), name='rentals_list_create'),
    re_path(r'^rentals/(?P<pk>[^/]+)/check-out/?$', views.RentalCheckOutView.as_view(), name='rental_checkout'),
    re_path(r'^rentals/(?P<pk>[^/]+)/check-in/?$', views.RentalCheckInView.as_view(), name='rental_checkin'),
    re_path(r'^rentals/(?P<pk>[^/]+)/pay/?$', views.RentalPaymentView.as_view(), name='rental_pay'),
    re_path(r'^rentals/(?P<pk>[^/]+)/payments/?$', views.RentalPaymentView.as_view(), name='rental_payments'),
    re_path(r'^rentals/(?P<pk>[^/]+)/?$', views.RentalDetailView.as_view(), name='rental_detail'),

    # Invoices
    re_path(r'^invoices/?$', views.InvoiceListView.as_view(), name='invoices_list'),
    re_path(r'^invoices/(?P<pk>[^/]+)/pay/?$', views.InvoicePaymentView.as_view(), name='invoice_pay'),
    re_path(r'^invoices/(?P<pk>[^/]+)/?$', views.InvoiceDetailView.as_view(), name='invoice_detail'),

    # Maintenance
    re_path(r'^maintenance/?$', views.MaintenanceListCreateView.as_view(), name='maintenance_list_create'),
    re_path(r'^maintenance/(?P<pk>[^/]+)/?$', views.MaintenanceDetailView.as_view(), name='maintenance_detail'),

    # Enquiries
    re_path(r'^enquiries/?$', views.EnquiryListCreateView.as_view(), name='enquiries_list_create'),
    re_path(r'^enquiries/(?P<pk>[^/]+)/convert/?$', views.EnquiryConvertView.as_view(), name='enquiry_convert'),
    re_path(r'^enquiries/(?P<pk>[^/]+)/?$', views.EnquiryDetailView.as_view(), name='enquiry_detail'),

    # Audit Logs & Analytics
    re_path(r'^audit-logs/?$', views.AuditLogListView.as_view(), name='audit_logs_list'),
    re_path(r'^analytics/?$', views.AnalyticsView.as_view(), name='analytics'),

    # Team Management & Invitations
    re_path(r'^team-members/?$', views.TeamMemberListCreateView.as_view(), name='team_members_list_create'),
    re_path(r'^team-members/(?P<member_id>[^/]+)/role/?$', views.TeamMemberRoleUpdateView.as_view(), name='team_member_role_update'),
    re_path(r'^team-members/(?P<member_id>[^/]+)/deactivate/?$', views.TeamMemberDeactivateView.as_view(), name='team_member_deactivate'),
    re_path(r'^team-members/(?P<member_id>[^/]+)/reactivate/?$', views.TeamMemberReactivateView.as_view(), name='team_member_reactivate'),

    re_path(r'^team-invitations/?$', views.TeamMemberListCreateView.as_view(), name='team_invitations_create'),
    re_path(r'^team-invitations/validate/?$', views.TeamInvitationValidateView.as_view(), name='team_invitation_validate'),
    re_path(r'^team-invitations/accept/?$', views.TeamInvitationAcceptView.as_view(), name='team_invitation_accept'),
    re_path(r'^team-invitations/(?P<invitation_id>[^/]+)/resend/?$', views.TeamInvitationResendView.as_view(), name='team_invitation_resend'),
    re_path(r'^team-invitations/(?P<invitation_id>[^/]+)/cancel/?$', views.TeamInvitationCancelView.as_view(), name='team_invitation_cancel'),

    # Database Reset
    re_path(r'^reset/?$', views.DatabaseResetView.as_view(), name='database_reset'),
]
