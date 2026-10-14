import re
import uuid
from django.utils.text import slugify
from rest_framework import serializers
from .models import (
    Tenant, User, Vehicle, Customer, Rental, Invoice,
    MaintenanceRecord, Enquiry, AuditLog, TeamInvitation
)
from .anti_spam import validate_phone


class TenantSerializer(serializers.ModelSerializer):
    currencyCode = serializers.SerializerMethodField()
    taxRate = serializers.SerializerMethodField()
    tagline = serializers.SerializerMethodField()
    address = serializers.SerializerMethodField()
    securityDepositDefault = serializers.SerializerMethodField()
    lateFeePerHour = serializers.SerializerMethodField()
    fuelPenaltyPerPercent = serializers.SerializerMethodField()
    locations = serializers.SerializerMethodField()
    categories = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            'id', 'name', 'slug', 'email', 'phone', 'currency', 'currencyCode',
            'timezone', 'taxRate', 'tagline', 'address', 'securityDepositDefault',
            'lateFeePerHour', 'fuelPenaltyPerPercent', 'locations', 'categories'
        ]

    def _get_settings(self, obj):
        return obj.settings or {}

    def get_currencyCode(self, obj):
        return self._get_settings(obj).get('currencyCode', 'INR')

    def get_taxRate(self, obj):
        if obj.tax_rate is not None:
            return round(float(obj.tax_rate) * 100, 2)
        return float(self._get_settings(obj).get('taxRate', 8.75))

    def get_tagline(self, obj):
        return self._get_settings(obj).get('tagline', '')

    def get_address(self, obj):
        return self._get_settings(obj).get('address', '')

    def get_securityDepositDefault(self, obj):
        return float(self._get_settings(obj).get('securityDepositDefault', 250))

    def get_lateFeePerHour(self, obj):
        return float(self._get_settings(obj).get('lateFeePerHour', 25))

    def get_fuelPenaltyPerPercent(self, obj):
        return float(self._get_settings(obj).get('fuelPenaltyPerPercent', 0.85))

    def get_locations(self, obj):
        return self._get_settings(obj).get('locations', ['Downtown Harbor Hub', 'SFO Airport Terminal', 'Marina Bay Outpost'])

    def get_categories(self, obj):
        return self._get_settings(obj).get('categories', ['car', 'motorcycle', 'ebike', 'scooter'])


class PublicTenantSerializer(serializers.ModelSerializer):
    currencyCode = serializers.SerializerMethodField()
    tagline = serializers.SerializerMethodField()
    locations = serializers.SerializerMethodField()
    categories = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            'id', 'name', 'slug', 'currency', 'currencyCode',
            'tagline', 'locations', 'categories'
        ]

    def _get_settings(self, obj):
        return obj.settings or {}

    def get_currencyCode(self, obj):
        return self._get_settings(obj).get('currencyCode', 'INR')

    def get_tagline(self, obj):
        return self._get_settings(obj).get('tagline', '')

    def get_locations(self, obj):
        return self._get_settings(obj).get('locations', ['Downtown Harbor Hub', 'SFO Airport Terminal', 'Marina Bay Outpost'])

    def get_categories(self, obj):
        return self._get_settings(obj).get('categories', ['car', 'motorcycle', 'ebike', 'scooter'])


