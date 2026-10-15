import os
import logging
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny
from rest_framework.renderers import JSONRenderer
from rest_framework.negotiation import DefaultContentNegotiation

logger = logging.getLogger(__name__)
from rest_framework.throttling import ScopedRateThrottle
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from .models import (
    Tenant, User, Vehicle, Customer, Rental, Invoice,
    MaintenanceRecord, Enquiry, AuditLog, TeamInvitation
)
from .serializers import (
    TenantSerializer, PublicTenantSerializer, UserSerializer,
    VehicleSerializer, PublicVehicleSerializer, CustomerSerializer,
    RentalSerializer, InvoiceSerializer, MaintenanceRecordSerializer,
    EnquirySerializer, AuditLogSerializer, PublicBookingCreateSerializer,
    TenantRegistrationSerializer, ForgotPasswordRequestSerializer,
    VerifyPasswordResetOTPSerializer, ResetPasswordSerializer,
    TeamMemberSerializer, TeamInvitationSerializer,
    CreateTeamInvitationSerializer, AcceptTeamInvitationSerializer,
    ChangeMemberRoleSerializer
)
from .permissions import IsAuthenticated, IsOwner, IsOwnerOrManager, IsStaff
from .authentication import RentFlowJWTAuthentication
from .services import (
    AuthService, PricingService, BookingService,
    InspectionService, PaymentService, EnquiryService,
    AnalyticsService
)
from .seed_service import seed_database
from django.utils.dateparse import parse_datetime
from .exceptions import EmailDeliveryError
from .branch_security import (
    get_tenant_locations,
    is_valid_tenant_branch,
    resolve_user_branch_scope,
    is_forbidden_error,
    filter_vehicles_by_branch,
    filter_rentals_by_branch,
    filter_maintenance_by_branch,
    filter_invoices_by_branch,
    validate_vehicle_mutation,
    validate_rental_mutation,
    validate_maintenance_mutation,
)
from .anti_spam import (
    check_rate_limits, verify_captcha_token, check_duplicate_booking,
    check_signup_rate_limits, check_resend_verification_rate_limits,
    check_verify_email_rate_limits, check_resend_cooldown,
    set_resend_cooldown, check_verify_otp_rate_limits,
    check_forgot_password_rate_limits, check_reset_cooldown,
    set_reset_cooldown, check_reset_password_rate_limits,
    check_invite_creation_rate_limits, check_invite_resend_cooldown,
    set_invite_resend_cooldown, check_invite_acceptance_rate_limits
)
from .email_service import EmailService


def get_client_ip(request):
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def paginate(queryset, page_str, limit_str):
    if not page_str and not limit_str:
        return None
    try:
        page = max(1, int(page_str or 1))
        limit = max(1, min(100, int(limit_str or 50)))
        total = queryset.count()
        start = (page - 1) * limit
        end = start + limit
        items = queryset[start:end]
        return {
            'data': items,
            'pagination': {
                'page': page,
                'limit': limit,
                'total': total,
                'totalPages': (total + limit - 1) // limit
            }
        }
    except Exception:
        return None


# ----------------------------------------------------
# SYSTEM & HEALTH
# ----------------------------------------------------
class HealthCheckContentNegotiation(DefaultContentNegotiation):
    def select_renderer(self, request, renderers, format_suffix=None):
        # Unconditionally select JSONRenderer regardless of client Accept header
        return (renderers[0], renderers[0].media_type)


class HealthCheckView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    renderer_classes = [JSONRenderer]
    content_negotiation_class = HealthCheckContentNegotiation

    def get(self, request):
        return Response({
            'status': 'ok',
            'engine': 'Python/Django',
            'timestamp': timezone.now().isoformat()
        })


