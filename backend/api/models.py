import uuid
from django.db import models
from django.db.models import Func, Q, Value
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import RangeOperators


def generate_uuid():
    return str(uuid.uuid4())


class TsTzRange(Func):
    function = 'tstzrange'
    output_field = models.DateTimeField()


class Tenant(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    name = models.CharField(max_length=255)
    slug = models.CharField(unique=True, max_length=100)
    email = models.CharField(max_length=255)
    phone = models.CharField(max_length=50, blank=True, null=True)
    currency = models.CharField(max_length=10, blank=True, null=True, default='₹')
    timezone = models.CharField(max_length=50, blank=True, null=True, default='UTC')
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4, blank=True, null=True, default=0.0875)
    settings = models.JSONField(blank=True, null=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'tenants'

    def __str__(self):
        return f"{self.name} ({self.slug})"


class User(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='users', db_column='tenant_id')
    email = models.CharField(max_length=255)
    password_hash = models.CharField(max_length=255)
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=32)  # owner, manager, staff
    branch = models.CharField(max_length=255, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    token_version = models.IntegerField(default=1)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    email_verification_token_hash = models.CharField(max_length=128, null=True, blank=True)
    email_verification_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'users'
        unique_together = (('tenant', 'email'),)

    @property
    def is_email_verified(self):
        # Business owners require email_verified_at to be active
        if self.role == 'owner':
            return self.email_verified_at is not None
        # Internal staff/manager accounts managed by owners are active
        return True

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def __str__(self):
        return f"{self.name} <{self.email}> ({self.role})"


class EmailVerificationToken(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='verification_tokens', db_column='user_id')
    token_hash = models.CharField(max_length=128, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'email_verification_tokens'

    def __str__(self):
        return f"Token for {self.user.email} (used={self.used_at is not None})"


class EmailOTPChallenge(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='otp_challenges', db_column='user_id')
    purpose = models.CharField(max_length=32, default='signup', db_index=True)  # 'signup' or 'password_reset'
    otp_hash = models.CharField(max_length=128)
    otp_salt = models.CharField(max_length=64)
    expires_at = models.DateTimeField()
    failed_attempts = models.IntegerField(default=0)
    is_used = models.BooleanField(default=False)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'email_otp_challenges'

    def __str__(self):
        return f"OTP Challenge ({self.purpose}) for {self.user.email} (used={self.is_used}, failed={self.failed_attempts})"

    def verify(self, candidate_otp: str) -> bool:
        import hashlib, secrets
        if not candidate_otp or not str(candidate_otp).strip():
            return False
        expected_hash = hashlib.sha256(f"{self.otp_salt}:{str(candidate_otp).strip()}".encode('utf-8')).hexdigest()
        return secrets.compare_digest(self.otp_hash, expected_hash)


class PasswordResetToken(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='password_reset_tokens', db_column='user_id')
    token_hash = models.CharField(max_length=128, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'password_reset_tokens'

    def __str__(self):
        return f"Password Reset Token for {self.user.email} (used={self.is_used})"


class TeamInvitation(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_ACCEPTED = 'accepted'
    STATUS_CANCELLED = 'cancelled'
    STATUS_EXPIRED = 'expired'
    STATUS_CHOICES = (
        (STATUS_PENDING, 'Pending'),
        (STATUS_ACCEPTED, 'Accepted'),
        (STATUS_CANCELLED, 'Cancelled'),
        (STATUS_EXPIRED, 'Expired'),
    )

    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='invitations', db_column='tenant_id')
    email = models.CharField(max_length=255, db_index=True)
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=32)  # manager, staff
    branch = models.CharField(max_length=255, blank=True, null=True)
    token_hash = models.CharField(max_length=128, unique=True, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING, db_index=True)
    invited_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='sent_invitations', db_column='invited_by_id')
    accepted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='accepted_invitation', db_column='accepted_by_id')
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'team_invitations'
        indexes = [
            models.Index(fields=['tenant', 'status']),
            models.Index(fields=['tenant', 'email']),
        ]

    def __str__(self):
        return f"Invite <{self.email}> as {self.role} to {self.tenant.name} [{self.status}]"

    def is_currently_expired(self) -> bool:
        from django.utils import timezone
        return timezone.now() >= self.expires_at

    @staticmethod
    def generate_token_and_hash() -> tuple[str, str]:
        import secrets, hashlib
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
        return raw_token, token_hash

    @staticmethod
    def hash_token(raw_token: str) -> str:
        import hashlib
        return hashlib.sha256(raw_token.strip().encode('utf-8')).hexdigest()