class PublicBookingCreateSerializer(serializers.Serializer):
    slug = serializers.CharField(required=False, allow_blank=True)
    tenantId = serializers.CharField(required=False, allow_blank=True)
    vehicleId = serializers.CharField(required=True)
    startDate = serializers.CharField(required=True)
    endDate = serializers.CharField(required=True)
    customerName = serializers.CharField(required=True, max_length=255)
    customerEmail = serializers.CharField(required=False, allow_blank=True, default='')
    customerPhone = serializers.CharField(required=True, max_length=50)
    pickupLocation = serializers.CharField(required=False, default='Downtown Harbor Hub', max_length=255)
    dropoffLocation = serializers.CharField(required=False, default='Downtown Harbor Hub', max_length=255)
    rentalRateType = serializers.CharField(required=False, default='daily', max_length=32)
    insuranceOption = serializers.CharField(required=False, allow_blank=True, default='basic')
    notes = serializers.CharField(required=False, allow_blank=True, default='')
    addOns = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    addOnIds = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    captchaToken = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_customerName(self, value):
        val = value.strip()
        if len(val) < 2:
            raise serializers.ValidationError("Please provide your full name.")
        return val

    def validate_customerPhone(self, value):
        is_valid, res = validate_phone(value)
        if not is_valid:
            raise serializers.ValidationError(res)
        return res

    def validate_customerEmail(self, value):
        if not value or not value.strip():
            return ""
        val = value.strip().lower()
        email_pattern = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
        if not re.match(email_pattern, val):
            raise serializers.ValidationError("Please enter a valid email address.")
        return val

    def validate(self, data):
        start_raw = data.get('startDate')
        end_raw = data.get('endDate')
        try:
            from django.utils.dateparse import parse_datetime
            start_dt = parse_datetime(start_raw) if start_raw else None
            end_dt = parse_datetime(end_raw) if end_raw else None
            if not start_dt or not end_dt:
                raise ValueError("Dates must be valid ISO format.")
            if start_dt >= end_dt:
                raise serializers.ValidationError({'endDate': "Return date must be after pickup date."})
        except Exception as e:
            if isinstance(e, serializers.ValidationError):
                raise e
            raise serializers.ValidationError({'startDate': "Invalid rental dates specified."})
        return data


class TenantRegistrationSerializer(serializers.Serializer):
    companyName = serializers.CharField(max_length=255, required=True, trim_whitespace=True)
    companyEmail = serializers.EmailField(max_length=255, required=True)
    phone = serializers.CharField(max_length=50, required=True, trim_whitespace=True)
    ownerName = serializers.CharField(max_length=255, required=True, trim_whitespace=True)
    ownerEmail = serializers.EmailField(max_length=255, required=True)
    password = serializers.CharField(max_length=128, required=True, write_only=True)
    confirmPassword = serializers.CharField(max_length=128, required=True, write_only=True)
    captchaToken = serializers.CharField(max_length=1024, required=False, allow_blank=True, default='')

    def validate_companyName(self, value):
        val = value.strip()
        if len(val) < 2:
            raise serializers.ValidationError("Company name must be at least 2 characters long.")
        return val

    def validate_phone(self, value):
        val = value.strip()
        if len(val) < 5:
            raise serializers.ValidationError("Please provide a valid contact phone number.")
        return val

    def validate_ownerEmail(self, value):
        email = value.strip().lower()
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email address already exists.")
        return email

    def validate(self, data):
        pwd = data.get('password', '')
        confirm_pwd = data.get('confirmPassword', '')

        if pwd != confirm_pwd:
            raise serializers.ValidationError({'confirmPassword': "Passwords do not match."})

        if len(pwd) < 8:
            raise serializers.ValidationError({'password': "Password must be at least 8 characters long."})

        if not re.search(r'[A-Za-z]', pwd) or not re.search(r'[0-9]', pwd):
            raise serializers.ValidationError({'password': "Password must contain at least one letter and one number."})

        # Generate unique URL slug from companyName
        slug = slugify(data['companyName'])
        if not slug:
            slug = f"biz-{uuid.uuid4().hex[:6]}"

        if Tenant.objects.filter(slug__iexact=slug).exists():
            raise serializers.ValidationError({
                'companyName': f"A company with the identifier '{slug}' already exists. Please choose a different company name."
            })

        data['slug'] = slug
        return data


class ForgotPasswordRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)

    def validate_email(self, value):
        return value.strip().lower()


class VerifyPasswordResetOTPSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)
    otp = serializers.CharField(required=True, max_length=6, min_length=6, trim_whitespace=True)

    def validate_email(self, value):
        return value.strip().lower()

    def validate_otp(self, value):
        clean_otp = value.strip()
        if not clean_otp.isdigit() or len(clean_otp) != 6:
            raise serializers.ValidationError("Verification code must be a 6-digit number.")
        return clean_otp


class ResetPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)
    resetToken = serializers.CharField(required=True, trim_whitespace=True)
    newPassword = serializers.CharField(max_length=128, required=True, write_only=True)
    confirmPassword = serializers.CharField(max_length=128, required=True, write_only=True)

    def validate_email(self, value):
        return value.strip().lower()

    def validate(self, data):
        pwd = data.get('newPassword', '')
        confirm_pwd = data.get('confirmPassword', '')

        if pwd != confirm_pwd:
            raise serializers.ValidationError({'confirmPassword': "Passwords do not match."})

        if len(pwd) < 8:
            raise serializers.ValidationError({'newPassword': "Password must be at least 8 characters long."})

        if not re.search(r'[A-Za-z]', pwd) or not re.search(r'[0-9]', pwd):
            raise serializers.ValidationError({'newPassword': "Password must contain at least one letter and one number."})

        return data


class UserSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    createdAt = serializers.SerializerMethodField()
    emailVerified = serializers.SerializerMethodField()
    emailVerifiedAt = serializers.SerializerMethodField()
    isDemo = serializers.SerializerMethodField()
    isActive = serializers.BooleanField(source='is_active', default=True)
    branch = serializers.CharField(required=False, allow_null=True)

    class Meta:
        model = User
        fields = ['id', 'tenantId', 'email', 'name', 'role', 'branch', 'isActive', 'createdAt', 'emailVerified', 'emailVerifiedAt', 'isDemo']

    def get_createdAt(self, obj):
        return obj.created_at.isoformat() if obj.created_at else None

    def get_emailVerified(self, obj):
        return obj.email_verified_at is not None

    def get_emailVerifiedAt(self, obj):
        return obj.email_verified_at.isoformat() if obj.email_verified_at else None

    def get_isDemo(self, obj):
        allowed_emails = [
            'alex.rivera@apexrentals.com',
            'sarah.chen@apexrentals.com',
            'jordan.lee@apexrentals.com',
            'maya.lin@coastalrentals.com',
            'marcus.vance@metrocarshare.com'
        ]
        return getattr(obj, 'email', '').lower() in [e.lower() for e in allowed_emails]


class TeamMemberSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    createdAt = serializers.SerializerMethodField()
    isActive = serializers.BooleanField(source='is_active')
    emailVerified = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'tenantId', 'email', 'name', 'role', 'branch',
            'isActive', 'emailVerified', 'createdAt'
        ]

    def get_createdAt(self, obj):
        return obj.created_at.isoformat() if obj.created_at else None

    def get_emailVerified(self, obj):
        return obj.email_verified_at is not None


class TeamInvitationSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    invitedByName = serializers.SerializerMethodField()
    createdAt = serializers.SerializerMethodField()
    expiresAt = serializers.SerializerMethodField()
    isExpired = serializers.SerializerMethodField()

    class Meta:
        model = TeamInvitation
        fields = [
            'id', 'tenantId', 'email', 'name', 'role', 'branch',
            'status', 'invitedByName', 'createdAt', 'expiresAt', 'isExpired'
        ]

    def get_invitedByName(self, obj):
        return obj.invited_by.name if obj.invited_by else "Owner"

    def get_createdAt(self, obj):
        return obj.created_at.isoformat() if obj.created_at else None

    def get_expiresAt(self, obj):
        return obj.expires_at.isoformat() if obj.expires_at else None

    def get_isExpired(self, obj):
        return obj.is_currently_expired()


class CreateTeamInvitationSerializer(serializers.Serializer):
    name = serializers.CharField(required=True, max_length=255)
    email = serializers.EmailField(required=True)
    role = serializers.ChoiceField(choices=['manager', 'staff'], required=True)
    branch = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_name(self, value):
        val = value.strip()
        if len(val) < 2:
            raise serializers.ValidationError("Full name must be at least 2 characters.")
        return val

    def validate_email(self, value):
        return value.strip().lower()

    def validate_role(self, value):
        val = value.strip().lower()
        if val not in ['manager', 'staff']:
            raise serializers.ValidationError("Only MANAGER or STAFF roles can be assigned via team invitations.")
        return val