# ----------------------------------------------------
# AUTHENTICATION
# ----------------------------------------------------
class AuthRegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        remote_ip = get_client_ip(request)
        owner_email = request.data.get('ownerEmail', '')

        # 1. Signup rate limits
        allowed, rate_msg = check_signup_rate_limits(remote_ip, owner_email)
        if not allowed:
            return Response({'error': rate_msg}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 2. Serializer validation
        serializer = TenantRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            first_err = None
            for field, msgs in serializer.errors.items():
                if isinstance(msgs, list) and msgs:
                    first_err = str(msgs[0])
                    break
                elif isinstance(msgs, str):
                    first_err = msgs
                    break
            response_data = dict(serializer.errors)
            response_data['error'] = first_err or 'Invalid registration details provided.'
            return Response(response_data, status=status.HTTP_400_BAD_REQUEST)

        valid_data = serializer.validated_data

        # 3. Cloudflare Turnstile bot verification
        captcha_token = valid_data.get('captchaToken', '')
        captcha_ok, captcha_msg = verify_captcha_token(captcha_token, remote_ip, is_owner_signup=True)
        if not captcha_ok:
            return Response({'error': captcha_msg}, status=status.HTTP_400_BAD_REQUEST)

        # 4. Atomic Tenant + Unverified Owner creation & verification email dispatch
        try:
            tenant, user, raw_otp = AuthService.register_tenant_and_owner(valid_data)
        except EmailDeliveryError as e:
            return Response({'error': str(e), 'success': False}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as e:
            return Response({'error': str(e), 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': 'Account created. Please check your email and verify your email address before logging in.',
            'emailVerificationRequired': True,
            'email': user.email,
            'tenant': TenantSerializer(tenant).data
        }, status=status.HTTP_201_CREATED)


class AuthLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        email = request.data.get('email')
        password = request.data.get('password')
        if not email or not password:
            return Response({'error': 'Email and password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        user, token, error_code = AuthService.authenticate(email, password)
        if error_code == 'INACTIVE_ACCOUNT':
            return Response({
                'error': 'Your account has been deactivated. Please contact your organization owner.',
                'inactive': True
            }, status=status.HTTP_403_FORBIDDEN)

        if error_code == 'UNVERIFIED_EMAIL':
            return Response({
                'error': 'Please verify your email before logging in.',
                'unverified': True,
                'email': user.email if user else email
            }, status=status.HTTP_403_FORBIDDEN)

        if not user or not token:
            return Response({'error': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        return Response({
            'token': token,
            'user': UserSerializer(user).data
        })


class VerifyEmailView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def _verify(self, request):
        remote_ip = get_client_ip(request)
        allowed, rate_msg = check_verify_email_rate_limits(remote_ip)
        if not allowed:
            return Response({'error': rate_msg}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        token = None
        if hasattr(request, 'data') and isinstance(request.data, dict):
            token = request.data.get('token')
        if not token:
            token = request.query_params.get('token')

        if not token or not str(token).strip():
            return Response({'error': 'Verification token is required.'}, status=status.HTTP_400_BAD_REQUEST)

        success, message, user = AuthService.verify_email_token(str(token).strip())
        if not success:
            return Response({'error': message, 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': message,
            'email': user.email if user else None
        }, status=status.HTTP_200_OK)

    def get(self, request):
        return self._verify(request)

    def post(self, request):
        return self._verify(request)


class ResendVerificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        remote_ip = get_client_ip(request)
        email = request.data.get('email', '')
        if not email or not str(email).strip():
            return Response({'error': 'Email address is required.'}, status=status.HTTP_400_BAD_REQUEST)

        clean_email = str(email).strip().lower()

        # 1. Check 60-second cooldown
        cooldown_ok, cooldown_msg, remaining = check_resend_cooldown(clean_email)
        if not cooldown_ok:
            return Response({
                'error': cooldown_msg,
                'cooldown': True,
                'remainingSeconds': remaining
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 2. Check general resend rate limits
        allowed, rate_msg = check_resend_verification_rate_limits(remote_ip, clean_email)
        if not allowed:
            return Response({'error': rate_msg}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 3. Resend OTP and legacy link
        success, message = AuthService.resend_verification_email(clean_email)
        if not success:
            return Response({
                'success': False,
                'error': message
            }, status=status.HTTP_502_BAD_GATEWAY)

        # 4. Activate 60-second cooldown on success
        set_resend_cooldown(clean_email, seconds=60)

        return Response({
            'success': True,
            'message': message,
            'cooldownSeconds': 60
        }, status=status.HTTP_200_OK)


class VerifyEmailOTPView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        remote_ip = get_client_ip(request)
        email = request.data.get('email', '')
        otp = request.data.get('otp', '')

        if not email or not str(email).strip():
            return Response({'error': 'Email address is required.', 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        clean_email = str(email).strip().lower()
        clean_otp = str(otp).strip() if otp is not None else ""

        if not clean_otp:
            return Response({'error': 'Verification code is required.', 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        # Rate limits on OTP verification attempts
        allowed, rate_msg = check_verify_otp_rate_limits(remote_ip, clean_email)
        if not allowed:
            return Response({'error': rate_msg, 'success': False}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        success, message, user = AuthService.verify_email_otp(clean_email, clean_otp)
        if not success:
            return Response({'error': message, 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': message,
            'email': user.email if user else clean_email
        }, status=status.HTTP_200_OK)


class ForgotPasswordView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        remote_ip = get_client_ip(request)
        email = request.data.get('email', '')
        if not email or not str(email).strip():
            return Response({'error': 'Email address is required.', 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        clean_email = str(email).strip().lower()

        # 1. Cooldown check per email
        cooldown_ok, cooldown_msg, remaining = check_reset_cooldown(clean_email)
        if not cooldown_ok:
            return Response({
                'error': cooldown_msg,
                'cooldown': True,
                'remainingSeconds': remaining
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 2. General rate limit check
        allowed, rate_msg = check_forgot_password_rate_limits(remote_ip, clean_email)
        if not allowed:
            return Response({'error': rate_msg, 'success': False}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 3. Serializer validation
        serializer = ForgotPasswordRequestSerializer(data={'email': clean_email})
        if not serializer.is_valid():
            return Response({'error': 'Please enter a valid email address.', 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        generic_msg = "If an account exists for this email, password reset instructions will be sent."

        # 4. User existence & eligibility check
        user = User.objects.filter(email__iexact=clean_email).first()
        if not user or not user.is_email_verified or not getattr(user, 'is_active', True):
            # Consistent response and cooldown to prevent account enumeration
            set_reset_cooldown(clean_email, seconds=60)
            return Response({
                'success': True,
                'message': generic_msg,
                'cooldownSeconds': 60
            }, status=status.HTTP_200_OK)

        # 5. Generate reset OTP challenge
        challenge, raw_otp = AuthService.create_password_reset_otp(user)

        # 6. Dispatch email via Brevo
        company_name = user.tenant.name if user.tenant else "RentFlow"
        sent = EmailService.send_password_reset_otp_email(user=user, otp=raw_otp, company_name=company_name)
        if not sent:
            return Response({
                'success': False,
                'error': 'Failed to deliver password reset email. Please try again later.'
            }, status=status.HTTP_502_BAD_GATEWAY)

        # 7. Set 60-second cooldown on success
        set_reset_cooldown(clean_email, seconds=60)

        return Response({
            'success': True,
            'message': generic_msg,
            'cooldownSeconds': 60
        }, status=status.HTTP_200_OK)


class VerifyPasswordResetOTPView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        remote_ip = get_client_ip(request)
        serializer = VerifyPasswordResetOTPSerializer(data=request.data)
        if not serializer.is_valid():
            first_err = "Verification code must be a 6-digit number."
            for field, msgs in serializer.errors.items():
                if isinstance(msgs, list) and msgs:
                    first_err = str(msgs[0])
                    break
            return Response({'error': first_err, 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        clean_email = serializer.validated_data['email']
        clean_otp = serializer.validated_data['otp']

        # Rate limits on OTP verification attempts
        allowed, rate_msg = check_verify_otp_rate_limits(remote_ip, clean_email)
        if not allowed:
            return Response({'error': rate_msg, 'success': False}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        success, message, reset_token = AuthService.verify_password_reset_otp(clean_email, clean_otp)
        if not success:
            return Response({'error': message, 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': message,
            'resetToken': reset_token
        }, status=status.HTTP_200_OK)


class ResetPasswordView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        remote_ip = get_client_ip(request)

        allowed, rate_msg = check_reset_password_rate_limits(remote_ip)
        if not allowed:
            return Response({'error': rate_msg, 'success': False}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        serializer = ResetPasswordSerializer(data=request.data)
        if not serializer.is_valid():
            first_err = "Invalid password reset details."
            for field, msgs in serializer.errors.items():
                if isinstance(msgs, list) and msgs:
                    first_err = str(msgs[0])
                    break
                elif isinstance(msgs, str):
                    first_err = msgs
                    break
            response_data = dict(serializer.errors)
            response_data['error'] = first_err
            response_data['success'] = False
            return Response(response_data, status=status.HTTP_400_BAD_REQUEST)

        valid_data = serializer.validated_data
        clean_email = valid_data['email']
        reset_token = valid_data['resetToken']
        new_password = valid_data['newPassword']

        success, message = AuthService.reset_password(clean_email, reset_token, new_password)
        if not success:
            return Response({'error': message, 'success': False}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': message
        }, status=status.HTTP_200_OK)


class AuthMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            user = User.objects.get(id=request.user.id)
            user_data = UserSerializer(user).data
            return Response({'user': user_data, **user_data})
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)


class SwitchDemoUserView(APIView):
    authentication_classes = [RentFlowJWTAuthentication]
    permission_classes = [AllowAny]

    def post(self, request):
        if not settings.DEBUG or not getattr(settings, 'ENABLE_DEMO_MODE', False):
            return Response({'error': 'Demo user switcher is strictly disabled in production.'}, status=status.HTTP_403_FORBIDDEN)

        allowed_emails = [
            'alex.rivera@apexrentals.com',
            'sarah.chen@apexrentals.com',
            'jordan.lee@apexrentals.com',
            'maya.lin@coastalrentals.com',
            'marcus.vance@metrocarshare.com'
        ]

        # Prevent identity switching for normal registered users
        if request.user and getattr(request.user, 'is_authenticated', False):
            user_email = getattr(request.user, 'email', '').lower()
            if user_email not in [e.lower() for e in allowed_emails]:
                return Response(
                    {'error': 'Forbidden: Registered users cannot switch identities or access demo accounts.'},
                    status=status.HTTP_403_FORBIDDEN
                )

        email = request.data.get('email') or 'alex.rivera@apexrentals.com'
        password = request.data.get('password')

        if email.lower() not in [e.lower() for e in allowed_emails]:
            return Response({'error': 'Demo user not found or unauthorized.'}, status=status.HTTP_404_NOT_FOUND)

        user, token = AuthService.switch_demo_user(email, password)
        if not user or not token:
            return Response({'error': 'Invalid demo credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        return Response({
            'token': token,
            'user': UserSerializer(user).data
        })


class TenantUserListView(APIView):
    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        users = User.objects.filter(tenant_id=request.user.tenant_id)
        return Response(UserSerializer(users, many=True).data)


# ----------------------------------------------------
# PUBLIC STOREFRONT
# ----------------------------------------------------
class PublicBusinessView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, slug):
        try:
            tenant = Tenant.objects.get(slug=slug)
            return Response(PublicTenantSerializer(tenant).data)
        except Tenant.DoesNotExist:
            return Response({'error': 'Rental business not found.'}, status=status.HTTP_404_NOT_FOUND)


class PublicVehiclesView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        slug = request.query_params.get('slug')
        if not slug:
            return Response({'error': 'Business slug query parameter is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tenant = Tenant.objects.get(slug=slug)
        except Tenant.DoesNotExist:
            return Response({'error': 'Rental business not found.'}, status=status.HTTP_404_NOT_FOUND)

        vehicles = Vehicle.objects.filter(tenant=tenant, status='available')
        return Response(PublicVehicleSerializer(vehicles, many=True).data)


class PublicQuoteView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'public_quote'

    def post(self, request):
        slug = request.data.get('slug')
        if not slug:
            return Response({'error': 'Business slug is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tenant = Tenant.objects.get(slug=slug)
        except Tenant.DoesNotExist:
            return Response({'error': 'Rental business not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            pricing = PricingService.calculate_canonical_pricing(tenant, request.data)
            return Response(pricing)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found.'}, status=status.HTTP_404_NOT_FOUND)


class PublicBookingView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'public_booking'

    def post(self, request):
        # 1. IP & Identifier Rate Limiting
        remote_ip = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip() or request.META.get('REMOTE_ADDR')
        raw_phone = request.data.get('customerPhone', '')
        raw_email = request.data.get('customerEmail', '')

        is_allowed, rate_err = check_rate_limits(remote_ip, raw_phone, raw_email)
        if not is_allowed:
            return Response({'error': rate_err}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # 2. Serializer Validation (phone, email, dates ISO & chronology)
        serializer = PublicBookingCreateSerializer(data=request.data)
        if not serializer.is_valid():
            response_data = dict(serializer.errors)
            first_err = None
            for field, msgs in serializer.errors.items():
                if isinstance(msgs, list) and msgs:
                    first_err = str(msgs[0])
                    break
                elif isinstance(msgs, str):
                    first_err = msgs
                    break
            response_data['error'] = first_err or 'Invalid booking details provided.'
            return Response(response_data, status=status.HTTP_400_BAD_REQUEST)

        valid_data = serializer.validated_data

        # 3. Bot / CAPTCHA Verification
        captcha_token = valid_data.get('captchaToken', '')
        captcha_ok, captcha_msg = verify_captcha_token(captcha_token, remote_ip)
        if not captcha_ok:
            return Response({'error': captcha_msg}, status=status.HTTP_400_BAD_REQUEST)

        # 4. Tenant Scoping & Isolation
        slug = valid_data.get('slug')
        tenant_id = valid_data.get('tenantId')

        if slug:
            try:
                tenant = Tenant.objects.get(slug=slug)
                tenant_id = tenant.id
            except Tenant.DoesNotExist:
                return Response({'error': 'Rental business not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not tenant_id:
            return Response({'error': 'Business identifier is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tenant = Tenant.objects.get(id=tenant_id)
        except Tenant.DoesNotExist:
            return Response({'error': 'Rental business not found.'}, status=status.HTTP_404_NOT_FOUND)

        # 5. Vehicle Scope & Availability (Scoped strictly to tenant)
        vehicle_id = valid_data.get('vehicleId')
        try:
            vehicle = Vehicle.objects.get(id=vehicle_id, tenant_id=tenant_id)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found for this rental business.'}, status=status.HTTP_404_NOT_FOUND)

        if vehicle.status == 'maintenance':
            return Response({'error': 'This vehicle is currently undergoing maintenance and is not available.'}, status=status.HTTP_400_BAD_REQUEST)

        start_dt = parse_datetime(valid_data['startDate'])
        end_dt = parse_datetime(valid_data['endDate'])
        if not start_dt or not end_dt:
            return Response({'error': 'Invalid booking dates provided.'}, status=status.HTTP_400_BAD_REQUEST)

        # 6. Duplicate Booking Protection
        duplicate_rental = check_duplicate_booking(
            tenant_id=tenant_id,
            vehicle_id=vehicle.id,
            start_date=start_dt,
            end_date=end_dt,
            customer_phone=valid_data['customerPhone'],
            customer_name=valid_data.get('customerName', '')
        )
        if duplicate_rental:
            return Response({
                'success': True,
                'bookingNumber': duplicate_rental.rental_number,
                'rentalId': duplicate_rental.id,
                'vehicleName': duplicate_rental.vehicle_name,
                'startDate': duplicate_rental.start_date.isoformat(),
                'endDate': duplicate_rental.end_date.isoformat(),
                'totalAmount': float(duplicate_rental.total_amount),
                'depositAmount': float(duplicate_rental.deposit_amount),
                'status': duplicate_rental.status,
                'duplicate': True,
                'message': f"An identical booking was recently confirmed for this vehicle and dates (Reference: {duplicate_rental.rental_number})."
            }, status=status.HTTP_200_OK)

        # 7. Server-Authoritative Pricing & Sanitization
        clean_payload = dict(valid_data)
        clean_payload['status'] = 'confirmed'
        for forbidden in ['id', 'rentalNumber', 'dailyRate', 'totalAmount', 'depositAmount', 'balanceDue', 'tax', 'customerId', 'captchaToken']:
            clean_payload.pop(forbidden, None)

        try:
            rental = BookingService.create_rental(tenant_id, clean_payload)

            AuditLog.objects.create(
                tenant_id=tenant_id,
                user_name=rental.customer_name,
                user_role='guest',
                action='rental.public_create',
                entity_type='rental',
                entity_id=rental.id,
                details=f"Public booking {rental.rental_number} created by guest {rental.customer_name}",
                ip_address=remote_ip
            )

            return Response({
                'success': True,
                'bookingNumber': rental.rental_number,
                'rentalId': rental.id,
                'vehicleName': rental.vehicle_name,
                'startDate': rental.start_date.isoformat(),
                'endDate': rental.end_date.isoformat(),
                'totalAmount': float(rental.total_amount),
                'depositAmount': float(rental.deposit_amount),
                'status': rental.status,
                'message': 'Your reservation has been confirmed. A confirmation receipt has been sent to your email.'
            }, status=status.HTTP_201_CREATED)
        except ValueError as e:
            err_msg = str(e)
            if 'Booking conflict' in err_msg:
                return Response({'error': err_msg, 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_400_BAD_REQUEST)
        except IntegrityError as e:
            err_msg = str(e)
            if '23P01' in err_msg or 'no_overlapping_rentals' in err_msg or 'exclusion' in err_msg.lower():
                return Response({'error': 'Vehicle is already booked for the selected dates.', 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            err_msg = str(e)
            if '23P01' in err_msg or 'no_overlapping_rentals' in err_msg or 'exclusion' in err_msg.lower():
                return Response({'error': 'Vehicle is already booked for the selected dates.', 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': 'An unexpected error occurred while processing your reservation.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ----------------------------------------------------
# TENANTS
# ----------------------------------------------------
class TenantListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        tenants = Tenant.objects.filter(id=request.user.tenant_id)
        return Response(TenantSerializer(tenants, many=True).data)


class TenantDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        tenant_id = request.user.tenant_id if pk == 'current' else pk
        if tenant_id != request.user.tenant_id:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
        try:
            tenant = Tenant.objects.get(id=tenant_id)
            return Response(TenantSerializer(tenant).data)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        tenant_id = request.user.tenant_id if pk == 'current' else pk
        if tenant_id != request.user.tenant_id:
            return Response({'error': 'Forbidden: Cannot modify other business settings.'}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role != 'owner':
            return Response({'error': 'Forbidden: Action requires role owner.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            tenant = Tenant.objects.get(id=tenant_id)
            data = request.data
            if data.get('name'): tenant.name = data['name']
            if data.get('email'): tenant.email = data['email']
            if data.get('phone'): tenant.phone = data['phone']
            if data.get('currency'): tenant.currency = data['currency']
            if data.get('taxRate') is not None:
                tenant.tax_rate = data['taxRate'] / 100.0

            settings_dict = tenant.settings or {}
            for field in ['tagline', 'address', 'currencyCode', 'securityDepositDefault', 'lateFeePerHour', 'fuelPenaltyPerPercent', 'locations', 'categories']:
                if data.get(field) is not None:
                    settings_dict[field] = data[field]
            tenant.settings = settings_dict
            tenant.save()
            return Response(TenantSerializer(tenant).data)
        except Tenant.DoesNotExist:
            return Response({'error': 'Tenant not found'}, status=status.HTTP_404_NOT_FOUND)


# ----------------------------------------------------
# VEHICLES
# ----------------------------------------------------
class VehicleListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scoped_branch, err = resolve_user_branch_scope(
            request.user.db_user,
            request.query_params.get('location') or request.query_params.get('branch')
        )
        if err:
            status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(err) else status.HTTP_400_BAD_REQUEST
            return Response({'error': err}, status=status_code)

        qs = Vehicle.objects.filter(tenant_id=request.user.tenant_id)
        qs = filter_vehicles_by_branch(qs, scoped_branch)
        paginated = paginate(qs, request.query_params.get('page'), request.query_params.get('limit'))
        if paginated:
            return Response({
                'data': VehicleSerializer(paginated['data'], many=True).data,
                'pagination': paginated['pagination']
            })
        return Response(VehicleSerializer(qs, many=True).data)

    def post(self, request):
        if request.user.role not in ['owner', 'manager']:
            return Response({'error': 'Forbidden: Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        if not data.get('make') or not data.get('model') or not data.get('licensePlate') or not data.get('dailyRate'):
            return Response({'error': 'make, model, licensePlate, and dailyRate are required.'}, status=status.HTTP_400_BAD_REQUEST)

        mutation_err = validate_vehicle_mutation(request.user.db_user, None, requested_location=data.get('location'))
        if mutation_err:
            status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
            return Response({'error': mutation_err}, status=status_code)

        tenant = Tenant.objects.get(id=request.user.tenant_id)
        assigned_location = request.user.branch if request.user.role == 'manager' else (data.get('location') or get_tenant_locations(tenant)[0])
        images_dict = {
            'imageUrl': data.get('imageUrl', 'https://images.unsplash.com/photo-1568844293986-8d0400bd4745?auto=format&fit=crop&w=800&q=80'),
            'type': data.get('type', 'car'),
            'color': data.get('color', 'Standard'),
            'location': assigned_location,
            'hourlyRate': float(data.get('hourlyRate', 15)),
            'weeklyRate': float(data.get('weeklyRate', float(data['dailyRate']) * 6)),
            'transmission': data.get('transmission', 'Automatic'),
            'seats': int(data.get('seats', 2))
        }

        vehicle = Vehicle.objects.create(
            tenant=tenant,
            name=f"{data.get('year', 2024)} {data['make']} {data['model']}",
            category=data.get('category', 'car'),
            make=data['make'],
            model=data['model'],
            year=int(data.get('year', 2024)),
            license_plate=data['licensePlate'],
            vin=data.get('vin', ''),
            daily_rate=data['dailyRate'],
            deposit_amount=data.get('deposit', 250.00),
            status=data.get('status', 'available'),
            odometer=int(data.get('odometer', 0)),
            fuel_level=int(data.get('fuelLevel', 100)),
            features=data.get('features', []),
            images=images_dict
        )

        AuditLog.objects.create(
            tenant=tenant,
            user_id=request.user.id,
            user_name=request.user.name,
            user_role=request.user.role,
            action='vehicle.create',
            entity_type='vehicle',
            entity_id=vehicle.id,
            details=f"Created vehicle {vehicle.name} ({vehicle.license_plate}) at {assigned_location}"
        )

        return Response(VehicleSerializer(vehicle).data, status=status.HTTP_201_CREATED)


class VehicleDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            vehicle = Vehicle.objects.get(id=pk, tenant_id=request.user.tenant_id)
            scoped_branch, err = resolve_user_branch_scope(request.user.db_user)
            if err:
                return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)
            if scoped_branch and (vehicle.images if isinstance(vehicle.images, dict) else {}).get('location') != scoped_branch:
                return Response({'error': 'Vehicle not found or does not belong to your assigned branch.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(VehicleSerializer(vehicle).data)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        if request.user.role not in ['owner', 'manager']:
            return Response({'error': 'Forbidden: Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            vehicle = Vehicle.objects.get(id=pk, tenant_id=request.user.tenant_id)
            mutation_err = validate_vehicle_mutation(request.user.db_user, vehicle, requested_location=request.data.get('location'))
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            data = request.data
            if data.get('make'): vehicle.make = data['make']
            if data.get('model'): vehicle.model = data['model']
            if data.get('year'): vehicle.year = int(data['year'])
            if data.get('licensePlate'): vehicle.license_plate = data['licensePlate']
            if data.get('dailyRate'): vehicle.daily_rate = data['dailyRate']
            if data.get('deposit'): vehicle.deposit_amount = data['deposit']
            if data.get('status'): vehicle.status = data['status']
            if data.get('odometer') is not None: vehicle.odometer = int(data['odometer'])
            if data.get('fuelLevel') is not None: vehicle.fuel_level = int(data['fuelLevel'])
            if data.get('features') is not None: vehicle.features = data['features']

            imgs = vehicle.images if isinstance(vehicle.images, dict) else {}
            if data.get('imageUrl'): imgs['imageUrl'] = data['imageUrl']
            if data.get('color'): imgs['color'] = data['color']
            if data.get('location'): imgs['location'] = data['location']
            if data.get('type'): imgs['type'] = data['type']
            vehicle.images = imgs
            vehicle.name = f"{vehicle.year} {vehicle.make} {vehicle.model}"
            vehicle.save()

            AuditLog.objects.create(
                tenant=vehicle.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='vehicle.update',
                entity_type='vehicle',
                entity_id=vehicle.id,
                details=f"Updated vehicle {vehicle.name}"
            )

            return Response(VehicleSerializer(vehicle).data)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def delete(self, request, pk):
        if request.user.role != 'owner':
            return Response({'error': 'Forbidden: Only business owner can delete vehicles.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            vehicle = Vehicle.objects.get(id=pk, tenant_id=request.user.tenant_id)
            v_name = vehicle.name
            MaintenanceRecord.objects.filter(vehicle=vehicle).delete()
            vehicle.delete()

            AuditLog.objects.create(
                tenant_id=request.user.tenant_id,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='vehicle.delete',
                entity_type='vehicle',
                entity_id=pk,
                details=f"Deleted vehicle {v_name}"
            )
            return Response({'success': True})
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)


# ----------------------------------------------------
# CUSTOMERS
# ----------------------------------------------------
class CustomerListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Customer.objects.filter(tenant_id=request.user.tenant_id)
        paginated = paginate(qs, request.query_params.get('page'), request.query_params.get('limit'))
        if paginated:
            return Response({
                'data': CustomerSerializer(paginated['data'], many=True).data,
                'pagination': paginated['pagination']
            })
        return Response(CustomerSerializer(qs, many=True).data)

    def post(self, request):
        data = request.data
        if not data.get('name') or not data.get('email') or not data.get('phone'):
            return Response({'error': 'name, email, and phone are required.'}, status=status.HTTP_400_BAD_REQUEST)

        tenant = Tenant.objects.get(id=request.user.tenant_id)
        dl_raw = data.get('driverLicense', {})
        driver_license = {
            'number': dl_raw.get('number', 'DL-PENDING'),
            'stateOrCountry': dl_raw.get('stateOrCountry', 'US'),
            'expiryDate': dl_raw.get('expiryDate', '2028-01-01'),
            'verified': False,  # Default unverified until staff check-in
            'notes': data.get('notes', '')
        }

        cust = Customer.objects.create(
            tenant=tenant,
            name=data['name'],
            email=data['email'],
            phone=data['phone'],
            address=data.get('address', ''),
            driver_license=driver_license,
            status=data.get('status', 'active')
        )

        AuditLog.objects.create(
            tenant=tenant,
            user_id=request.user.id,
            user_name=request.user.name,
            user_role=request.user.role,
            action='customer.create',
            entity_type='customer',
            entity_id=cust.id,
            details=f"Created customer {cust.name}"
        )

        return Response(CustomerSerializer(cust).data, status=status.HTTP_201_CREATED)


class CustomerDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            cust = Customer.objects.get(id=pk, tenant_id=request.user.tenant_id)
            return Response(CustomerSerializer(cust).data)
        except Customer.DoesNotExist:
            return Response({'error': 'Customer not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        if request.user.role not in ['owner', 'manager']:
            return Response({'error': 'Forbidden: Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            cust = Customer.objects.get(id=pk, tenant_id=request.user.tenant_id)
            data = request.data
            if data.get('name'): cust.name = data['name']
            if data.get('email'): cust.email = data['email']
            if data.get('phone'): cust.phone = data['phone']
            if data.get('address') is not None: cust.address = data['address']
            dl = cust.driver_license or {}
            if data.get('driverLicense'):
                dl.update(data['driverLicense'])
            if 'notes' in data:
                dl['notes'] = data['notes']
            cust.driver_license = dl
            if data.get('status'): cust.status = data['status']
            cust.save()

            AuditLog.objects.create(
                tenant=cust.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='customer.update',
                entity_type='customer',
                entity_id=cust.id,
                details=f"Updated customer {cust.name}"
            )

            return Response(CustomerSerializer(cust).data)
        except Customer.DoesNotExist:
            return Response({'error': 'Customer not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def delete(self, request, pk):
        if request.user.role not in ['owner', 'manager']:
            return Response({'error': 'Forbidden: Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            cust = Customer.objects.get(id=pk, tenant_id=request.user.tenant_id)
            c_name = cust.name
            cust.delete()

            AuditLog.objects.create(
                tenant_id=request.user.tenant_id,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='customer.delete',
                entity_type='customer',
                entity_id=pk,
                details=f"Deleted customer {c_name}"
            )
            return Response({'success': True})
        except Customer.DoesNotExist:
            return Response({'error': 'Customer not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)


# ----------------------------------------------------
# QUOTES & RENTALS
# ----------------------------------------------------
class PrivateQuoteView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            tenant = Tenant.objects.get(id=request.user.tenant_id)
            pricing = PricingService.calculate_canonical_pricing(tenant, request.data)
            return Response(pricing)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found.'}, status=status.HTTP_404_NOT_FOUND)


class RentalListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scoped_branch, err = resolve_user_branch_scope(
            request.user.db_user,
            request.query_params.get('location') or request.query_params.get('branch')
        )
        if err:
            status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(err) else status.HTTP_400_BAD_REQUEST
            return Response({'error': err}, status=status_code)

        qs = Rental.objects.filter(tenant_id=request.user.tenant_id)
        qs = filter_rentals_by_branch(qs, scoped_branch)
        paginated = paginate(qs, request.query_params.get('page'), request.query_params.get('limit'))
        if paginated:
            return Response({
                'data': RentalSerializer(paginated['data'], many=True).data,
                'pagination': paginated['pagination']
            })
        return Response(RentalSerializer(qs, many=True).data)

    def post(self, request):
        try:
            agent = request.user.db_user
            vehicle_id = request.data.get('vehicleId')
            if not vehicle_id:
                return Response({'error': 'vehicleId is required.'}, status=status.HTTP_400_BAD_REQUEST)

            vehicle = Vehicle.objects.get(id=vehicle_id, tenant_id=request.user.tenant_id)
            mutation_err = validate_rental_mutation(
                agent,
                vehicle,
                requested_location=request.data.get('pickupLocation')
            )
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            rental = BookingService.create_rental(request.user.tenant_id, request.data, agent_user=agent)
            return Response(RentalSerializer(rental).data, status=status.HTTP_201_CREATED)
        except ValueError as e:
            err_msg = str(e)
            if 'Booking conflict' in err_msg:
                return Response({'error': err_msg, 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_400_BAD_REQUEST)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)
        except IntegrityError as e:
            err_msg = str(e)
            if '23P01' in err_msg or 'no_overlapping_rentals' in err_msg or 'exclusion' in err_msg.lower():
                return Response({'error': 'Vehicle is already booked for the selected dates.', 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            err_msg = str(e)
            if '23P01' in err_msg or 'no_overlapping_rentals' in err_msg or 'exclusion' in err_msg.lower():
                return Response({'error': 'Vehicle is already booked for the selected dates.', 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RentalDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            rental = Rental.objects.get(id=pk, tenant_id=request.user.tenant_id)
            scoped_branch, err = resolve_user_branch_scope(request.user.db_user)
            if err:
                return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)
            if scoped_branch and rental.vehicle:
                v_loc = (rental.vehicle.images if isinstance(rental.vehicle.images, dict) else {}).get('location', '')
                if v_loc != scoped_branch:
                    return Response({'error': 'Rental not found or does not belong to your assigned branch.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(RentalSerializer(rental).data)
        except Rental.DoesNotExist:
            return Response({'error': 'Rental not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        try:
            rental = Rental.objects.get(id=pk, tenant_id=request.user.tenant_id)
            agent = request.user.db_user
            mutation_err = validate_rental_mutation(
                agent,
                rental.vehicle,
                rental=rental,
                requested_location=request.data.get('pickupLocation')
            )
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            updated = BookingService.update_rental(pk, request.user.tenant_id, request.data, agent_user=agent)
            if not updated:
                return Response({'error': 'Rental not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

            AuditLog.objects.create(
                tenant=updated.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='rental.update',
                entity_type='rental',
                entity_id=updated.id,
                details=f"Updated rental {updated.rental_number} (status: {updated.status})"
            )

            return Response(RentalSerializer(updated).data)
        except ValueError as e:
            err_msg = str(e)
            if 'Booking conflict' in err_msg:
                return Response({'error': err_msg, 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_400_BAD_REQUEST)
        except Rental.DoesNotExist:
            return Response({'error': 'Rental not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)
        except IntegrityError as e:
            err_msg = str(e)
            if '23P01' in err_msg or 'no_overlapping_rentals' in err_msg or 'exclusion' in err_msg.lower():
                return Response({'error': 'Vehicle is already booked for the selected dates.', 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            err_msg = str(e)
            if '23P01' in err_msg or 'no_overlapping_rentals' in err_msg or 'exclusion' in err_msg.lower():
                return Response({'error': 'Vehicle is already booked for the selected dates.', 'conflict': True}, status=status.HTTP_409_CONFLICT)
            return Response({'error': err_msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RentalCheckOutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        inspection = request.data.get('inspection')
        if not inspection:
            return Response({'error': 'Inspection payload is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rental = Rental.objects.get(id=pk, tenant_id=request.user.tenant_id)
            agent = request.user.db_user
            mutation_err = validate_rental_mutation(agent, rental.vehicle, rental=rental)
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            staff_name = f"{request.user.name} ({request.user.role})"
            rental = InspectionService.checkout(pk, request.user.tenant_id, inspection, staff_name)

            AuditLog.objects.create(
                tenant=rental.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='rental.checkout',
                entity_type='rental',
                entity_id=rental.id,
                details=f"Vehicle handed over for {rental.rental_number}"
            )

            return Response(RentalSerializer(rental).data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Rental.DoesNotExist:
            return Response({'error': 'Rental not found.'}, status=status.HTTP_404_NOT_FOUND)


class RentalCheckInView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        inspection = request.data.get('inspection')
        if not inspection:
            return Response({'error': 'Inspection payload is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rental = Rental.objects.get(id=pk, tenant_id=request.user.tenant_id)
            agent = request.user.db_user
            mutation_err = validate_rental_mutation(agent, rental.vehicle, rental=rental)
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            staff_name = f"{request.user.name} ({request.user.role})"
            rental = InspectionService.checkin(
                pk, request.user.tenant_id, inspection, staff_name, request.data.get('returnDate')
            )

            AuditLog.objects.create(
                tenant=rental.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='rental.checkin',
                entity_type='rental',
                entity_id=rental.id,
                details=f"Check-in return completed for {rental.rental_number} (odometer: {inspection.get('returnOdometer')})"
            )

            return Response(RentalSerializer(rental).data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Rental.DoesNotExist:
            return Response({'error': 'Rental not found.'}, status=status.HTTP_404_NOT_FOUND)


class RentalPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            rental = Rental.objects.get(id=pk, tenant_id=request.user.tenant_id)
            agent = request.user.db_user
            mutation_err = validate_rental_mutation(agent, rental.vehicle, rental=rental)
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            inv = rental.invoices.first()
            history = []
            if inv:
                raw = inv.payments or []
                if isinstance(raw, list):
                    for p in raw:
                        if isinstance(p, dict) and not p.get('__items'):
                            history.append(p)
                elif isinstance(raw, dict):
                    history = raw.get('history', [])

            return Response({
                'rentalId': rental.id,
                'rentalNumber': rental.rental_number,
                'totalAmount': float(rental.total_amount),
                'paidAmount': max(0.0, float(rental.total_amount - rental.balance_due)),
                'balanceDue': float(rental.balance_due),
                'status': 'paid' if rental.balance_due <= 0 else ('partial' if rental.balance_due < rental.total_amount else 'pending'),
                'paymentHistory': history
            })
        except Rental.DoesNotExist:
            return Response({'error': 'Rental not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def post(self, request, pk):
        amount = request.data.get('amount')
        method = request.data.get('method', 'Cash')
        reference = request.data.get('reference', '')
        notes = request.data.get('notes', '')

        try:
            num_amount = float(amount)
            if num_amount <= 0:
                return Response({'error': 'Payment amount must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)
        except (TypeError, ValueError):
            return Response({'error': 'Payment amount must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            rental = Rental.objects.get(id=pk, tenant_id=request.user.tenant_id)
            agent = request.user.db_user
            mutation_err = validate_rental_mutation(agent, rental.vehicle, rental=rental)
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            updated_rental, updated_invoice = PaymentService.record_rental_payment(
                pk,
                request.user.tenant_id,
                num_amount,
                method,
                reference,
                agent_user=agent,
                notes=notes
            )
            return Response(RentalSerializer(updated_rental).data)
        except Rental.DoesNotExist:
            return Response({'error': 'Rental not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ----------------------------------------------------
# INVOICES
# ----------------------------------------------------
class InvoiceListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scoped_branch, err = resolve_user_branch_scope(
            request.user.db_user,
            request.query_params.get('location') or request.query_params.get('branch')
        )
        if err:
            status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(err) else status.HTTP_400_BAD_REQUEST
            return Response({'error': err}, status=status_code)

        qs = Invoice.objects.filter(tenant_id=request.user.tenant_id)
        qs = filter_invoices_by_branch(qs, scoped_branch)
        paginated = paginate(qs, request.query_params.get('page'), request.query_params.get('limit'))
        if paginated:
            return Response({
                'data': InvoiceSerializer(paginated['data'], many=True).data,
                'pagination': paginated['pagination']
            })
        return Response(InvoiceSerializer(qs, many=True).data)


class InvoiceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            inv = Invoice.objects.get(id=pk, tenant_id=request.user.tenant_id)
            scoped_branch, err = resolve_user_branch_scope(request.user.db_user)
            if err:
                return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)
            if scoped_branch:
                v_loc = (inv.rental.vehicle.images if (inv.rental and inv.rental.vehicle and isinstance(inv.rental.vehicle.images, dict)) else {}).get('location', '')
                if v_loc != scoped_branch:
                    return Response({'error': 'Invoice not found or does not belong to your assigned branch.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(InvoiceSerializer(inv).data)
        except Invoice.DoesNotExist:
            return Response({'error': 'Invoice not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)


class InvoicePaymentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        amount = request.data.get('amount')
        method = request.data.get('method', 'Credit Card')
        reference = request.data.get('reference', '')
        notes = request.data.get('notes', '')

        try:
            num_amount = float(amount)
            if num_amount <= 0:
                return Response({'error': 'Payment amount must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)
        except (TypeError, ValueError):
            return Response({'error': 'Payment amount must be greater than zero.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            agent = User.objects.filter(id=request.user.id).first()
            inv = PaymentService.record_payment(
                pk,
                request.user.tenant_id,
                num_amount,
                method,
                reference,
                agent_user=agent,
                notes=notes
            )
            return Response(InvoiceSerializer(inv).data)
        except Invoice.DoesNotExist:
            return Response({'error': 'Invoice not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ----------------------------------------------------
# MAINTENANCE
# ----------------------------------------------------
class MaintenanceListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scoped_branch, err = resolve_user_branch_scope(
            request.user.db_user,
            request.query_params.get('location') or request.query_params.get('branch')
        )
        if err:
            status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(err) else status.HTTP_400_BAD_REQUEST
            return Response({'error': err}, status=status_code)

        qs = MaintenanceRecord.objects.filter(tenant_id=request.user.tenant_id)
        qs = filter_maintenance_by_branch(qs, scoped_branch)
        paginated = paginate(qs, request.query_params.get('page'), request.query_params.get('limit'))
        if paginated:
            return Response({
                'data': MaintenanceRecordSerializer(paginated['data'], many=True).data,
                'pagination': paginated['pagination']
            })
        return Response(MaintenanceRecordSerializer(qs, many=True).data)

    def post(self, request):
        if request.user.role not in ['owner', 'manager']:
            return Response({'error': 'Forbidden: Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

        data = request.data
        if not data.get('vehicleId'):
            return Response({'error': 'vehicleId is required.'}, status=status.HTTP_400_BAD_REQUEST)

        service_type = data.get('serviceType') or data.get('type') or 'routine'
        cost = data.get('cost') if data.get('cost') is not None else (data.get('estimatedCost') or 0)
        scheduled_date = data.get('scheduledDate') or data.get('date') or data.get('scheduledNextDate') or timezone.now().date().isoformat()
        vendor = data.get('serviceProvider') or data.get('vendor') or 'Authorized Service'
        desc = data.get('description') or data.get('notes') or f"Service: {service_type}"

        try:
            tenant = Tenant.objects.get(id=request.user.tenant_id)
            vehicle = Vehicle.objects.get(id=data['vehicleId'], tenant_id=request.user.tenant_id)

            mutation_err = validate_maintenance_mutation(request.user.db_user, vehicle)
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            rec = MaintenanceRecord.objects.create(
                tenant=tenant,
                vehicle=vehicle,
                vehicle_name=vehicle.name,
                service_type=service_type,
                description=desc,
                cost=cost,
                status=data.get('status', 'scheduled'),
                scheduled_date=scheduled_date,
                completed_date=data.get('completedDate'),
                odometer_at_service=data.get('odometerAtService', vehicle.odometer),
                vendor=vendor,
                notes=data.get('notes', '')
            )

            AuditLog.objects.create(
                tenant=tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='maintenance.create',
                entity_type='maintenance',
                entity_id=rec.id,
                details=f"Created maintenance task for {vehicle.name}: {rec.service_type}"
            )

            return Response(MaintenanceRecordSerializer(rec).data, status=status.HTTP_201_CREATED)
        except Vehicle.DoesNotExist:
            return Response({'error': 'Vehicle not found.'}, status=status.HTTP_404_NOT_FOUND)


class MaintenanceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            rec = MaintenanceRecord.objects.get(id=pk, tenant_id=request.user.tenant_id)
            scoped_branch, err = resolve_user_branch_scope(request.user.db_user)
            if err:
                return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)
            if scoped_branch and rec.vehicle:
                v_loc = (rec.vehicle.images if isinstance(rec.vehicle.images, dict) else {}).get('location', '')
                if v_loc != scoped_branch:
                    return Response({'error': 'Maintenance record not found or does not belong to your assigned branch.'}, status=status.HTTP_404_NOT_FOUND)
            return Response(MaintenanceRecordSerializer(rec).data)
        except MaintenanceRecord.DoesNotExist:
            return Response({'error': 'Maintenance record not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)

    def put(self, request, pk):
        if request.user.role not in ['owner', 'manager']:
            return Response({'error': 'Forbidden: Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            rec = MaintenanceRecord.objects.get(id=pk, tenant_id=request.user.tenant_id)
            mutation_err = validate_maintenance_mutation(request.user.db_user, rec.vehicle, record=rec)
            if mutation_err:
                status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(mutation_err) else status.HTTP_400_BAD_REQUEST
                return Response({'error': mutation_err}, status=status_code)

            data = request.data
            if data.get('serviceType') or data.get('type'):
                rec.service_type = data.get('serviceType') or data.get('type')
            if data.get('cost') is not None:
                rec.cost = data['cost']
            elif data.get('actualCost') is not None:
                rec.cost = data['actualCost']
            if data.get('status'):
                rec.status = data['status']
            if data.get('notes') is not None:
                rec.notes = data['notes']
            if data.get('completedDate'):
                rec.completed_date = data['completedDate']
            if data.get('serviceProvider') or data.get('vendor'):
                rec.vendor = data.get('serviceProvider') or data.get('vendor')
            rec.save()

            AuditLog.objects.create(
                tenant=rec.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='maintenance.update',
                entity_type='maintenance',
                entity_id=rec.id,
                details=f"Updated maintenance task for {rec.vehicle_name}: {rec.service_type}"
            )

            return Response(MaintenanceRecordSerializer(rec).data)
        except MaintenanceRecord.DoesNotExist:
            return Response({'error': 'Maintenance record not found or does not belong to your business.'}, status=status.HTTP_404_NOT_FOUND)


# ----------------------------------------------------
# ENQUIRIES & CRM
# ----------------------------------------------------
class EnquiryListCreateView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'public_enquiry'

    def get(self, request):
        if not request.user or not request.user.is_authenticated:
            return Response({'error': 'Unauthorized: Missing or invalid token.'}, status=status.HTTP_401_UNAUTHORIZED)

        qs = Enquiry.objects.filter(tenant_id=request.user.tenant_id)
        paginated = paginate(qs, request.query_params.get('page'), request.query_params.get('limit'))
        if paginated:
            return Response({
                'data': EnquirySerializer(paginated['data'], many=True).data,
                'pagination': paginated['pagination']
            })
        return Response(EnquirySerializer(qs, many=True).data)

    def post(self, request):
        tenant_id = request.data.get('tenantId') or (request.user.tenant_id if (request.user and request.user.is_authenticated) else None)
        if not tenant_id:
            return Response({'error': 'Business tenantId is required.'}, status=status.HTTP_400_BAD_REQUEST)

        enq = EnquiryService.create_enquiry(tenant_id, request.data)

        AuditLog.objects.create(
            tenant=enq.tenant,
            user_name=request.user.name if (request.user and request.user.is_authenticated) else 'System / Guest',
            user_role=request.user.role if (request.user and request.user.is_authenticated) else 'guest',
            action='enquiry.create',
            entity_type='enquiry',
            entity_id=enq.id,
            details=f"New enquiry from {enq.customer_name}"
        )

        return Response(EnquirySerializer(enq).data, status=status.HTTP_201_CREATED)


class EnquiryDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def put(self, request, pk):
        enq = EnquiryService.update_enquiry(pk, request.user.tenant_id, request.data)
        if not enq:
            return Response({'error': 'Enquiry not found.'}, status=status.HTTP_404_NOT_FOUND)

        AuditLog.objects.create(
            tenant=enq.tenant,
            user_id=request.user.id,
            user_name=request.user.name,
            user_role=request.user.role,
            action='enquiry.update',
            entity_type='enquiry',
            entity_id=enq.id,
            details=f"Updated enquiry {enq.id} (status: {enq.status})"
        )

        return Response(EnquirySerializer(enq).data)


class EnquiryConvertView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            agent = User.objects.filter(id=request.user.id).first()
            rental, enq = EnquiryService.convert_to_booking(pk, request.user.tenant_id, agent_user=agent)
            return Response({
                'success': True,
                'rental': RentalSerializer(rental).data,
                'enquiry': EnquirySerializer(enq).data
            })
        except Enquiry.DoesNotExist:
            return Response({'error': 'Enquiry not found.'}, status=status.HTTP_404_NOT_FOUND)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


# ----------------------------------------------------
# AUDIT LOGS & ANALYTICS
# ----------------------------------------------------
class AuditLogListView(APIView):
    permission_classes = [IsOwnerOrManager]

    def get(self, request):
        limit = int(request.query_params.get('limit', 100))
        logs = AuditLog.objects.filter(tenant_id=request.user.tenant_id).order_by('-created_at')[:limit]
        return Response(AuditLogSerializer(logs, many=True).data)


class AnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        scoped_branch, err = resolve_user_branch_scope(
            request.user.db_user,
            request.query_params.get('location') or request.query_params.get('branch')
        )
        if err:
            status_code = status.HTTP_403_FORBIDDEN if is_forbidden_error(err) else status.HTTP_400_BAD_REQUEST
            return Response({'error': err}, status=status_code)

        stats = AnalyticsService.get_dashboard_stats(request.user.tenant_id, branch=scoped_branch)
        return Response(stats)


# ----------------------------------------------------
# DATABASE RESET
# ----------------------------------------------------
class DatabaseResetView(APIView):
    permission_classes = [IsOwner]

    def post(self, request):
        if not settings.DEBUG or not getattr(settings, 'ENABLE_DEMO_MODE', False):
            return Response({'error': 'Reset endpoint is strictly disabled in production.'}, status=status.HTTP_403_FORBIDDEN)

        allowed_emails = [
            'alex.rivera@apexrentals.com',
            'sarah.chen@apexrentals.com',
            'jordan.lee@apexrentals.com',
            'maya.lin@coastalrentals.com',
            'marcus.vance@metrocarshare.com'
        ]
        if request.user and getattr(request.user, 'is_authenticated', False):
            user_email = getattr(request.user, 'email', '').lower()
            if user_email not in [e.lower() for e in allowed_emails]:
                return Response(
                    {'error': 'Forbidden: Database reset is restricted to demo environments.'},
                    status=status.HTTP_403_FORBIDDEN
                )

        seed_database()
        return Response({'message': 'Database reset to initial sample records'})


# ----------------------------------------------------
# TEAM MANAGEMENT & INVITATIONS
# ----------------------------------------------------
class TeamMemberListCreateView(APIView):
    """
    GET: List team members and pending invitations for the authenticated owner's tenant.
    POST: Create and send a team invitation (OWNER only, can invite MANAGER or STAFF).
    """
    permission_classes = [IsOwner]

    def get(self, request):
        tenant_id = request.user.tenant_id
        members = User.objects.filter(tenant_id=tenant_id).order_by('-created_at')
        invitations = TeamInvitation.objects.filter(tenant_id=tenant_id).order_by('-created_at')

        return Response({
            'members': TeamMemberSerializer(members, many=True).data,
            'invitations': TeamInvitationSerializer(invitations, many=True).data
        })

    def post(self, request):
        ip_address = get_client_ip(request)
        is_allowed, rate_err = check_invite_creation_rate_limits(ip_address, request.user.id)
        if not is_allowed:
            return Response({'error': rate_err}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        serializer = CreateTeamInvitationSerializer(data=request.data)
        if not serializer.is_valid():
            err_msg = next(iter(serializer.errors.values()))[0] if serializer.errors else 'Invalid input.'
            return Response({'error': str(err_msg), 'details': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

        valid_data = serializer.validated_data
        email = valid_data['email']
        name = valid_data['name']
        role = valid_data['role']
        branch = valid_data.get('branch')
        tenant = request.user.db_user.tenant

        # Validate that assigned branch belongs to the Owner's tenant
        tenant_locations = get_tenant_locations(tenant)
        if branch and branch.strip():
            matched_branch = next((loc for loc in tenant_locations if loc.lower() == branch.strip().lower()), None)
            if not matched_branch and is_valid_tenant_branch(tenant, branch):
                matched_branch = branch.strip()
            if not matched_branch:
                return Response({
                    'error': f"Branch '{branch}' does not belong to your business. Valid branches: {', '.join(tenant_locations)}"
                }, status=status.HTTP_400_BAD_REQUEST)
            branch = matched_branch
        else:
            # Fallback to primary tenant branch for manager and staff
            branch = tenant_locations[0] if tenant_locations else 'Main Station Hub'

        # Check if active or pending account with this email already exists in tenant
        existing_user = User.objects.filter(tenant_id=tenant.id, email__iexact=email).first()
        if existing_user:
            return Response({
                'error': f'A user with email {email} is already a member of your team.'
            }, status=status.HTTP_409_CONFLICT)

        # Generate cryptographically secure token & hash
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        expires_at = timezone.now() + timezone.timedelta(hours=24)

        try:
            with transaction.atomic():
                # Expire any previous pending invitations for this email in this tenant
                TeamInvitation.objects.filter(
                    tenant=tenant,
                    email__iexact=email,
                    status='pending'
                ).update(status='expired')

                invitation = TeamInvitation.objects.create(
                    tenant=tenant,
                    email=email,
                    name=name,
                    role=role,
                    branch=branch,
                    token_hash=token_hash,
                    status='pending',
                    invited_by=request.user.db_user,
                    expires_at=expires_at
                )

                # Send invitation email using Brevo
                sent = EmailService.send_team_invitation_email(
                    invitation=invitation,
                    raw_token=raw_token,
                    inviter_name=request.user.name,
                    company_name=tenant.name,
                    expires_in_hours=24
                )
                if not sent:
                    raise EmailDeliveryError("Failed to deliver team invitation email via Brevo.")

                # Audit log
                AuditLog.objects.create(
                    tenant=tenant,
                    user_id=request.user.id,
                    user_name=request.user.name,
                    user_role=request.user.role,
                    action='CREATE_INVITATION',
                    entity_type='TEAM_INVITATION',
                    entity_id=invitation.id,
                    details=f"Invited {email} as {role.upper()}",
                    ip_address=ip_address
                )

            return Response({
                'message': f'Invitation successfully sent to {email}.',
                'invitation': TeamInvitationSerializer(invitation).data
            }, status=status.HTTP_201_CREATED)

        except EmailDeliveryError as e:
            logger.warning("Email delivery failure while inviting team member %s: %s", email, str(e))
            return Response({
                'error': 'Failed to send invitation email. Please check email service configuration and try again.'
            }, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as e:
            logger.exception("Unexpected error creating team invitation for %s: %s", email, str(e))
            return Response({
                'error': 'An unexpected error occurred while creating the invitation.'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TeamInvitationValidateView(APIView):
    """
    Unauthenticated endpoint: Validates token hash and returns public invitation details.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        raw_token = request.query_params.get('token', '').strip()
        if not raw_token:
            return Response({'error': 'Invitation token is required.'}, status=status.HTTP_400_BAD_REQUEST)

        token_hash = TeamInvitation.hash_token(raw_token)
        invitation = TeamInvitation.objects.select_related('tenant').filter(token_hash=token_hash).first()

        if not invitation:
            return Response({'error': 'Invalid or unknown invitation token.'}, status=status.HTTP_404_NOT_FOUND)

        if invitation.status == 'accepted':
            return Response({'error': 'This invitation has already been accepted.'}, status=status.HTTP_410_GONE)

        if invitation.status == 'cancelled':
            return Response({'error': 'This invitation was cancelled by the organization owner.'}, status=status.HTTP_410_GONE)

        if invitation.status == 'expired' or timezone.now() > invitation.expires_at:
            if invitation.status != 'expired':
                invitation.status = 'expired'
                invitation.save(update_fields=['status'])
            return Response({'error': 'This invitation has expired (valid for 24 hours). Please request a new invitation.'}, status=status.HTTP_410_GONE)

        return Response({
            'valid': True,
            'email': invitation.email,
            'name': invitation.name,
            'role': invitation.role,
            'tenantName': invitation.tenant.name,
            'expiresAt': invitation.expires_at.isoformat()
        })


class TeamInvitationAcceptView(APIView):
    """
    Unauthenticated endpoint: Accepts invitation, validates password, creates/activates user account.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        ip_address = get_client_ip(request)
        is_allowed, rate_err = check_invite_acceptance_rate_limits(ip_address)
        if not is_allowed:
            return Response({'error': rate_err}, status=status.HTTP_429_TOO_MANY_REQUESTS)

        serializer = AcceptTeamInvitationSerializer(data=request.data)
        if not serializer.is_valid():
            err_msg = next(iter(serializer.errors.values()))[0] if serializer.errors else 'Invalid input.'
            return Response({'error': str(err_msg), 'details': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

        valid_data = serializer.validated_data
        raw_token = valid_data['token']
        password = valid_data['password']
        token_hash = TeamInvitation.hash_token(raw_token)

        with transaction.atomic():
            invitation = TeamInvitation.objects.select_for_update().select_related('tenant').filter(token_hash=token_hash).first()
            if not invitation:
                return Response({'error': 'Invalid or unknown invitation token.'}, status=status.HTTP_404_NOT_FOUND)

            if invitation.status == 'accepted':
                return Response({'error': 'This invitation has already been accepted.'}, status=status.HTTP_410_GONE)

            if invitation.status == 'cancelled':
                return Response({'error': 'This invitation was cancelled.'}, status=status.HTTP_410_GONE)

            if invitation.status == 'expired' or timezone.now() > invitation.expires_at:
                invitation.status = 'expired'
                invitation.save(update_fields=['status'])
                return Response({'error': 'This invitation has expired. Please contact your organization owner for a new invite.'}, status=status.HTTP_410_GONE)

            tenant = invitation.tenant
            clean_email = invitation.email.lower()
            clean_name = invitation.name or clean_email.split('@')[0].capitalize()
            role = invitation.role
            branch = invitation.branch

            # Validate that assigned branch still belongs to tenant; fallback safely if removed
            tenant_locations = get_tenant_locations(tenant)
            matched_branch = next((loc for loc in tenant_locations if branch and loc.lower() == branch.strip().lower()), None)
            if matched_branch:
                branch = matched_branch
            elif branch and branch.strip():
                # Preserve the invitation's specified branch if already set
                branch = branch.strip()
            else:
                branch = tenant_locations[0] if tenant_locations else 'Main Station Hub'

            # Create or update user
            user = User.objects.filter(tenant_id=tenant.id, email__iexact=clean_email).first()
            password_hash = AuthService.hash_password(password)

            if user:
                # Activate existing record
                user.name = clean_name
                user.password_hash = password_hash
                user.role = role
                user.branch = branch
                user.is_active = True
                user.email_verified_at = timezone.now()
                user.token_version = (user.token_version or 1) + 1
                user.save(update_fields=['name', 'password_hash', 'role', 'branch', 'is_active', 'email_verified_at', 'token_version'])
            else:
                user = User.objects.create(
                    tenant=tenant,
                    email=clean_email,
                    name=clean_name,
                    role=role,
                    branch=branch,
                    password_hash=password_hash,
                    is_active=True,
                    email_verified_at=timezone.now(),
                    token_version=1
                )

            # Update invitation status
            invitation.status = 'accepted'
            invitation.accepted_by = user
            invitation.accepted_at = timezone.now()
            invitation.save(update_fields=['status', 'accepted_by', 'accepted_at'])

            # Audit log
            AuditLog.objects.create(
                tenant=tenant,
                user_id=user.id,
                user_name=user.name,
                user_role=user.role,
                action='ACCEPT_INVITATION',
                entity_type='TEAM_INVITATION',
                entity_id=invitation.id,
                details=f"Accepted invitation for {clean_email} as {role.upper()}",
                ip_address=ip_address
            )

        # Generate JWT token for seamless login
        token = AuthService.generate_jwt(user)
        return Response({
            'message': 'Invitation accepted successfully. Welcome to RentFlow!',
            'token': token,
            'user': UserSerializer(user).data
        }, status=status.HTTP_200_OK)


class TeamInvitationResendView(APIView):
    """
    POST: Resend an existing pending team invitation with a refreshed token and 24h expiration.
    Enforces a 60-second cooldown per invitation.
    """
    permission_classes = [IsOwner]

    def post(self, request, invitation_id):
        tenant_id = request.user.tenant_id
        ip_address = get_client_ip(request)

        invitation = TeamInvitation.objects.select_related('tenant').filter(id=invitation_id, tenant_id=tenant_id).first()
        if not invitation:
            return Response({'error': 'Invitation not found.'}, status=status.HTTP_404_NOT_FOUND)

        if invitation.status == 'accepted':
            return Response({'error': 'Cannot resend an invitation that has already been accepted.'}, status=status.HTTP_400_BAD_REQUEST)

        # Rate-limiting cooldown: 60s
        is_cooldown_allowed, wait_seconds = check_invite_resend_cooldown(invitation.id)
        if not is_cooldown_allowed:
            return Response({
                'error': f'Please wait {wait_seconds} seconds before resending this invitation.'
            }, status=status.HTTP_429_TOO_MANY_REQUESTS)

        # Generate fresh token & hash
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        expires_at = timezone.now() + timezone.timedelta(hours=24)

        try:
            # Send email FIRST to ensure no state invalidation on delivery failure
            sent = EmailService.send_team_invitation_email(
                invitation=invitation,
                raw_token=raw_token,
                inviter_name=request.user.name,
                company_name=invitation.tenant.name,
                expires_in_hours=24
            )
            if not sent:
                raise EmailDeliveryError("Failed to deliver team invitation email via Brevo.")

            # Atomic database update only after email is successfully dispatched
            with transaction.atomic():
                invitation.token_hash = token_hash
                invitation.status = 'pending'
                invitation.expires_at = expires_at
                invitation.save(update_fields=['token_hash', 'status', 'expires_at', 'updated_at'])

                set_invite_resend_cooldown(invitation.id, 60)

                AuditLog.objects.create(
                    tenant=invitation.tenant,
                    user_id=request.user.id,
                    user_name=request.user.name,
                    user_role=request.user.role,
                    action='RESEND_INVITATION',
                    entity_type='TEAM_INVITATION',
                    entity_id=invitation.id,
                    details=f"Resent invitation to {invitation.email}",
                    ip_address=ip_address
                )

            return Response({
                'message': f'Invitation successfully resent to {invitation.email}.',
                'invitation': TeamInvitationSerializer(invitation).data
            })

        except EmailDeliveryError as e:
            logger.warning("Email delivery failure while resending invitation %s: %s", invitation_id, str(e))
            return Response({
                'error': 'Failed to send invitation email. Previous invitation state was preserved.'
            }, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as e:
            logger.exception("Unexpected error resending team invitation %s: %s", invitation_id, str(e))
            return Response({
                'error': 'An unexpected error occurred while resending the invitation.'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TeamInvitationCancelView(APIView):
    """
    POST: Cancel an unaccepted invitation.
    """
    permission_classes = [IsOwner]

    def post(self, request, invitation_id):
        tenant_id = request.user.tenant_id
        ip_address = get_client_ip(request)

        invitation = TeamInvitation.objects.filter(id=invitation_id, tenant_id=tenant_id).first()
        if not invitation:
            return Response({'error': 'Invitation not found.'}, status=status.HTTP_404_NOT_FOUND)

        if invitation.status == 'accepted':
            return Response({'error': 'Cannot cancel an invitation that has already been accepted.'}, status=status.HTTP_400_BAD_REQUEST)

        invitation.status = 'cancelled'
        invitation.cancelled_at = timezone.now()
        invitation.save(update_fields=['status', 'cancelled_at', 'updated_at'])

        AuditLog.objects.create(
            tenant=invitation.tenant,
            user_id=request.user.id,
            user_name=request.user.name,
            user_role=request.user.role,
            action='CANCEL_INVITATION',
            entity_type='TEAM_INVITATION',
            entity_id=invitation.id,
            details=f"Cancelled invitation for {invitation.email}",
            ip_address=ip_address
        )

        return Response({
            'message': 'Invitation successfully cancelled.',
            'invitation': TeamInvitationSerializer(invitation).data
        })


class TeamMemberRoleUpdateView(APIView):
    """
    PATCH: Update a team member's role (MANAGER <-> STAFF).
    Restricted to OWNER.
    Owners cannot promote to OWNER or demote/remove the last active OWNER.
    Users cannot modify their own role.
    """
    permission_classes = [IsOwner]

    def patch(self, request, member_id):
        tenant_id = request.user.tenant_id
        ip_address = get_client_ip(request)

        # Users cannot change their own role
        if str(request.user.id) == str(member_id):
            return Response({'error': 'You cannot change your own role.'}, status=status.HTTP_400_BAD_REQUEST)

        target_user = User.objects.filter(id=member_id, tenant_id=tenant_id).first()
        if not target_user:
            return Response({'error': 'Team member not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = ChangeMemberRoleSerializer(data=request.data)
        if not serializer.is_valid():
            err_msg = next(iter(serializer.errors.values()))[0] if serializer.errors else 'Invalid input.'
            return Response({'error': str(err_msg), 'details': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)

        new_role = serializer.validated_data.get('role')
        new_branch = serializer.validated_data.get('branch')

        with transaction.atomic():
            # If target user is an owner, prevent demoting the last active owner
            if target_user.role == 'owner' and new_role and new_role != 'owner':
                active_owners = User.objects.filter(tenant_id=tenant_id, role='owner', is_active=True).count()
                if active_owners <= 1:
                    return Response({
                        'error': 'Cannot change the role of the last active organization owner.'
                    }, status=status.HTTP_400_BAD_REQUEST)

            update_fields = ['token_version']
            audit_changes = []

            if new_role and new_role != target_user.role:
                old_role = target_user.role
                target_user.role = new_role
                update_fields.append('role')
                audit_changes.append(f"role from {old_role.upper()} to {new_role.upper()}")

            if new_branch is not None:
                clean_branch = new_branch.strip()
                tenant_locations = get_tenant_locations(target_user.tenant)
                if clean_branch:
                    matched_branch = next((loc for loc in tenant_locations if loc.lower() == clean_branch.lower()), None)
                    if not matched_branch and is_valid_tenant_branch(target_user.tenant, clean_branch):
                        matched_branch = clean_branch
                    if not matched_branch:
                        return Response({
                            'error': f"Branch '{new_branch}' is not a valid branch for this business. Valid branches: {', '.join(tenant_locations)}"
                        }, status=status.HTTP_400_BAD_REQUEST)
                    target_branch = matched_branch
                else:
                    target_branch = None

                if target_branch != target_user.branch:
                    old_branch = target_user.branch or 'None'
                    target_user.branch = target_branch
                    update_fields.append('branch')
                    audit_changes.append(f"branch from '{old_branch}' to '{target_branch or 'Unassigned'}'")

            # Atomically increment token_version to refresh authorization state & sessions
            target_user.token_version = (target_user.token_version or 1) + 1
            target_user.save(update_fields=update_fields)

            AuditLog.objects.create(
                tenant=target_user.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='UPDATE_MEMBER_ROLE',
                entity_type='USER',
                entity_id=target_user.id,
                details=f"Updated team member {target_user.email}: {', '.join(audit_changes) if audit_changes else 'No changes'}",
                ip_address=ip_address
            )

        return Response({
            'message': f'Team member {target_user.name} updated successfully.',
            'member': TeamMemberSerializer(target_user).data
        })


class TeamMemberDeactivateView(APIView):
    """
    POST: Deactivate an active team member.
    Revokes active sessions immediately via token_version increment.
    Prevents deactivating the last active OWNER.
    Users cannot deactivate themselves if they are the last active OWNER.
    """
    permission_classes = [IsOwner]

    def post(self, request, member_id):
        tenant_id = request.user.tenant_id
        ip_address = get_client_ip(request)

        target_user = User.objects.filter(id=member_id, tenant_id=tenant_id).first()
        if not target_user:
            return Response({'error': 'Team member not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not target_user.is_active:
            return Response({'error': 'Team member is already deactivated.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            # Prevent deactivation if target is the last active owner
            if target_user.role == 'owner':
                active_owners = User.objects.filter(tenant_id=tenant_id, role='owner', is_active=True).count()
                if active_owners <= 1:
                    return Response({
                        'error': 'Cannot deactivate the last active organization owner.'
                    }, status=status.HTTP_400_BAD_REQUEST)

            target_user.is_active = False
            # Invalidate all active JWT tokens across all sessions immediately
            target_user.token_version = (target_user.token_version or 1) + 1
            target_user.save(update_fields=['is_active', 'token_version'])

            AuditLog.objects.create(
                tenant=target_user.tenant,
                user_id=request.user.id,
                user_name=request.user.name,
                user_role=request.user.role,
                action='DEACTIVATE_MEMBER',
                entity_type='USER',
                entity_id=target_user.id,
                details=f"Deactivated team member {target_user.email}",
                ip_address=ip_address
            )

        return Response({
            'message': f'Team member {target_user.name} has been deactivated.',
            'member': TeamMemberSerializer(target_user).data
        })


class TeamMemberReactivateView(APIView):
    """
    POST: Reactivate a deactivated team member.
    """
    permission_classes = [IsOwner]

    def post(self, request, member_id):
        tenant_id = request.user.tenant_id
        ip_address = get_client_ip(request)

        target_user = User.objects.filter(id=member_id, tenant_id=tenant_id).first()
        if not target_user:
            return Response({'error': 'Team member not found.'}, status=status.HTTP_404_NOT_FOUND)

        if target_user.is_active:
            return Response({'error': 'Team member is already active.'}, status=status.HTTP_400_BAD_REQUEST)

        target_user.is_active = True
        target_user.save(update_fields=['is_active'])

        AuditLog.objects.create(
            tenant=target_user.tenant,
            user_id=request.user.id,
            user_name=request.user.name,
            user_role=request.user.role,
            action='REACTIVATE_MEMBER',
            entity_type='USER',
            entity_id=target_user.id,
            details=f"Reactivated team member {target_user.email}",
            ip_address=ip_address
        )

        return Response({
            'message': f'Team member {target_user.name} has been reactivated.',
            'member': TeamMemberSerializer(target_user).data
        })
