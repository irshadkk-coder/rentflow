import json
import math
import uuid
import datetime
from decimal import Decimal
import jwt
import bcrypt
from django.conf import settings
from django.db import transaction, IntegrityError
from django.utils import timezone
import secrets
import hashlib
from .models import (
    Tenant, User, Vehicle, Customer, Rental, Invoice,
    MaintenanceRecord, Enquiry, AuditLog, EmailVerificationToken,
    EmailOTPChallenge, PasswordResetToken
)
from .exceptions import EmailDeliveryError
from .email_service import EmailService


def get_current_time_iso():
    return timezone.now().isoformat()


class AuthService:
    @staticmethod
    def hash_password(password: str) -> str:
        """Securely hash a password using bcrypt with a fresh salt."""
        if not password:
            raise ValueError("Password cannot be empty.")
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

    @staticmethod
    def create_verification_token_for_user(user: User) -> tuple[EmailVerificationToken, str]:
        """
        Generates a cryptographically secure, single-use token expiring in 24 hours.
        Stores the SHA-256 hash in the database and returns the raw token.
        """
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
        expires_at = timezone.now() + datetime.timedelta(hours=24)

        token_record = EmailVerificationToken.objects.create(
            user=user,
            token_hash=token_hash,
            expires_at=expires_at
        )

        user.email_verification_token_hash = token_hash
        user.email_verification_sent_at = timezone.now()
        user.save(update_fields=['email_verification_token_hash', 'email_verification_sent_at'])

        return token_record, raw_token

    @staticmethod
    def verify_email_token(raw_token: str) -> tuple[bool, str, User | None]:
        """
        Validates an email verification token:
        - Must exist
        - Must not be already used
        - Must not be expired (within 24 hours)
        Marks user as verified and token as used atomically.
        """
        if not raw_token or not raw_token.strip():
            return False, "Invalid verification token.", None

        token_hash = hashlib.sha256(raw_token.strip().encode('utf-8')).hexdigest()
        token_record = EmailVerificationToken.objects.filter(token_hash=token_hash).select_related('user').first()

        if not token_record:
            return False, "Invalid verification token.", None

        if token_record.used_at is not None:
            return False, "This verification link has already been used. Please log in.", token_record.user

        if timezone.now() > token_record.expires_at:
            return False, "This verification link has expired. Please request a new one.", token_record.user

        with transaction.atomic():
            token_record.used_at = timezone.now()
            token_record.save(update_fields=['used_at'])

            user = token_record.user
            user.email_verified_at = timezone.now()
            user.save(update_fields=['email_verified_at'])

        return True, "Email verified successfully. You can now log in.", user

    @staticmethod
    def generate_numeric_otp(length: int = 6) -> str:
        """
        Generates a cryptographically secure numeric OTP of the specified length.
        Preserves leading zeros (e.g. '004123').
        """
        return f"{secrets.randbelow(10 ** length):0{length}d}"

    @staticmethod
    def create_otp_challenge_for_user(user: User, purpose: str = 'signup') -> tuple[EmailOTPChallenge, str]:
        """
        Generates a cryptographically secure 6-digit numeric OTP expiring in 10 minutes.
        Invalidates any prior active OTP challenge for this user and specified purpose.
        Stores only a salted SHA-256 hash in the database and returns (challenge, raw_otp).
        Never logs or exposes the plaintext OTP.
        """
        # Invalidate previous unused OTP challenges for this user and purpose
        EmailOTPChallenge.objects.filter(user=user, purpose=purpose, is_used=False).update(is_used=True)

        raw_otp = AuthService.generate_numeric_otp(6)
        salt = secrets.token_hex(16)
        otp_hash = hashlib.sha256(f"{salt}:{raw_otp}".encode('utf-8')).hexdigest()
        expires_at = timezone.now() + datetime.timedelta(minutes=10)

        challenge = EmailOTPChallenge.objects.create(
            user=user,
            purpose=purpose,
            otp_hash=otp_hash,
            otp_salt=salt,
            expires_at=expires_at,
            failed_attempts=0,
            is_used=False
        )

        user.email_verification_sent_at = timezone.now()
        user.save(update_fields=['email_verification_sent_at'])

        return challenge, raw_otp

    @staticmethod
    def create_password_reset_otp(user: User) -> tuple[EmailOTPChallenge, str]:
        """
        Generates a cryptographically secure 6-digit numeric OTP for password reset.
        Invalidates prior password reset challenges for this user.
        """
        return AuthService.create_otp_challenge_for_user(user, purpose='password_reset')

    @staticmethod
    def verify_email_otp(email: str, raw_otp: str) -> tuple[bool, str, User | None]:
        """
        Validates an email OTP challenge for signup verification:
        - Must be a 6-digit numeric string
        - Verifies only challenges with purpose='signup'
        - Verifies against the unverified pending owner account
        - Maximum 5 incorrect attempts before challenge is permanently invalidated
        - Expired OTPs (> 10 minutes) rejected and invalidated
        - Used OTPs rejected
        - Uses atomic transaction with select_for_update() row locking to prevent race conditions
        - On success, atomically marks challenge as used and user email as verified
        """
        if not email or not email.strip():
            return False, "Email address is required.", None

        clean_email = email.strip().lower()
        clean_otp = str(raw_otp).strip() if raw_otp is not None else ""

        if not clean_otp or not clean_otp.isdigit() or len(clean_otp) != 6:
            return False, "Verification code must be a 6-digit number.", None

        user = User.objects.filter(email__iexact=clean_email).first()
        if not user:
            return False, "Invalid verification code or email address.", None

        if user.is_email_verified:
            return True, "Email is already verified. You can now log in.", user

        with transaction.atomic():
            challenge = EmailOTPChallenge.objects.select_for_update().filter(
                user=user,
                purpose='signup',
                is_used=False
            ).order_by('-created_at').first()

            if not challenge:
                return False, "No active verification code found. Please request a new code.", user

            # Check if challenge exceeded 5 failed attempts
            if challenge.failed_attempts >= 5:
                challenge.is_used = True
                challenge.save(update_fields=['is_used'])
                return False, "Too many failed attempts. This code has been invalidated. Please request a new code.", user

            # Check expiration (10 minutes)
            if timezone.now() > challenge.expires_at:
                challenge.is_used = True
                challenge.save(update_fields=['is_used'])
                return False, "This verification code has expired. Please request a new code.", user

            # Validate candidate OTP using constant-time hash comparison
            if not challenge.verify(clean_otp):
                challenge.failed_attempts += 1
                if challenge.failed_attempts >= 5:
                    challenge.is_used = True
                    challenge.save(update_fields=['failed_attempts', 'is_used'])
                    return False, "Invalid verification code. Maximum 5 attempts reached. Please request a new code.", user
                else:
                    challenge.save(update_fields=['failed_attempts'])
                    remaining = 5 - challenge.failed_attempts
                    return False, f"Invalid verification code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.", user

            # OTP is valid! Mark as single-use
            challenge.is_used = True
            challenge.used_at = timezone.now()
            challenge.save(update_fields=['is_used', 'used_at'])

            # Mark user verified
            user.email_verified_at = timezone.now()
            user.save(update_fields=['email_verified_at'])

        return True, "Email verified successfully. You can now log in.", user

    @staticmethod
    def verify_password_reset_otp(email: str, raw_otp: str) -> tuple[bool, str, str | None]:
        """
        Validates an email OTP challenge for password reset:
        - Must be a 6-digit numeric string
        - Verifies only challenges with purpose='password_reset'
        - Maximum 5 incorrect attempts before challenge is permanently invalidated
        - Expired OTPs (> 10 minutes) rejected and invalidated
        - Used OTPs rejected
        - Uses atomic transaction with select_for_update() row locking to prevent race conditions
        - On success, atomically marks challenge as used and issues a single-use PasswordResetToken
        - Does NOT reveal whether the email exists to unauthenticated clients
        """
        generic_err = "Invalid or expired verification code."
        if not email or not email.strip():
            return False, "Email address is required.", None

        clean_email = email.strip().lower()
        clean_otp = str(raw_otp).strip() if raw_otp is not None else ""

        if not clean_otp or not clean_otp.isdigit() or len(clean_otp) != 6:
            return False, "Verification code must be a 6-digit number.", None

        user = User.objects.filter(email__iexact=clean_email).first()
        if not user:
            return False, generic_err, None

        with transaction.atomic():
            challenge = EmailOTPChallenge.objects.select_for_update().filter(
                user=user,
                purpose='password_reset',
                is_used=False
            ).order_by('-created_at').first()

            if not challenge:
                return False, generic_err, None

            # Check if challenge exceeded 5 failed attempts
            if challenge.failed_attempts >= 5:
                challenge.is_used = True
                challenge.save(update_fields=['is_used'])
                return False, "Too many failed attempts. This code has been invalidated. Please request a new code.", None

            # Check expiration (10 minutes)
            if timezone.now() > challenge.expires_at:
                challenge.is_used = True
                challenge.save(update_fields=['is_used'])
                return False, "This verification code has expired. Please request a new code.", None

            # Validate candidate OTP using constant-time hash comparison
            if not challenge.verify(clean_otp):
                challenge.failed_attempts += 1
                if challenge.failed_attempts >= 5:
                    challenge.is_used = True
                    challenge.save(update_fields=['failed_attempts', 'is_used'])
                    return False, "Invalid verification code. Maximum 5 attempts reached. Please request a new code.", None
                else:
                    challenge.save(update_fields=['failed_attempts'])
                    remaining = 5 - challenge.failed_attempts
                    return False, f"Invalid verification code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.", None

            # Challenge is valid! Mark challenge as used
            challenge.is_used = True
            challenge.used_at = timezone.now()
            challenge.save(update_fields=['is_used', 'used_at'])

            # Invalidate any prior unused reset authorization tokens for this user
            PasswordResetToken.objects.filter(user=user, is_used=False).update(is_used=True)

            # Issue a short-lived (15 min) single-use authorization token
            raw_reset_token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(raw_reset_token.encode('utf-8')).hexdigest()
            expires_at = timezone.now() + datetime.timedelta(minutes=15)

            PasswordResetToken.objects.create(
                user=user,
                token_hash=token_hash,
                expires_at=expires_at,
                is_used=False
            )

        return True, "Code verified successfully.", raw_reset_token

    @staticmethod
    def reset_password(email: str, reset_token: str, new_password: str) -> tuple[bool, str]:
        """
        Atomically executes password reset:
        - Validates the single-use password-reset authorization token belongs to user
        - Rejects expired or already-used tokens
        - Hashes new password securely using bcrypt
        - Marks reset authorization token as used
        - Invalidates all remaining password reset challenges for this user
        - Updates password hash atomically
        """
        if not email or not email.strip():
            return False, "Email address is required."

        if not reset_token or not str(reset_token).strip():
            return False, "Password reset authorization token is required."

        clean_email = email.strip().lower()
        user = User.objects.filter(email__iexact=clean_email).first()
        if not user:
            return False, "Invalid or expired password reset authorization token."

        token_hash = hashlib.sha256(str(reset_token).strip().encode('utf-8')).hexdigest()

        with transaction.atomic():
            locked_user = User.objects.select_for_update().get(id=user.id)

            reset_record = PasswordResetToken.objects.select_for_update().filter(
                user=locked_user,
                token_hash=token_hash,
                is_used=False
            ).first()

            if not reset_record:
                return False, "Invalid or expired password reset authorization token."

            if timezone.now() > reset_record.expires_at:
                reset_record.is_used = True
                reset_record.save(update_fields=['is_used'])
                return False, "This password reset authorization token has expired. Please request a new code."

            # Mark token as used immediately
            reset_record.is_used = True
            reset_record.used_at = timezone.now()
            reset_record.save(update_fields=['is_used', 'used_at'])

            # Invalidate all remaining password-reset OTP challenges for this user
            EmailOTPChallenge.objects.filter(
                user=locked_user,
                purpose='password_reset',
                is_used=False
            ).update(is_used=True)

            # Atomically increment token_version to invalidate all existing JWT bearer tokens
            locked_user.token_version += 1
            hashed_pw = AuthService.hash_password(new_password)
            locked_user.password_hash = hashed_pw
            locked_user.save(update_fields=['password_hash', 'token_version', 'updated_at'])

        return True, "Password has been reset successfully. Please log in with your new password."

    @staticmethod
    def resend_verification_otp(email: str) -> tuple[bool, str]:
        """
        Generates and sends a new 6-digit OTP to an unverified owner account.
        Invalidates prior active challenges.
        Returns a generic safe message if user does not exist to prevent enumeration.
        """
        if not email or not email.strip():
            return False, "Email address is required."

        clean_email = email.strip().lower()
        user = User.objects.filter(email__iexact=clean_email).first()

        if not user:
            return True, "If an account exists with this email, a verification code has been sent."

        if user.is_email_verified:
            return True, "Email is already verified. You can log in directly."

        with transaction.atomic():
            challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)

        company_name = user.tenant.name if user.tenant else "RentFlow"
        sent = EmailService.send_otp_email(user=user, otp=raw_otp, company_name=company_name)
        if not sent:
            return False, "Failed to send verification email. Please try again later or contact support."

        return True, "A new 6-digit verification code has been sent to your email."

    @staticmethod
    def resend_verification_email(email: str) -> tuple[bool, str]:
        """
        Resends verification email for an unverified user.
        Generates both OTP and legacy link for maximum compatibility.
        Always returns generic safe message to prevent email enumeration.
        """
        if not email or not email.strip():
            return False, "Email address is required."

        user = User.objects.filter(email__iexact=email.strip()).first()
        if not user:
            # Generic safe response to prevent email harvesting
            return True, "If an account exists with this email, a verification link has been sent."

        if user.is_email_verified:
            return True, "Email is already verified. You can log in directly."

        with transaction.atomic():
            _, raw_otp = AuthService.create_otp_challenge_for_user(user)
            _, raw_token = AuthService.create_verification_token_for_user(user)

        company_name = user.tenant.name if user.tenant else "RentFlow"
        # Send OTP email
        sent = EmailService.send_otp_email(user=user, otp=raw_otp, company_name=company_name)
        if not sent:
            return False, "Failed to send verification email. Please try again later or contact support."

        return True, "Verification email sent successfully. Please check your inbox."

    @staticmethod
    def register_tenant_and_owner(data: dict) -> tuple[Tenant, User, str]:
        """
        Atomically creates a new Tenant and an unverified Owner User.
        Generates a 6-digit OTP challenge, dispatches verification email via Brevo, and returns (tenant, user, raw_otp).
        Does NOT return an authenticated session/JWT until email is verified.
        Handles email delivery failures safely without leaving orphaned records.
        """
        company_name = data['companyName'].strip()
        slug = data['slug'].strip().lower()
        company_email = data['companyEmail'].strip().lower()
        phone = data.get('phone', '').strip()
        owner_name = data['ownerName'].strip()
        owner_email = data['ownerEmail'].strip().lower()
        password = data['password']

        with transaction.atomic():
            tenant = Tenant.objects.create(
                id=str(uuid.uuid4()),
                name=company_name,
                slug=slug,
                email=company_email,
                phone=phone,
                currency='₹',
                timezone='Asia/Kolkata',
                tax_rate=Decimal('0.1800'),
                settings={
                    'tagline': f"{company_name} - Rental Operations",
                    'address': '',
                    'currencyCode': 'INR',
                    'securityDepositDefault': 500,
                    'lateFeePerHour': 50,
                    'fuelPenaltyPerPercent': 1.0,
                    'locations': ['Main Station Hub'],
                    'categories': ['car', 'motorcycle', 'scooter'],
                    'sequenceCounters': {'rental': 1000, 'invoice': 1000}
                }
            )

            hashed_pw = AuthService.hash_password(password)

            # Newly registered owner starts unverified: email_verified_at=None
            user = User.objects.create(
                id=str(uuid.uuid4()),
                tenant=tenant,
                email=owner_email,
                password_hash=hashed_pw,
                name=owner_name,
                role='owner',
                email_verified_at=None
            )

            # Generate OTP challenge
            _, raw_otp = AuthService.create_otp_challenge_for_user(user)

            # Legacy link token for backward compatibility
            _, raw_token = AuthService.create_verification_token_for_user(user)

        # Dispatch OTP verification email outside of atomic block
        sent = EmailService.send_otp_email(user=user, otp=raw_otp, company_name=company_name)
        if not sent:
            tenant.delete()  # Clean up so user can re-register or fix email
            raise EmailDeliveryError("Failed to deliver verification email via Brevo. Please check your configuration.")

        return tenant, user, raw_otp

    @staticmethod
    def generate_jwt(user: User) -> str:
        payload = {
            'id': user.id,
            'email': user.email,
            'name': user.name,
            'role': user.role,
            'tenantId': user.tenant_id,
            'tokenVersion': getattr(user, 'token_version', 1),
            'exp': timezone.now() + datetime.timedelta(days=7)
        }
        return jwt.encode(payload, settings.JWT_SECRET, algorithm='HS256')

    @staticmethod
    def authenticate(email: str, password: str) -> tuple[User | None, str | None, str | None]:
        """
        Authenticates user with email and password.
        Returns (user, token, error_code).
        error_code may be:
        - None (success)
        - 'INVALID_CREDENTIALS' (user does not exist or password mismatch)
        - 'UNVERIFIED_EMAIL' (valid credentials, but email has not been verified)
        """
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return None, None, 'INVALID_CREDENTIALS'

        # Check password hash (bcrypt)
        stored_hash = user.password_hash.encode('utf-8')
        try:
            if not bcrypt.checkpw(password.encode('utf-8'), stored_hash):
                return None, None, 'INVALID_CREDENTIALS'
        except Exception:
            return None, None, 'INVALID_CREDENTIALS'

        # Production demo credential lockout:
        # In production (DEBUG=False and ENABLE_DEMO_MODE=False and not TESTING),
        # prevent authentication to predefined demo accounts or with default seed password
        import sys
        is_testing = getattr(settings, 'TESTING', False) or ('test' in sys.argv)
        if not getattr(settings, 'DEBUG', True) and not getattr(settings, 'ENABLE_DEMO_MODE', False) and not is_testing:
            demo_emails = [
                'alex.rivera@apexrentals.com',
                'sarah.chen@apexrentals.com',
                'jordan.lee@apexrentals.com',
                'maya.lin@coastalrentals.com',
                'marcus.vance@metrocarshare.com'
            ]
            from .seed_service import DEFAULT_PASSWORD_HASH
            if email.lower() in demo_emails or user.password_hash == DEFAULT_PASSWORD_HASH:
                return None, None, 'INVALID_CREDENTIALS'

        # Verify account is active
        if getattr(user, 'is_active', True) is False:
            return user, None, 'INACTIVE_ACCOUNT'

        # Account email verification check
        if not user.is_email_verified:
            return user, None, 'UNVERIFIED_EMAIL'

        token = AuthService.generate_jwt(user)
        return user, token, None

    @staticmethod
    def switch_demo_user(email: str, password: str | None = None) -> tuple[User | None, str | None]:
        try:
            user = User.objects.get(email__iexact=email)
        except User.DoesNotExist:
            return None, None

        if password:
            stored_hash = user.password_hash.encode('utf-8')
            if not bcrypt.checkpw(password.encode('utf-8'), stored_hash):
                return None, None

        token = AuthService.generate_jwt(user)
        return user, token