class AcceptTeamInvitationSerializer(serializers.Serializer):
    token = serializers.CharField(required=True)
    password = serializers.CharField(required=True, min_length=8, write_only=True)
    confirmPassword = serializers.CharField(required=False, min_length=8, write_only=True)

    def validate_password(self, value):
        if not re.search(r'[A-Za-z]', value) or not re.search(r'\d', value):
            raise serializers.ValidationError("Password must contain at least one letter and one number.")
        return value

    def validate(self, data):
        if 'confirmPassword' in data and data.get('password') != data.get('confirmPassword'):
            raise serializers.ValidationError({'confirmPassword': 'Passwords do not match.'})
        return data


class ChangeMemberRoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=['manager', 'staff'], required=False)
    branch = serializers.CharField(required=False, allow_blank=True)

    def validate_role(self, value):
        if value:
            val = value.strip().lower()
            if val not in ['manager', 'staff']:
                raise serializers.ValidationError("Role can only be changed to MANAGER or STAFF.")
            return val
        return value

    def validate(self, data):
        if not data.get('role') and not data.get('branch'):
            raise serializers.ValidationError("Either role or branch must be provided.")
        return data


class VehicleSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    licensePlate = serializers.CharField(source='license_plate')
    dailyRate = serializers.SerializerMethodField()
    deposit = serializers.SerializerMethodField()
    hourlyRate = serializers.SerializerMethodField()
    weeklyRate = serializers.SerializerMethodField()
    brand = serializers.CharField(source='make')
    type = serializers.SerializerMethodField()
    color = serializers.SerializerMethodField()
    location = serializers.SerializerMethodField()
    imageUrl = serializers.SerializerMethodField()
    transmission = serializers.SerializerMethodField()
    seats = serializers.SerializerMethodField()
    batteryLevel = serializers.SerializerMethodField()
    fuelLevel = serializers.IntegerField(source='fuel_level')
    lastServiceDate = serializers.SerializerMethodField()
    nextServiceOdometer = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = [
            'id', 'tenantId', 'name', 'type', 'category', 'brand', 'model', 'year',
            'licensePlate', 'vin', 'color', 'status', 'location', 'hourlyRate',
            'dailyRate', 'weeklyRate', 'deposit', 'odometer', 'fuelLevel',
            'batteryLevel', 'transmission', 'seats', 'features', 'imageUrl',
            'lastServiceDate', 'nextServiceOdometer'
        ]

    def _get_img_dict(self, obj):
        imgs = obj.images
        if isinstance(imgs, dict):
            return imgs
        return {}

    def get_dailyRate(self, obj):
        return float(obj.daily_rate)

    def get_deposit(self, obj):
        return float(obj.deposit_amount)

    def get_hourlyRate(self, obj):
        return float(self._get_img_dict(obj).get('hourlyRate', 15))

    def get_weeklyRate(self, obj):
        d = float(obj.daily_rate)
        return float(self._get_img_dict(obj).get('weeklyRate', round(d * 6)))

    def get_type(self, obj):
        return self._get_img_dict(obj).get('type', 'car')

    def get_color(self, obj):
        return self._get_img_dict(obj).get('color', 'Standard')

    def get_location(self, obj):
        return self._get_img_dict(obj).get('location', 'Main Hub')

    def get_imageUrl(self, obj):
        imgs = obj.images
        if isinstance(imgs, list) and len(imgs) > 0 and isinstance(imgs[0], str):
            return imgs[0]
        if isinstance(imgs, dict):
            if imgs.get('imageUrl'):
                return imgs['imageUrl']
            if isinstance(imgs.get('urls'), list) and len(imgs['urls']) > 0:
                return imgs['urls'][0]
        return 'https://images.unsplash.com/photo-1568844293986-8d0400bd4745?auto=format&fit=crop&w=800&q=80'

    def get_transmission(self, obj):
        return self._get_img_dict(obj).get('transmission', 'Automatic')

    def get_seats(self, obj):
        return int(self._get_img_dict(obj).get('seats', 2))

    def get_batteryLevel(self, obj):
        val = self._get_img_dict(obj).get('batteryLevel')
        return int(val) if val is not None else None

    def get_lastServiceDate(self, obj):
        return self._get_img_dict(obj).get('lastServiceDate', '2026-09-01')

    def get_nextServiceOdometer(self, obj):
        return int(self._get_img_dict(obj).get('nextServiceOdometer', obj.odometer + 5000))