class Vehicle(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='vehicles', db_column='tenant_id')
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=64)
    make = models.CharField(max_length=100)
    model = models.CharField(max_length=100)
    year = models.IntegerField()
    license_plate = models.CharField(max_length=32)
    vin = models.CharField(max_length=64, blank=True, null=True)
    daily_rate = models.DecimalField(max_digits=10, decimal_places=2)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=250.00)
    status = models.CharField(max_length=32, default='available')  # available, rented, maintenance, reserved
    odometer = models.IntegerField(default=0)
    fuel_level = models.IntegerField(default=100)
    features = models.JSONField(blank=True, null=True, default=list)
    images = models.JSONField(blank=True, null=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'vehicles'
        unique_together = (('tenant', 'license_plate'),)

    def __str__(self):
        return f"{self.year} {self.make} {self.model} ({self.license_plate})"


class Customer(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='customers', db_column='tenant_id')
    name = models.CharField(max_length=255)
    email = models.CharField(max_length=255)
    phone = models.CharField(max_length=50)
    address = models.TextField(blank=True, null=True)
    driver_license = models.JSONField(default=dict)
    total_rentals = models.IntegerField(default=0)
    total_spent = models.DecimalField(max_digits=12, decimal_places=2, default=0.00)
    rating = models.DecimalField(max_digits=3, decimal_places=2, blank=True, null=True, default=5.0)
    status = models.CharField(max_length=32, default='active')
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'customers'
        unique_together = (('tenant', 'email'),)

    def __str__(self):
        return f"{self.name} ({self.email})"


class Rental(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='rentals', db_column='tenant_id')
    rental_number = models.CharField(max_length=64)
    customer = models.ForeignKey(Customer, on_delete=models.DO_NOTHING, related_name='rentals', db_column='customer_id')
    vehicle = models.ForeignKey(Vehicle, on_delete=models.DO_NOTHING, related_name='rentals', db_column='vehicle_id')
    customer_name = models.CharField(max_length=255)
    vehicle_name = models.CharField(max_length=255)
    status = models.CharField(max_length=32, default='confirmed')  # draft, confirmed, active, completed, cancelled
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    daily_rate = models.DecimalField(max_digits=10, decimal_places=2)
    days = models.IntegerField()
    base_rental = models.DecimalField(max_digits=10, decimal_places=2)
    add_ons = models.JSONField(blank=True, null=True, default=list)
    total_add_ons = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=4, default=0.0875)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    deposit_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    balance_due = models.DecimalField(max_digits=10, decimal_places=2)
    notes = models.TextField(blank=True, null=True)
    check_out_inspection = models.JSONField(blank=True, null=True)
    check_in_inspection = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'rentals'
        unique_together = (('tenant', 'rental_number'),)
        indexes = [
            models.Index(fields=['customer'], name='idx_rentals_customer_id'),
        ]
        constraints = [
            ExclusionConstraint(
                name='no_overlapping_rentals',
                expressions=[
                    ('vehicle', RangeOperators.EQUAL),
                    (TsTzRange('start_date', 'end_date', Value('[)')), RangeOperators.OVERLAPS),
                ],
                condition=Q(status__in=['confirmed', 'active']),
            ),
        ]

    def __str__(self):
        return f"{self.rental_number} - {self.customer_name} ({self.status})"