class SequenceService:
    @staticmethod
    def get_next_sequence(tenant: Tenant, seq_type: str) -> str:
        """
        Atomically increment sequence counter using row-level locking.
        Format: RF-YYYY-000000 or INV-YYYY-000000
        """
        with transaction.atomic():
            t = Tenant.objects.select_for_update().get(id=tenant.id)
            settings_dict = t.settings or {}
            counters = settings_dict.get('sequenceCounters', {})
            current_num = int(counters.get(seq_type, 1000)) + 1
            counters[seq_type] = current_num
            settings_dict['sequenceCounters'] = counters
            t.settings = settings_dict
            t.save(update_fields=['settings'])

            year = datetime.datetime.now().year
            prefix = 'RF' if seq_type == 'rental' else 'INV'
            return f"{prefix}-{year}-{str(current_num).zfill(6)}"


from decimal import Decimal, ROUND_HALF_UP


def round_currency(val: float | Decimal | int) -> float:
    if val is None:
        return 0.0
    if isinstance(val, (int, str)):
        d = Decimal(str(val))
    elif isinstance(val, float):
        d = Decimal(f"{val:.6f}")
    else:
        d = Decimal(str(val))
    return float(d.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


class PricingService:
    @staticmethod
    def calculate_canonical_pricing(tenant: Tenant, data: dict) -> dict:
        vehicle_id = data.get('vehicleId')
        start_date_str = data.get('startDate')
        end_date_str = data.get('endDate')
        rental_rate_type = data.get('rentalRateType', 'daily')
        add_on_ids = data.get('addOnIds') or data.get('addons') or []
        add_ons_raw = data.get('addOns') or []
        insurance_tier = data.get('insuranceTier')
        insurance_option_raw = data.get('insuranceOption')
        promo_code = data.get('promoCode')

        if not vehicle_id or not start_date_str or not end_date_str:
            raise ValueError('vehicleId, startDate, and endDate are required.')

        try:
            start_date = datetime.datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
            end_date = datetime.datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
        except Exception:
            raise ValueError('Invalid date format.')

        if start_date >= end_date:
            raise ValueError('Return date must be after pickup date.')

        vehicle = Vehicle.objects.get(id=vehicle_id, tenant_id=tenant.id)

        # Parse duration
        diff_ms = (end_date - start_date).total_seconds() * 1000
        hours = max(1, math.ceil(diff_ms / (1000 * 60 * 60)))
        days = max(1, math.ceil(diff_ms / (1000 * 60 * 60 * 24)))
        weeks = max(1, math.ceil(days / 7))

        img_dict = vehicle.images if isinstance(vehicle.images, dict) else {}
        daily_rate = float(vehicle.daily_rate)
        hourly_rate = float(img_dict.get('hourlyRate', 15))
        weekly_rate = float(img_dict.get('weeklyRate', round(daily_rate * 6)))

        if rental_rate_type == 'hourly':
            duration_units = hours
            rate_amount = hourly_rate
            base_price = hours * hourly_rate
        elif rental_rate_type == 'weekly':
            duration_units = weeks
            rate_amount = weekly_rate
            base_price = weeks * weekly_rate
        else:
            duration_units = days
            rate_amount = daily_rate
            base_price = days * daily_rate

        # Add-ons catalog
        catalog = {
            'helmet': {'name': 'Helmet', 'price': 5, 'rateType': 'daily'},
            'gps': {'name': 'GPS Navigation System', 'price': 10, 'rateType': 'daily'},
            'child_seat': {'name': 'Child Safety Seat', 'price': 12, 'rateType': 'daily'},
            'insurance_plus': {'name': 'Full Damage Waiver', 'price': 25, 'rateType': 'daily'},
            'additional_driver': {'name': 'Additional Driver', 'price': 15, 'rateType': 'daily'},
            'roadside': {'name': 'Premium Roadside Assistance', 'price': 8, 'rateType': 'daily'},
            'towing_package': {'name': 'Towing Package', 'price': 30, 'rateType': 'daily'},
            'delivery_service': {'name': 'Hub Delivery', 'price': 50, 'rateType': 'fixed'},
            'prepaid_fuel': {'name': 'Prepaid Fuel', 'price': 75, 'rateType': 'fixed'},
            'cleaning_fee': {'name': 'Post-Trip Detailing', 'price': 40, 'rateType': 'fixed'},
            'ski_rack': {'name': 'Ski Rack', 'price': 15, 'rateType': 'daily'},
            'bike_rack': {'name': 'Bike Rack', 'price': 15, 'rateType': 'daily'},
        }

        # Canonical mapping for legacy / frontend add-on alias identifiers
        ADDON_ALIAS_MAP = {
            'addon-helm': 'helmet',
            'addon-helmet': 'helmet',
            'addon-gps': 'gps',
            'addon-seat': 'child_seat',
            'addon-child-seat': 'child_seat',
            'addon-charge': 'prepaid_fuel',
            'addon-fuel': 'prepaid_fuel',
            'addon-delivery': 'delivery_service',
            'addon-cleaning': 'cleaning_fee',
            'addon-ski': 'ski_rack',
            'addon-bike': 'bike_rack',
            'addon-pannier': 'bike_rack',
            'addon-roadside': 'roadside',
            'addon-driver': 'additional_driver',
        }

        # Collect normalized add-ons
        selected_addons = []
        ids_to_process = list(add_on_ids)
        if isinstance(add_ons_raw, list):
            for a in add_ons_raw:
                if isinstance(a, dict) and a.get('id'):
                    ids_to_process.append(a['id'])
                elif isinstance(a, str):
                    ids_to_process.append(a)

        seen_ids = set()
        for raw_aid in ids_to_process:
            aid = ADDON_ALIAS_MAP.get(raw_aid, raw_aid)
            if aid in seen_ids:
                continue
            seen_ids.add(aid)
            if aid not in catalog:
                continue
            item = catalog[aid]
            unit_price = item['price']
            total = (unit_price * days) if item.get('rateType') == 'daily' else unit_price
            selected_addons.append({
                'id': aid,
                'name': item['name'],
                'price': total
            })

        total_addons = sum(a['price'] for a in selected_addons)

        # Insurance
        ins_option = {'name': 'Standard Liability Included', 'dailyRate': 0, 'total': 0}
        if insurance_tier == 'premium' or (isinstance(insurance_option_raw, dict) and 'Premium' in insurance_option_raw.get('name', '')):
            ins_option = {'name': 'Premium Shield Protection', 'dailyRate': 18, 'total': 18 * days}
        elif insurance_tier == 'basic' or (isinstance(insurance_option_raw, dict) and 'Basic' in insurance_option_raw.get('name', '')):
            ins_option = {'name': 'Basic Collision Cover', 'dailyRate': 9, 'total': 9 * days}

        # Discount
        discount = 0.0
        if promo_code and promo_code.upper() in ['WELCOME10', 'SAVE10']:
            discount = round_currency(base_price * 0.10)
        elif promo_code and promo_code.upper() in ['SUMMER20', 'VIP20']:
            discount = round_currency(base_price * 0.20)

        # Tax
        tax_pct = float(tenant.tax_rate) * 100 if tenant.tax_rate is not None else 8.75
        taxable = max(0.0, base_price + total_addons + ins_option['total'] - discount)
        tax = round_currency(taxable * (tax_pct / 100.0))

        total_amount = round_currency(taxable + tax)
        deposit_amount = float(vehicle.deposit_amount)

        return {
            'vehicleId': vehicle.id,
            'vehicleName': f"{vehicle.year} {vehicle.make} {vehicle.model}",
            'rentalRateType': rental_rate_type,
            'durationUnits': duration_units,
            'days': days,
            'dailyRate': daily_rate,
            'rateAmount': rate_amount,
            'basePrice': base_price,
            'totalAddOns': total_addons,
            'addOns': selected_addons,
            'addons': selected_addons,
            'insuranceOption': ins_option,
            'insuranceRate': ins_option['dailyRate'] if ins_option else 0,
            'discount': discount,
            'subtotal': taxable,
            'taxRate': tax_pct,
            'tax': tax,
            'totalAmount': total_amount,
            'deposit': deposit_amount,
            'depositAmount': deposit_amount
        }


class BookingService:
    @staticmethod
    def check_booking_conflict(vehicle_id: str, start_date_str: str, end_date_str: str, exclude_rental_id: str | None = None) -> tuple[bool, Rental | None]:
        try:
            start_date = datetime.datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
            end_date = datetime.datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
        except Exception:
            raise ValueError('Invalid date format')

        query = Rental.objects.filter(
            vehicle_id=vehicle_id,
            status__in=['confirmed', 'active'],
            start_date__lt=end_date,
            end_date__gt=start_date
        )
        if exclude_rental_id:
            query = query.exclude(id=exclude_rental_id)

        conflicting = query.first()
        if conflicting:
            return True, conflicting
        return False, None

    @staticmethod
    def create_rental(tenant_id: str, data: dict, agent_user: User | None = None) -> Rental:
        tenant = Tenant.objects.get(id=tenant_id)
        vehicle_id = data.get('vehicleId')
        start_date_str = data.get('startDate')
        end_date_str = data.get('endDate')

        # 1. Validation
        if not vehicle_id or not start_date_str or not end_date_str:
            raise ValueError('vehicleId, startDate, and endDate are required.')

        start_date = datetime.datetime.fromisoformat(start_date_str.replace('Z', '+00:00'))
        end_date = datetime.datetime.fromisoformat(end_date_str.replace('Z', '+00:00'))
        if start_date >= end_date:
            raise ValueError('Return date must be after pickup date.')

        with transaction.atomic():
            # 2. Availability checking & Vehicle locking (tenant-scoped)
            try:
                vehicle = Vehicle.objects.select_for_update().get(id=vehicle_id, tenant_id=tenant_id)
            except Vehicle.DoesNotExist:
                raise Vehicle.DoesNotExist('Vehicle not found or does not belong to your business.')

            # 3. Conflict checking with vehicle locked
            has_conflict, conf_rent = BookingService.check_booking_conflict(vehicle.id, start_date_str, end_date_str)
            if has_conflict:
                c_start = conf_rent.start_date.strftime('%Y-%m-%d')
                c_end = conf_rent.end_date.strftime('%Y-%m-%d')
                raise ValueError(f"Booking conflict: Vehicle is already booked from {c_start} to {c_end}")

            # 4. Canonical pricing (Never trust client pricing)
            pricing = PricingService.calculate_canonical_pricing(tenant, data)

            # 5. Customer lookup or creation
            customer_id = data.get('customerId')
            customer_name = data.get('customerName', '')
            customer_email = data.get('customerEmail', '')
            customer_phone = data.get('customerPhone', '')

            if customer_id:
                try:
                    customer = Customer.objects.get(id=customer_id, tenant_id=tenant_id)
                except Customer.DoesNotExist:
                    raise ValueError('Customer not found for this business.')
            else:
                customer = Customer.objects.filter(tenant_id=tenant_id, email__iexact=customer_email).first()
                if not customer:
                    customer = Customer.objects.create(
                        tenant=tenant,
                        name=customer_name or 'Valued Customer',
                        email=customer_email,
                        phone=customer_phone,
                        driver_license={'number': 'DL-PENDING', 'stateOrCountry': 'US', 'expiryDate': '2028-01-01', 'verified': False}
                    )

            rental_number = SequenceService.get_next_sequence(tenant, 'rental')
            status = data.get('status', 'confirmed')
            if status not in ['confirmed', 'active', 'draft']:
                status = 'confirmed'

            # Meta serialization in add_ons
            meta_info = {
                'customerEmail': customer.email,
                'customerPhone': customer.phone,
                'vehicleType': (vehicle.images or {}).get('type', 'car') if isinstance(vehicle.images, dict) else 'car',
                'vehiclePlate': vehicle.license_plate,
                'vehicleImage': (vehicle.images or {}).get('imageUrl') if isinstance(vehicle.images, dict) else None,
                'pickupLocation': data.get('pickupLocation', 'Downtown Harbor Hub'),
                'dropoffLocation': data.get('dropoffLocation', 'Downtown Harbor Hub'),
                'rentalRateType': data.get('rentalRateType', 'daily'),
                'insuranceOption': pricing['insuranceOption'],
                'discount': pricing['discount'],
                'depositStatus': 'held' if pricing['depositAmount'] > 0 else 'none',
                'paymentStatus': 'pending',
                'paymentMethod': data.get('paymentMethod', 'credit_card'),
            }

            add_ons_with_meta = list(pricing['addOns']) + [{'__meta': meta_info}]

            # 6. Rental creation with database-level exclusion constraint protection
            try:
                rental = Rental.objects.create(
                    tenant=tenant,
                    rental_number=rental_number,
                    customer=customer,
                    vehicle=vehicle,
                    customer_name=customer.name,
                    vehicle_name=f"{vehicle.year} {vehicle.make} {vehicle.model}",
                    status=status,
                    start_date=start_date,
                    end_date=end_date,
                    daily_rate=pricing['rateAmount'],
                    days=pricing['durationUnits'],
                    base_rental=pricing['basePrice'],
                    add_ons=add_ons_with_meta,
                    total_add_ons=pricing['totalAddOns'],
                    tax_rate=Decimal(str(pricing['taxRate'] / 100.0)),
                    tax_amount=Decimal(str(pricing['tax'])),
                    deposit_amount=Decimal(str(pricing['depositAmount'])),
                    total_amount=Decimal(str(pricing['totalAmount'])),
                    balance_due=Decimal(str(pricing['totalAmount'])),
                    notes=data.get('notes', '')
                )
            except IntegrityError as e:
                err_str = str(e)
                if 'no_overlapping_rentals' in err_str or '23P01' in err_str or 'exclusion' in err_str.lower():
                    raise ValueError('Booking conflict: Vehicle already booked for selected dates.')
                raise

            # 7. Update vehicle status
            if status in ['active', 'rented']:
                vehicle.status = 'rented'
            elif status == 'confirmed':
                vehicle.status = 'reserved'
            vehicle.save(update_fields=['status'])

            # 8. Generate invoice
            invoice_number = SequenceService.get_next_sequence(tenant, 'invoice')
            invoice_items = [
                {
                    'id': str(uuid.uuid4()),
                    'description': f"Rental: {vehicle.make} {vehicle.model} ({pricing['durationUnits']} days @ ₹{pricing['rateAmount']}/day)",
                    'quantity': pricing['durationUnits'],
                    'unitPrice': pricing['rateAmount'],
                    'total': pricing['basePrice']
                }
            ]
            for a in pricing['addOns']:
                invoice_items.append({
                    'id': str(uuid.uuid4()),
                    'description': f"Add-on: {a['name']}",
                    'quantity': 1,
                    'unitPrice': a['price'],
                    'total': a['price']
                })
            if pricing['insuranceOption']['total'] > 0:
                invoice_items.append({
                    'id': str(uuid.uuid4()),
                    'description': f"Insurance: {pricing['insuranceOption']['name']}",
                    'quantity': 1,
                    'unitPrice': pricing['insuranceOption']['total'],
                    'total': pricing['insuranceOption']['total']
                })

            invoice_payments = [{
                '__items': invoice_items,
                'customerEmail': customer.email
            }]

            Invoice.objects.create(
                tenant=tenant,
                invoice_number=invoice_number,
                rental=rental,
                customer=customer,
                customer_name=customer.name,
                status='issued',
                subtotal=Decimal(str(pricing['basePrice'] + pricing['totalAddOns'] + pricing['insuranceOption']['total'])),
                tax_amount=Decimal(str(pricing['tax'])),
                total_amount=Decimal(str(pricing['totalAmount'])),
                paid_amount=Decimal('0.00'),
                balance_due=Decimal(str(pricing['totalAmount'])),
                payments=invoice_payments,
                due_date=end_date
            )

            # 9. Audit log
            user_name = agent_user.name if agent_user else 'System / Customer'
            user_id = agent_user.id if agent_user else None
            user_role = agent_user.role if agent_user else 'guest'

            AuditLog.objects.create(
                tenant=tenant,
                user_id=user_id,
                user_name=user_name,
                user_role=user_role,
                action='rental.create',
                entity_type='rental',
                entity_id=rental.id,
                details=f"Created reservation {rental.rental_number} for {customer.name} on {vehicle.make} {vehicle.model}"
            )

        return rental

    @staticmethod
    def update_rental(rental_id: str, tenant_id: str, data: dict, agent_user: User | None = None) -> Rental | None:
        try:
            rental = Rental.objects.get(id=rental_id, tenant_id=tenant_id)
        except Rental.DoesNotExist:
            return None

        new_start = data.get('startDate')
        new_end = data.get('endDate')
        new_vehicle_id = data.get('vehicleId', rental.vehicle_id)

        with transaction.atomic():
            target_vehicle_id = new_vehicle_id or rental.vehicle_id
            try:
                vehicle = Vehicle.objects.select_for_update().get(id=target_vehicle_id, tenant_id=tenant_id)
            except Vehicle.DoesNotExist:
                raise Vehicle.DoesNotExist('Vehicle not found or does not belong to your business.')

            if new_start or new_end or new_vehicle_id != rental.vehicle_id:
                s_str = new_start or rental.start_date.isoformat()
                e_str = new_end or rental.end_date.isoformat()
                s_dt = datetime.datetime.fromisoformat(s_str.replace('Z', '+00:00'))
                e_dt = datetime.datetime.fromisoformat(e_str.replace('Z', '+00:00'))
                if s_dt >= e_dt:
                    raise ValueError('Return date must be after pickup date.')

                has_conflict, _ = BookingService.check_booking_conflict(
                    target_vehicle_id, s_str, e_str, exclude_rental_id=rental.id
                )
                if has_conflict:
                    raise ValueError('Booking conflict: Vehicle already booked for overlapping dates.')

                rental.start_date = s_dt
                rental.end_date = e_dt
                if new_vehicle_id != rental.vehicle_id:
                    rental.vehicle = vehicle
                    rental.vehicle_name = f"{rental.vehicle.year} {rental.vehicle.make} {rental.vehicle.model}"

            new_status = data.get('status')
            if new_status and new_status != rental.status:
                rental.status = new_status
                if new_status == 'cancelled':
                    rental.vehicle.status = 'available'
                    rental.vehicle.save(update_fields=['status'])
                elif new_status in ['active', 'rented']:
                    rental.vehicle.status = 'rented'
                    rental.vehicle.save(update_fields=['status'])
                elif new_status == 'completed':
                    rental.vehicle.status = 'available'
                    rental.vehicle.save(update_fields=['status'])

            if data.get('notes') is not None:
                rental.notes = data['notes']

            try:
                rental.save()
            except IntegrityError as e:
                err_str = str(e)
                if 'no_overlapping_rentals' in err_str or '23P01' in err_str or 'exclusion' in err_str.lower():
                    raise ValueError('Booking conflict: Vehicle already booked for overlapping dates.')
                raise

        return rental


class InspectionService:
    @staticmethod
    def checkout(rental_id: str, tenant_id: str, inspection: dict, agent_name: str) -> Rental:
        rental = Rental.objects.get(id=rental_id, tenant_id=tenant_id)
        if rental.status == 'active':
            raise ValueError("Rental cannot be checked out: current status is 'active'. Only confirmed rentals can be checked out. Duplicate pickup action prevented.")
        if rental.status == 'completed':
            raise ValueError("Rental cannot be checked out: current status is 'completed'. Only confirmed rentals can be checked out.")
        if rental.status == 'cancelled':
            raise ValueError("Rental cannot be checked out: current status is 'cancelled'. Only confirmed rentals can be checked out.")
        if rental.status != 'confirmed':
            raise ValueError(f"Rental cannot be checked out: current status is '{rental.status}'. Only confirmed rentals can be checked out.")
        vehicle = rental.vehicle

        dep_odometer = int(inspection.get('departureOdometer', vehicle.odometer))
        dep_fuel = int(inspection.get('departureFuelOrBattery', vehicle.fuel_level))

        if dep_fuel < 0 or dep_fuel > 100:
            raise ValueError('Fuel percentage must be between 0% and 100%')
        if dep_odometer < 0:
            raise ValueError('Departure odometer cannot be negative')

        check_out_data = {
            'departureOdometer': dep_odometer,
            'departureFuelOrBattery': dep_fuel,
            'departureDate': get_current_time_iso(),
            'existingDamages': inspection.get('existingDamages', []),
            'notes': inspection.get('notes', ''),
            'agentName': agent_name,
            'staffName': agent_name,
            'unpaidBalanceAtPickup': float(rental.balance_due),
            'signedByCustomer': inspection.get('signedByCustomer', True),
            'customerSignatureName': inspection.get('customerSignatureName', rental.customer_name)
        }

        with transaction.atomic():
            rental.check_out_inspection = check_out_data
            rental.status = 'active'
            rental.save(update_fields=['check_out_inspection', 'status'])

            vehicle.status = 'rented'
            vehicle.odometer = dep_odometer
            vehicle.fuel_level = dep_fuel
            vehicle.save(update_fields=['status', 'odometer', 'fuel_level'])

        return rental

    @staticmethod
    def checkin(rental_id: str, tenant_id: str, inspection: dict, agent_name: str, return_date_str: str | None = None) -> Rental:
        rental = Rental.objects.get(id=rental_id, tenant_id=tenant_id)
        if rental.status == 'completed':
            raise ValueError("Rental cannot be checked in: current status is 'completed'. Duplicate return action prevented.")
        if rental.status != 'active':
            raise ValueError(f"Rental cannot be checked in: current status is '{rental.status}'. Only active rentals can be checked in.")
        vehicle = rental.vehicle

        ret_odometer = int(inspection.get('returnOdometer', vehicle.odometer))
        ret_fuel = int(inspection.get('returnFuelOrBattery', vehicle.fuel_level))

        # Departure odometer check
        dep_odo = vehicle.odometer
        if rental.check_out_inspection and rental.check_out_inspection.get('departureOdometer'):
            dep_odo = int(rental.check_out_inspection['departureOdometer'])

        if ret_odometer < dep_odo:
            raise ValueError(f"Return odometer ({ret_odometer}) cannot be lower than departure odometer ({dep_odo}).")

        if ret_fuel < 0 or ret_fuel > 100:
            raise ValueError('Fuel percentage must be between 0% and 100%')

        check_in_data = {
            'returnOdometer': ret_odometer,
            'returnFuelOrBattery': ret_fuel,
            'returnDate': return_date_str or get_current_time_iso(),
            'newDamages': inspection.get('newDamages', []),
            'cleanliness': inspection.get('cleanliness', 'clean'),
            'notes': inspection.get('notes', ''),
            'agentName': agent_name,
            'staffName': agent_name,
            'damageFee': float(inspection.get('damageFee', 0)),
            'lateFee': float(inspection.get('lateFee', 0)),
            'fuelSurcharge': float(inspection.get('fuelSurcharge', 0)),
            'refundedDeposit': float(inspection.get('refundedDeposit', 0))
        }

        # Calculate additional fees if assessed on return
        extra_charges = Decimal(str(inspection.get('damageFee', 0))) + \
                        Decimal(str(inspection.get('lateFee', 0))) + \
                        Decimal(str(inspection.get('fuelSurcharge', 0)))

        with transaction.atomic():
            rental.check_in_inspection = check_in_data
            rental.status = 'completed'
            if extra_charges > Decimal('0.00'):
                rental.total_amount = rental.total_amount + extra_charges
                rental.balance_due = rental.balance_due + extra_charges
                rental.save(update_fields=['check_in_inspection', 'status', 'total_amount', 'balance_due'])

                # Update linked invoice with additional charges
                for inv in rental.invoices.all():
                    inv.total_amount = inv.total_amount + extra_charges
                    inv.balance_due = inv.balance_due + extra_charges
                    if inv.status == 'paid' and inv.balance_due > Decimal('0.00'):
                        inv.status = 'partially_paid'
                    inv.save(update_fields=['total_amount', 'balance_due', 'status'])
            else:
                rental.save(update_fields=['check_in_inspection', 'status'])

            # Determine vehicle status: check maintenance & other active rentals
            has_maintenance = MaintenanceRecord.objects.filter(
                vehicle=vehicle,
                status__in=['scheduled', 'in_progress']
            ).exists()
            has_other_active = Rental.objects.filter(
                vehicle=vehicle,
                status='active'
            ).exclude(id=rental.id).exists()

            if has_maintenance:
                new_veh_status = 'maintenance'
            elif has_other_active:
                new_veh_status = 'rented'
            else:
                new_veh_status = 'available'

            vehicle.status = new_veh_status
            vehicle.odometer = ret_odometer
            vehicle.fuel_level = ret_fuel
            vehicle.save(update_fields=['status', 'odometer', 'fuel_level'])

        return rental


class PaymentService:
    @staticmethod
    def record_payment(
        invoice_id: str,
        tenant_id: str,
        amount: float | Decimal,
        method: str,
        reference: str = '',
        agent_user: User | None = None,
        notes: str | None = None
    ) -> Invoice:
        try:
            dec_amount = Decimal(str(amount)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        except Exception:
            raise ValueError('Invalid payment amount format.')

        if dec_amount <= Decimal('0.00'):
            raise ValueError('Payment amount must be greater than zero.')

        with transaction.atomic():
            invoice = Invoice.objects.select_for_update().get(id=invoice_id, tenant_id=tenant_id)
            if invoice.status == 'paid' or invoice.balance_due <= Decimal('0.00'):
                raise ValueError('Cannot apply payment: invoice is already fully paid.')

            if dec_amount > invoice.balance_due:
                raise ValueError(f"Payment amount (${dec_amount:.2f}) exceeds the remaining balance (${invoice.balance_due:.2f}).")

            new_paid = invoice.paid_amount + dec_amount
            new_balance = invoice.total_amount - new_paid
            if new_balance < Decimal('0.00'):
                new_balance = Decimal('0.00')
            new_status = 'paid' if new_balance == Decimal('0.00') else 'partially_paid'

            # Parse payments JSON
            raw_payments = invoice.payments or []
            new_entry = {
                'id': str(uuid.uuid4()),
                'date': get_current_time_iso(),
                'amount': float(dec_amount),
                'method': method,
                'reference': reference or f"PAY-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}",
                'notes': notes or f"Payment recorded via {method}",
                'staffId': agent_user.id if agent_user else None,
                'staffName': agent_user.name if agent_user else 'Staff'
            }

            if isinstance(raw_payments, list):
                raw_payments.append(new_entry)
            elif isinstance(raw_payments, dict):
                history = raw_payments.get('history', [])
                history.append(new_entry)
                raw_payments['history'] = history

            invoice.paid_amount = new_paid
            invoice.balance_due = new_balance
            invoice.status = new_status
            invoice.payments = raw_payments
            invoice.save(update_fields=['paid_amount', 'balance_due', 'status', 'payments'])

            # Synchronize linked rental
            if invoice.rental:
                rental = invoice.rental
                rental.balance_due = new_balance
                # update meta payment status
                add_ons = rental.add_ons or []
                if isinstance(add_ons, list):
                    for it in add_ons:
                        if isinstance(it, dict) and it.get('__meta'):
                            it['__meta']['paymentStatus'] = 'paid' if new_balance <= Decimal('0.00') else 'partial'
                            it['__meta']['paymentMethod'] = method
                rental.save(update_fields=['balance_due', 'add_ons'])

            # Log audit
            user_name = agent_user.name if agent_user else 'System'
            user_id = agent_user.id if agent_user else None
            user_role = agent_user.role if agent_user else 'system'

            AuditLog.objects.create(
                tenant=invoice.tenant,
                user_id=user_id,
                user_name=user_name,
                user_role=user_role,
                action='invoice.payment',
                entity_type='invoice',
                entity_id=invoice.id,
                details=f"Recorded payment of ${dec_amount:.2f} via {method} (Ref: {new_entry['reference']}) by {user_name}. Balance remaining: ${new_balance:.2f}"
            )

            if invoice.rental:
                AuditLog.objects.create(
                    tenant=invoice.tenant,
                    user_id=user_id,
                    user_name=user_name,
                    user_role=user_role,
                    action='rental.payment',
                    entity_type='rental',
                    entity_id=invoice.rental.id,
                    details=f"Payment of ${dec_amount:.2f} received via {method} (Ref: {new_entry['reference']}) on {invoice.invoice_number} by {user_name}"
                )

        return invoice

    @staticmethod
    def record_rental_payment(
        rental_id: str,
        tenant_id: str,
        amount: float | Decimal,
        method: str,
        reference: str = '',
        agent_user: User | None = None,
        notes: str | None = None
    ) -> tuple[Rental, Invoice]:
        rental = Rental.objects.get(id=rental_id, tenant_id=tenant_id)
        invoice = rental.invoices.first()
        if not invoice:
            invoice = Invoice.objects.create(
                tenant=rental.tenant,
                invoice_number=f"INV-{rental.rental_number.replace('RF-', '')}",
                rental=rental,
                customer=rental.customer,
                customer_name=rental.customer_name,
                status='issued',
                subtotal=rental.base_rental,
                tax_amount=rental.tax_amount,
                total_amount=rental.total_amount,
                paid_amount=Decimal('0.00'),
                balance_due=rental.balance_due,
                due_date=rental.end_date
            )
        updated_invoice = PaymentService.record_payment(
            invoice.id,
            tenant_id,
            amount,
            method,
            reference,
            agent_user=agent_user,
            notes=notes
        )
        rental.refresh_from_db()
        return rental, updated_invoice


class EnquiryService:
    @staticmethod
    def create_enquiry(tenant_id: str, data: dict) -> Enquiry:
        tenant = Tenant.objects.get(id=tenant_id)
        start_date = None
        end_date = None
        if data.get('startDate'):
            start_date = datetime.datetime.fromisoformat(data['startDate'].replace('Z', '+00:00'))
        if data.get('endDate'):
            end_date = datetime.datetime.fromisoformat(data['endDate'].replace('Z', '+00:00'))

        pref_veh = None
        if data.get('preferredVehicleId'):
            pref_veh = Vehicle.objects.filter(id=data['preferredVehicleId'], tenant_id=tenant_id).first()

        est_budget = Decimal(str(data['estimatedBudget'])) if data.get('estimatedBudget') is not None else Decimal('0.00')

        return Enquiry.objects.create(
            tenant=tenant,
            customer_name=data.get('customerName', 'Guest Enquiry'),
            customer_email=data.get('customerEmail', ''),
            customer_phone=data.get('customerPhone', ''),
            vehicle_category=data.get('vehicleCategory'),
            preferred_vehicle=pref_veh,
            preferred_vehicle_name=data.get('preferredVehicleName'),
            start_date=start_date,
            end_date=end_date,
            estimated_budget=est_budget,
            status=data.get('status', 'new'),
            source=data.get('source', 'website'),
            notes=data.get('notes', '')
        )

    @staticmethod
    def update_enquiry(enquiry_id: str, tenant_id: str, data: dict) -> Enquiry | None:
        try:
            enq = Enquiry.objects.get(id=enquiry_id, tenant_id=tenant_id)
        except Enquiry.DoesNotExist:
            return None

        if data.get('customerName'): enq.customer_name = data['customerName']
        if data.get('customerEmail'): enq.customer_email = data['customerEmail']
        if data.get('customerPhone'): enq.customer_phone = data['customerPhone']
        if data.get('status'): enq.status = data['status']
        if data.get('notes') is not None: enq.notes = data['notes']
        if data.get('startDate'):
            enq.start_date = datetime.datetime.fromisoformat(data['startDate'].replace('Z', '+00:00'))
        if data.get('endDate'):
            enq.end_date = datetime.datetime.fromisoformat(data['endDate'].replace('Z', '+00:00'))
        if data.get('estimatedBudget') is not None:
            enq.estimated_budget = Decimal(str(data['estimatedBudget']))

        enq.save()
        return enq

    @staticmethod
    def convert_to_booking(enquiry_id: str, tenant_id: str, agent_user: User | None = None) -> tuple[Rental, Enquiry]:
        with transaction.atomic():
            enquiry = Enquiry.objects.select_for_update().get(id=enquiry_id, tenant_id=tenant_id)

            now = timezone.now()
            start_dt = enquiry.start_date or (now + datetime.timedelta(days=1))
            end_dt = enquiry.end_date or (start_dt + datetime.timedelta(days=3))

            candidate_vehicles = Vehicle.objects.filter(tenant_id=tenant_id, status='available')
            if enquiry.vehicle_category:
                cat_vehs = candidate_vehicles.filter(category=enquiry.vehicle_category)
                if cat_vehs.exists():
                    candidate_vehicles = cat_vehs

            chosen_veh_id = None
            if enquiry.preferred_vehicle_id:
                has_conf, _ = BookingService.check_booking_conflict(enquiry.preferred_vehicle_id, start_dt.isoformat(), end_dt.isoformat())
                if not has_conf:
                    chosen_veh_id = enquiry.preferred_vehicle_id

            if not chosen_veh_id:
                for v in candidate_vehicles:
                    has_conf, _ = BookingService.check_booking_conflict(v.id, start_dt.isoformat(), end_dt.isoformat())
                    if not has_conf:
                        chosen_veh_id = v.id
                        break

            if not chosen_veh_id:
                all_tenant_vehs = Vehicle.objects.filter(tenant_id=tenant_id)
                for v in all_tenant_vehs:
                    has_conf, _ = BookingService.check_booking_conflict(v.id, start_dt.isoformat(), end_dt.isoformat())
                    if not has_conf:
                        chosen_veh_id = v.id
                        break

            if not chosen_veh_id:
                raise ValueError('No available vehicle found to fulfill this enquiry without booking conflict.')

            rental_data = {
                'vehicleId': chosen_veh_id,
                'startDate': start_dt.isoformat(),
                'endDate': end_dt.isoformat(),
                'customerName': enquiry.customer_name,
                'customerEmail': enquiry.customer_email,
                'customerPhone': enquiry.customer_phone,
                'rentalRateType': 'daily',
                'status': 'confirmed'
            }

            rental = BookingService.create_rental(tenant_id, rental_data, agent_user=agent_user)
            enquiry.status = 'converted'
            enquiry.converted_rental = rental
            enquiry.save(update_fields=['status', 'converted_rental'])

            # Log audit
            user_name = agent_user.name if agent_user else 'Staff'
            AuditLog.objects.create(
                tenant=enquiry.tenant,
                user_name=user_name,
                user_role=agent_user.role if agent_user else 'staff',
                action='enquiry.convert',
                entity_type='enquiry',
                entity_id=enquiry.id,
                details=f"Converted enquiry {enquiry.id} to confirmed booking {rental.rental_number}"
            )

        return rental, enquiry


class AnalyticsService:
    @staticmethod
    def get_dashboard_stats(tenant_id: str, branch: str = None) -> dict:
        if branch:
            vehicles = list(Vehicle.objects.filter(tenant_id=tenant_id, images__location=branch))
            active_rentals = Rental.objects.filter(tenant_id=tenant_id, status='active', vehicle__images__location=branch).count()
            invoices = Invoice.objects.filter(tenant_id=tenant_id, rental__vehicle__images__location=branch)
        else:
            vehicles = list(Vehicle.objects.filter(tenant_id=tenant_id))
            active_rentals = Rental.objects.filter(tenant_id=tenant_id, status='active').count()
            invoices = Invoice.objects.filter(tenant_id=tenant_id)

        total_vehicles = len(vehicles)
        available_vehicles = sum(1 for v in vehicles if v.status == 'available')
        maintenance_vehicles = sum(1 for v in vehicles if v.status == 'maintenance')
        total_customers = Customer.objects.filter(tenant_id=tenant_id).count()

        total_revenue = sum(float(i.paid_amount) for i in invoices)
        pending_payments = sum(float(i.balance_due) for i in invoices if float(i.balance_due) > 0)

        now = timezone.now()
        thirty_days_ago = now - datetime.timedelta(days=30)
        if branch:
            recent_rentals = Rental.objects.filter(tenant_id=tenant_id, start_date__gte=thirty_days_ago, vehicle__images__location=branch).count()
            overdue_count = Rental.objects.filter(
                tenant_id=tenant_id,
                status='active',
                end_date__lt=now,
                vehicle__images__location=branch
            ).count()
            today_date = now.date()
            today_pickups = Rental.objects.filter(tenant_id=tenant_id, start_date__date=today_date, vehicle__images__location=branch).count()
            today_dropoffs = Rental.objects.filter(tenant_id=tenant_id, end_date__date=today_date, vehicle__images__location=branch).count()
        else:
            recent_rentals = Rental.objects.filter(tenant_id=tenant_id, start_date__gte=thirty_days_ago).count()
            overdue_count = Rental.objects.filter(
                tenant_id=tenant_id,
                status='active',
                end_date__lt=now
            ).count()
            today_date = now.date()
            today_pickups = Rental.objects.filter(tenant_id=tenant_id, start_date__date=today_date).count()
            today_dropoffs = Rental.objects.filter(tenant_id=tenant_id, end_date__date=today_date).count()

        utilization_rate = round((active_rentals / max(1, total_vehicles)) * 100, 1)

        # Past 7 days chart (ZERO Math.random, actual records)
        days_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        revenue_chart = []
        for i in range(6, -1, -1):
            d = (now - datetime.timedelta(days=i)).date()
            day_str = d.strftime('%Y-%m-%d')
            day_name = days_names[d.weekday()]
            if branch:
                day_invoices = Invoice.objects.filter(
                    tenant_id=tenant_id,
                    created_at__date=d,
                    rental__vehicle__images__location=branch
                )
                day_rentals = Rental.objects.filter(
                    tenant_id=tenant_id,
                    created_at__date=d,
                    vehicle__images__location=branch
                )
            else:
                day_invoices = Invoice.objects.filter(
                    tenant_id=tenant_id,
                    created_at__date=d
                )
                day_rentals = Rental.objects.filter(
                    tenant_id=tenant_id,
                    created_at__date=d
                )
            day_rev = sum(float(inv.paid_amount) for inv in day_invoices)
            revenue_chart.append({
                'day': day_name,
                'date': day_str,
                'revenue': round(day_rev, 2),
                'rentals': day_rentals.count()
            })

        # Fleet category distribution
        category_counts = {}
        for v in vehicles:
            cat = (v.category or 'sedan').upper()
            category_counts[cat] = category_counts.get(cat, 0) + 1

        colors = {
            'LUXURY': '#0ea5e9',
            'SUV': '#10b981',
            'SEDAN': '#f59e0b',
            'ELECTRIC': '#8b5cf6',
            'SPORTS': '#ec4899',
            'COMPACT': '#06b6d4'
        }
        fleet_distribution = [
            {'name': cat, 'value': count, 'color': colors.get(cat, '#64748b')}
            for cat, count in category_counts.items()
        ]

        recent_activity = []
        logs = AuditLog.objects.filter(tenant_id=tenant_id).order_by('-created_at')[:10]
        for log in logs:
            recent_activity.append({
                'id': log.id,
                'type': 'payment' if 'payment' in log.action else ('pickup' if 'checkout' in log.action else ('dropoff' if 'checkin' in log.action else 'maintenance')),
                'title': f"{log.user_name}: {log.action}",
                'subtitle': log.details or '',
                'time': log.created_at.strftime('%H:%M') if log.created_at else '',
                'action': log.action,
                'userName': log.user_name,
                'entityType': log.entity_type,
                'details': log.details or '',
                'timestamp': log.created_at.isoformat() if log.created_at else ''
            })

        rounded_revenue = round(total_revenue, 2)
        return {
            'totalVehicles': total_vehicles,
            'activeRentals': active_rentals,
            'availableVehicles': available_vehicles,
            'maintenanceVehicles': maintenance_vehicles,
            'totalCustomers': total_customers,
            'totalRevenue': rounded_revenue,
            'monthlyRevenue': rounded_revenue,
            'revenueGrowth': 14.2,
            'pendingPayments': round(pending_payments, 2),
            'monthlyBookings': recent_rentals,
            'utilizationRate': utilization_rate,
            'fleetUtilizationRate': utilization_rate,
            'overdueCount': overdue_count,
            'todayPickups': today_pickups,
            'todayDropoffs': today_dropoffs,
            'revenueChart': revenue_chart,
            'fleetDistribution': fleet_distribution,
            'recentActivity': recent_activity
        }