class PublicVehicleSerializer(VehicleSerializer):
    class Meta(VehicleSerializer.Meta):
        fields = [
            'id', 'tenantId', 'name', 'type', 'category', 'brand', 'model', 'year',
            'color', 'status', 'location', 'hourlyRate', 'dailyRate', 'weeklyRate',
            'deposit', 'fuelLevel', 'batteryLevel', 'transmission', 'seats',
            'features', 'imageUrl'
        ]


class CustomerSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    driverLicense = serializers.SerializerMethodField()
    totalRentals = serializers.IntegerField(source='total_rentals')
    totalSpent = serializers.SerializerMethodField()
    rating = serializers.SerializerMethodField()
    notes = serializers.SerializerMethodField()
    createdAt = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            'id', 'tenantId', 'name', 'email', 'phone', 'driverLicense',
            'address', 'totalRentals', 'totalSpent', 'rating', 'status',
            'notes', 'createdAt'
        ]

    def get_notes(self, obj):
        dl = obj.driver_license or {}
        return dl.get('notes', '')

    def get_driverLicense(self, obj):
        dl = obj.driver_license or {}
        return {
            'number': dl.get('number', 'DL-PENDING'),
            'stateOrCountry': dl.get('stateOrCountry', 'US'),
            'expiryDate': dl.get('expiryDate', '2028-01-01'),
            'verified': bool(dl.get('verified', False))
        }

    def get_totalSpent(self, obj):
        return float(obj.total_spent)

    def get_rating(self, obj):
        return float(obj.rating) if obj.rating is not None else 5.0

    def get_createdAt(self, obj):
        return obj.created_at.strftime('%Y-%m-%d') if obj.created_at else None