class Invoice(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='invoices', db_column='tenant_id')
    invoice_number = models.CharField(max_length=64)
    rental = models.ForeignKey(Rental, on_delete=models.DO_NOTHING, blank=True, null=True, related_name='invoices', db_column='rental_id')
    customer = models.ForeignKey(Customer, on_delete=models.DO_NOTHING, related_name='invoices', db_column='customer_id')
    customer_name = models.CharField(max_length=255)
    status = models.CharField(max_length=32, default='issued')  # draft, issued, paid, partially_paid, cancelled
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    tax_amount = models.DecimalField(max_digits=10, decimal_places=2)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    balance_due = models.DecimalField(max_digits=10, decimal_places=2)
    payments = models.JSONField(blank=True, null=True, default=list)
    due_date = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'invoices'
        unique_together = (('tenant', 'invoice_number'),)
        indexes = [
            models.Index(fields=['rental'], name='idx_invoices_rental_id'),
        ]

    def __str__(self):
        return f"{self.invoice_number} - {self.customer_name} (${self.total_amount})"


class MaintenanceRecord(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='maintenance_records', db_column='tenant_id')
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name='maintenance_records', db_column='vehicle_id')
    vehicle_name = models.CharField(max_length=255)
    service_type = models.CharField(max_length=100)
    description = models.TextField()
    cost = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=32, default='scheduled')  # scheduled, in_progress, completed
    scheduled_date = models.DateTimeField()
    completed_date = models.DateTimeField(blank=True, null=True)
    odometer_at_service = models.IntegerField(blank=True, null=True)
    vendor = models.CharField(max_length=255, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'maintenance_records'

    def __str__(self):
        return f"{self.vehicle_name} - {self.service_type} (${self.cost})"


class Enquiry(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='enquiries', db_column='tenant_id')
    customer_name = models.CharField(max_length=255)
    customer_email = models.CharField(max_length=255)
    customer_phone = models.CharField(max_length=50, blank=True, null=True)
    vehicle_category = models.CharField(max_length=64, blank=True, null=True)
    preferred_vehicle = models.ForeignKey(Vehicle, on_delete=models.DO_NOTHING, blank=True, null=True, related_name='enquiries', db_column='preferred_vehicle_id')
    preferred_vehicle_name = models.CharField(max_length=255, blank=True, null=True)
    start_date = models.DateTimeField(blank=True, null=True)
    end_date = models.DateTimeField(blank=True, null=True)
    estimated_budget = models.DecimalField(max_digits=10, decimal_places=2, blank=True, null=True)
    status = models.CharField(max_length=32, default='new')  # new, contacted, quoted, converted, lost
    notes = models.TextField(blank=True, null=True)
    source = models.CharField(max_length=64, blank=True, null=True, default='website')
    converted_rental = models.ForeignKey(Rental, on_delete=models.DO_NOTHING, blank=True, null=True, related_name='enquiries', db_column='converted_rental_id')
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, blank=True, null=True)

    class Meta:
        db_table = 'enquiries'

    def __str__(self):
        return f"Enquiry: {self.customer_name} ({self.status})"


class AuditLog(models.Model):
    id = models.CharField(primary_key=True, max_length=64, default=generate_uuid)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name='audit_logs', db_column='tenant_id')
    user_id = models.CharField(max_length=64, blank=True, null=True)
    user_name = models.CharField(max_length=255, default='System / Guest')
    user_role = models.CharField(max_length=32, blank=True, null=True)
    action = models.CharField(max_length=64)
    entity_type = models.CharField(max_length=64)
    entity_id = models.CharField(max_length=64)
    details = models.TextField(blank=True, null=True)
    ip_address = models.CharField(max_length=45, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, blank=True, null=True)

    class Meta:
        db_table = 'audit_logs'

    def __str__(self):
        return f"[{self.action}] {self.entity_type} {self.entity_id} by {self.user_name}"