class RentalSerializer(serializers.ModelSerializer):
    rentalNumber = serializers.CharField(source='rental_number')
    tenantId = serializers.CharField(source='tenant_id')
    customerId = serializers.CharField(source='customer_id')
    customerName = serializers.CharField(source='customer_name')
    customerEmail = serializers.SerializerMethodField()
    customerPhone = serializers.SerializerMethodField()
    vehicleId = serializers.CharField(source='vehicle_id')
    vehicleName = serializers.CharField(source='vehicle_name')
    vehicleType = serializers.SerializerMethodField()
    vehiclePlate = serializers.SerializerMethodField()
    vehicleImage = serializers.SerializerMethodField()
    pickupLocation = serializers.SerializerMethodField()
    dropoffLocation = serializers.SerializerMethodField()
    startDate = serializers.SerializerMethodField()
    endDate = serializers.SerializerMethodField()
    actualReturnDate = serializers.SerializerMethodField()
    rentalRateType = serializers.SerializerMethodField()
    rateAmount = serializers.SerializerMethodField()
    durationUnits = serializers.IntegerField(source='days')
    basePrice = serializers.SerializerMethodField()
    addOns = serializers.SerializerMethodField()
    insuranceOption = serializers.SerializerMethodField()
    discount = serializers.SerializerMethodField()
    tax = serializers.SerializerMethodField()
    totalAmount = serializers.SerializerMethodField()
    depositAmount = serializers.SerializerMethodField()
    depositStatus = serializers.SerializerMethodField()
    paymentStatus = serializers.SerializerMethodField()
    paymentMethod = serializers.SerializerMethodField()
    balanceDue = serializers.SerializerMethodField()
    paidAmount = serializers.SerializerMethodField()
    paymentHistory = serializers.SerializerMethodField()
    invoiceId = serializers.SerializerMethodField()
    checkOutInspection = serializers.JSONField(source='check_out_inspection', allow_null=True)
    checkInInspection = serializers.JSONField(source='check_in_inspection', allow_null=True)
    createdAt = serializers.SerializerMethodField()

    class Meta:
        model = Rental
        fields = [
            'id', 'rentalNumber', 'tenantId', 'customerId', 'customerName',
            'customerEmail', 'customerPhone', 'vehicleId', 'vehicleName',
            'vehicleType', 'vehiclePlate', 'vehicleImage', 'pickupLocation',
            'dropoffLocation', 'startDate', 'endDate', 'actualReturnDate',
            'status', 'rentalRateType', 'rateAmount', 'durationUnits',
            'basePrice', 'addOns', 'insuranceOption', 'discount', 'tax',
            'totalAmount', 'depositAmount', 'depositStatus', 'paymentStatus',
            'paymentMethod', 'balanceDue', 'paidAmount', 'paymentHistory',
            'invoiceId', 'checkOutInspection', 'checkInInspection',
            'notes', 'createdAt'
        ]

    def _get_meta(self, obj):
        raw = obj.add_ons or []
        if isinstance(raw, list):
            for it in raw:
                if isinstance(it, dict) and it.get('__meta'):
                    return it['__meta']
        elif isinstance(raw, dict):
            return raw.get('meta', {})
        return {}

    def get_customerEmail(self, obj):
        meta = self._get_meta(obj)
        return meta.get('customerEmail') or (obj.customer.email if obj.customer else '')

    def get_customerPhone(self, obj):
        meta = self._get_meta(obj)
        return meta.get('customerPhone') or (obj.customer.phone if obj.customer else '')

    def get_vehicleType(self, obj):
        meta = self._get_meta(obj)
        if meta.get('vehicleType'):
            return meta['vehicleType']
        if obj.vehicle and isinstance(obj.vehicle.images, dict):
            return obj.vehicle.images.get('type', 'car')
        return 'car'

    def get_vehiclePlate(self, obj):
        meta = self._get_meta(obj)
        return meta.get('vehiclePlate') or (obj.vehicle.license_plate if obj.vehicle else '')

    def get_vehicleImage(self, obj):
        meta = self._get_meta(obj)
        if meta.get('vehicleImage'):
            return meta['vehicleImage']
        if obj.vehicle and isinstance(obj.vehicle.images, dict):
            return obj.vehicle.images.get('imageUrl', 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=800&q=80')
        return 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=800&q=80'

    def get_pickupLocation(self, obj):
        return self._get_meta(obj).get('pickupLocation', 'Downtown Harbor Hub')

    def get_dropoffLocation(self, obj):
        return self._get_meta(obj).get('dropoffLocation', 'Downtown Harbor Hub')

    def get_startDate(self, obj):
        return obj.start_date.isoformat() if obj.start_date else None

    def get_endDate(self, obj):
        return obj.end_date.isoformat() if obj.end_date else None

    def get_actualReturnDate(self, obj):
        return self._get_meta(obj).get('actualReturnDate')

    def get_rentalRateType(self, obj):
        return self._get_meta(obj).get('rentalRateType', 'daily')

    def get_rateAmount(self, obj):
        return float(obj.daily_rate)

    def get_basePrice(self, obj):
        return float(obj.base_rental)

    def get_addOns(self, obj):
        raw = obj.add_ons or []
        items = []
        if isinstance(raw, list):
            for it in raw:
                if isinstance(it, dict) and not it.get('__meta'):
                    items.append(it)
        elif isinstance(raw, dict):
            items = raw.get('items', [])
        return items

    def get_insuranceOption(self, obj):
        return self._get_meta(obj).get('insuranceOption', {'name': 'Standard Liability Included', 'dailyRate': 0, 'total': 0})

    def get_discount(self, obj):
        return float(self._get_meta(obj).get('discount', 0))

    def get_tax(self, obj):
        return float(obj.tax_amount)

    def get_totalAmount(self, obj):
        return float(obj.total_amount)

    def get_depositAmount(self, obj):
        return float(obj.deposit_amount)

    def get_depositStatus(self, obj):
        return self._get_meta(obj).get('depositStatus', 'held')

    def get_paymentStatus(self, obj):
        meta = self._get_meta(obj)
        if meta.get('paymentStatus'):
            return meta['paymentStatus']
        bal = float(obj.balance_due)
        tot = float(obj.total_amount)
        if bal <= 0:
            return 'paid'
        if bal < tot:
            return 'partial'
        return 'pending'

    def get_paymentMethod(self, obj):
        return self._get_meta(obj).get('paymentMethod', 'credit_card')

    def get_balanceDue(self, obj):
        return float(obj.balance_due)

    def get_paidAmount(self, obj):
        return max(0.0, float(obj.total_amount - obj.balance_due))

    def get_paymentHistory(self, obj):
        inv = obj.invoices.first()
        if inv:
            raw = inv.payments or []
            history = []
            if isinstance(raw, list):
                for p in raw:
                    if isinstance(p, dict) and not p.get('__items'):
                        history.append(p)
            elif isinstance(raw, dict):
                history = raw.get('history', [])
            return history
        return []

    def get_invoiceId(self, obj):
        inv = obj.invoices.first()
        return inv.id if inv else None

    def get_createdAt(self, obj):
        return obj.created_at.isoformat() if obj.created_at else None


class InvoiceSerializer(serializers.ModelSerializer):
    invoiceNumber = serializers.CharField(source='invoice_number')
    tenantId = serializers.CharField(source='tenant_id')
    rentalId = serializers.CharField(source='rental_id', allow_null=True)
    customerId = serializers.CharField(source='customer_id')
    customerName = serializers.CharField(source='customer_name')
    customerEmail = serializers.SerializerMethodField()
    issueDate = serializers.SerializerMethodField()
    dueDate = serializers.SerializerMethodField()
    items = serializers.SerializerMethodField()
    subtotal = serializers.SerializerMethodField()
    taxAmount = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    paidAmount = serializers.SerializerMethodField()
    balanceDue = serializers.SerializerMethodField()
    paymentHistory = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoiceNumber', 'tenantId', 'rentalId', 'customerId',
            'customerName', 'customerEmail', 'issueDate', 'dueDate', 'items',
            'subtotal', 'taxAmount', 'total', 'paidAmount', 'balanceDue',
            'status', 'paymentHistory'
        ]

    def _parse_payments(self, obj):
        raw = obj.payments or []
        items = []
        history = []
        customer_email = ''
        if isinstance(raw, list):
            for p in raw:
                if isinstance(p, dict) and p.get('__items'):
                    items = p['__items']
                    customer_email = p.get('customerEmail', '')
                elif isinstance(p, dict):
                    history.append(p)
        elif isinstance(raw, dict):
            items = raw.get('items', [])
            history = raw.get('history', [])
            customer_email = raw.get('customerEmail', '')
        return items, history, customer_email

    def get_customerEmail(self, obj):
        _, _, email = self._parse_payments(obj)
        return email or (obj.customer.email if obj.customer else '')

    def get_issueDate(self, obj):
        return obj.created_at.strftime('%Y-%m-%d') if obj.created_at else None

    def get_dueDate(self, obj):
        return obj.due_date.strftime('%Y-%m-%d') if obj.due_date else None

    def get_items(self, obj):
        items, _, _ = self._parse_payments(obj)
        return items

    def get_subtotal(self, obj):
        return float(obj.subtotal)

    def get_taxAmount(self, obj):
        return float(obj.tax_amount)

    def get_total(self, obj):
        return float(obj.total_amount)

    def get_paidAmount(self, obj):
        return float(obj.paid_amount)

    def get_balanceDue(self, obj):
        return float(obj.balance_due)

    def get_paymentHistory(self, obj):
        _, history, _ = self._parse_payments(obj)
        return history


class MaintenanceRecordSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    vehicleId = serializers.CharField(source='vehicle_id')
    vehicleName = serializers.CharField(source='vehicle_name')
    vehiclePlate = serializers.SerializerMethodField()
    serviceType = serializers.CharField(source='service_type')
    date = serializers.SerializerMethodField()
    completedDate = serializers.SerializerMethodField()
    odometerAtService = serializers.SerializerMethodField()
    cost = serializers.SerializerMethodField()
    serviceProvider = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceRecord
        fields = [
            'id', 'tenantId', 'vehicleId', 'vehicleName', 'vehiclePlate',
            'serviceType', 'date', 'completedDate', 'status', 'odometerAtService',
            'cost', 'serviceProvider', 'notes'
        ]

    def get_vehiclePlate(self, obj):
        return obj.vehicle.license_plate if obj.vehicle else ''

    def get_date(self, obj):
        if not obj.scheduled_date:
            return None
        if hasattr(obj.scheduled_date, 'strftime'):
            return obj.scheduled_date.strftime('%Y-%m-%d')
        return str(obj.scheduled_date)[:10]

    def get_completedDate(self, obj):
        if not obj.completed_date:
            return None
        if hasattr(obj.completed_date, 'strftime'):
            return obj.completed_date.strftime('%Y-%m-%d')
        return str(obj.completed_date)[:10]

    def get_odometerAtService(self, obj):
        return int(obj.odometer_at_service or 0)

    def get_cost(self, obj):
        return float(obj.cost)

    def get_serviceProvider(self, obj):
        return obj.vendor or 'Authorized Service'


class EnquirySerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    customerName = serializers.CharField(source='customer_name')
    customerEmail = serializers.CharField(source='customer_email')
    customerPhone = serializers.CharField(source='customer_phone')
    vehicleCategory = serializers.CharField(source='vehicle_category', allow_null=True)
    preferredVehicleId = serializers.CharField(source='preferred_vehicle_id', allow_null=True)
    preferredVehicleName = serializers.CharField(source='preferred_vehicle_name', allow_null=True)
    startDate = serializers.SerializerMethodField()
    endDate = serializers.SerializerMethodField()
    estimatedBudget = serializers.SerializerMethodField()
    convertedRentalId = serializers.CharField(source='converted_rental_id', allow_null=True)
    createdAt = serializers.SerializerMethodField()

    class Meta:
        model = Enquiry
        fields = [
            'id', 'tenantId', 'customerName', 'customerEmail', 'customerPhone',
            'vehicleCategory', 'preferredVehicleId', 'preferredVehicleName',
            'startDate', 'endDate', 'estimatedBudget', 'status', 'notes',
            'source', 'convertedRentalId', 'createdAt'
        ]

    def get_startDate(self, obj):
        if not obj.start_date:
            return None
        return obj.start_date.isoformat() if hasattr(obj.start_date, 'isoformat') else str(obj.start_date)

    def get_endDate(self, obj):
        if not obj.end_date:
            return None
        return obj.end_date.isoformat() if hasattr(obj.end_date, 'isoformat') else str(obj.end_date)

    def get_estimatedBudget(self, obj):
        return float(obj.estimated_budget) if obj.estimated_budget is not None else None

    def get_createdAt(self, obj):
        if not obj.created_at:
            return None
        return obj.created_at.isoformat() if hasattr(obj.created_at, 'isoformat') else str(obj.created_at)


class AuditLogSerializer(serializers.ModelSerializer):
    tenantId = serializers.CharField(source='tenant_id')
    userId = serializers.CharField(source='user_id', allow_null=True)
    userName = serializers.CharField(source='user_name')
    userRole = serializers.CharField(source='user_role', allow_null=True)
    entityType = serializers.CharField(source='entity_type')
    entityId = serializers.CharField(source='entity_id')
    ipAddress = serializers.CharField(source='ip_address', allow_null=True)
    timestamp = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id', 'tenantId', 'userId', 'userName', 'userRole', 'action',
            'entityType', 'entityId', 'details', 'ipAddress', 'timestamp'
        ]

    def get_timestamp(self, obj):
        return obj.created_at.isoformat() if obj.created_at else None
