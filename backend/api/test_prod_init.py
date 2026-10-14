import io
import os
from decimal import Decimal
from django.test import TestCase, override_settings
from django.utils import timezone
from django.core.management import call_command, CommandError
from api.models import Tenant, User, Vehicle, Customer, Rental, Invoice, AuditLog
from api.services import AuthService
from api.prod_seed_service import (
    initialize_production_environment,
    APPROVED_DEMO_VEHICLES,
    RESERVED_DEMO_EMAILS
)


class ProductionInitializationTestSuite(TestCase):
    def setUp(self):
        # Start each test with an empty database to test initialization cleanly
        User.objects.all().delete()
        Vehicle.objects.all().delete()
        Tenant.objects.all().delete()
        Customer.objects.all().delete()
        Rental.objects.all().delete()
        Invoice.objects.all().delete()
        AuditLog.objects.all().delete()

    def test_clean_production_initialization(self):
        """
        Tests that on a fresh database:
        1. Tenant 'tenant-1' is created.
        2. Production Owner is created and verified.
        3. All 8 approved demo vehicles are seeded with status='available'.
        4. Zero customers, rentals, invoices, or audit logs are created.
        """
        summary = initialize_production_environment(
            owner_email="chief.executive@myrentalco.com",
            owner_password="SuperSecretPassword2026!",
            owner_name="Chief Executive"
        )

        self.assertEqual(summary['tenant_action'], 'created_new')
        self.assertEqual(summary['owner_action'], 'created_and_verified')
        self.assertEqual(summary['vehicles_created'], len(APPROVED_DEMO_VEHICLES))
        self.assertEqual(summary['vehicles_retained'], 0)

        # Verify tenant
        tenant = Tenant.objects.get(id='tenant-1')
        self.assertEqual(tenant.slug, 'apex-rentals')
        self.assertEqual(tenant.currency, '₹')

        # Verify Owner
        owner = User.objects.get(email='chief.executive@myrentalco.com')
        self.assertEqual(owner.role, 'owner')
        self.assertEqual(owner.tenant, tenant)
        self.assertTrue(owner.is_active)
        self.assertIsNotNone(owner.email_verified_at)
        self.assertTrue(owner.is_email_verified)

        # Verify owner can authenticate and obtain JWT
        user, token, err = AuthService.authenticate("chief.executive@myrentalco.com", "SuperSecretPassword2026!")
        self.assertIsNone(err)
        self.assertIsNotNone(user)
        self.assertIsNotNone(token)
        self.assertEqual(user.email, "chief.executive@myrentalco.com")

        # Verify vehicles
        self.assertEqual(Vehicle.objects.count(), 8)
        for veh in Vehicle.objects.all():
            self.assertEqual(veh.tenant, tenant)
            self.assertEqual(veh.status, 'available')
            self.assertIn('imageUrl', veh.images)
            self.assertTrue(veh.images['imageUrl'].startswith('https://images.unsplash.com/'))

        # Verify no extraneous demo records
        self.assertEqual(Customer.objects.count(), 0)
        self.assertEqual(Rental.objects.count(), 0)
        self.assertEqual(Invoice.objects.count(), 0)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_public_storefront_visibility(self):
        """
        Tests that public storefront endpoint /api/public/vehicles?slug=apex-rentals
        returns all 8 demo vehicles with full catalog pricing and images.
        """
        initialize_production_environment(
            owner_email="ops@myrentalco.com",
            owner_password="StrongPassword2026!",
            owner_name="Fleet Ops"
        )

        res = self.client.get('/api/public/vehicles?slug=apex-rentals')
        self.assertEqual(res.status_code, 200)
        fleet = res.json()
        self.assertEqual(len(fleet), 8)

        v_names = {v['name'] for v in fleet}
        self.assertIn('2024 Tesla Model 3 Long Range', v_names)
        self.assertIn('2023 Ford Mustang GT Convertible', v_names)
        self.assertIn('2024 BMW 330i M Sport', v_names)
        self.assertIn('2023 Porsche 911 Carrera', v_names)
        self.assertIn('2024 Trek Allant+ 8S E-Bike', v_names)
        self.assertIn('2023 Ducati Scrambler Icon', v_names)
        self.assertIn('2024 Vespa Primavera 150', v_names)
        self.assertIn('2024 Chevrolet Corvette Stingray', v_names)

        for v in fleet:
            self.assertEqual(v['status'], 'available')
            self.assertTrue(v['imageUrl'].startswith('https://images.unsplash.com/'))
            self.assertGreater(v['dailyRate'], 0)
            self.assertGreater(v['deposit'], 0)

    def test_existing_owner_is_not_overwritten(self):
        """
        Requirement 3:
        Do not overwrite an existing Owner account or change its password automatically.
        If the email already exists, stop safely and explain.
        """
        # First initialization
        initialize_production_environment(
            owner_email="owner@securecompany.com",
            owner_password="InitialPassword2026!",
            owner_name="Original Owner"
        )

        # Attempting second initialization with the same email but a new password
        with self.assertRaises(ValueError) as ctx:
            initialize_production_environment(
                owner_email="owner@securecompany.com",
                owner_password="AttemptedHijackPassword2026!",
                owner_name="Intruder"
            )

        self.assertIn("already exists", str(ctx.exception))
        self.assertIn("will not be overwritten", str(ctx.exception))

        # Verify original password is still intact and can authenticate
        user, token, err = AuthService.authenticate("owner@securecompany.com", "InitialPassword2026!")
        self.assertIsNone(err)
        self.assertIsNotNone(user)

        # Verify attempted new password fails
        _, _, bad_err = AuthService.authenticate("owner@securecompany.com", "AttemptedHijackPassword2026!")
        self.assertEqual(bad_err, "INVALID_CREDENTIALS")

    def test_existing_tenant_settings_preserved(self):
        """
        Requirement 4:
        Do not overwrite existing tenant settings or business data.
        If tenant-1 already exists, validate it before making changes.
        """
        # Pre-create tenant with custom branding and settings
        custom_settings = {
            'tagline': 'Bespoke Exotic Car Concierge',
            'custom_policy': 'No track racing',
            'locations': ['Private Hangar A']
        }
        Tenant.objects.create(
            id='tenant-1',
            name='Bespoke Motors Ltd',
            slug='apex-rentals',
            email='concierge@bespokemotors.com',
            currency='₹',
            settings=custom_settings
        )

        summary = initialize_production_environment(
            owner_email="founder@bespokemotors.com",
            owner_password="CustomPassword2026!"
        )

        self.assertEqual(summary['tenant_action'], 'validated_existing')

        # Reload tenant and verify settings were preserved
        t = Tenant.objects.get(id='tenant-1')
        self.assertEqual(t.name, 'Bespoke Motors Ltd')
        self.assertEqual(t.settings['tagline'], 'Bespoke Exotic Car Concierge')
        self.assertEqual(t.settings['custom_policy'], 'No track racing')

    def test_duplicate_vehicles_prevented_and_existing_fleet_preserved(self):
        """
        Requirement 8:
        Initialization is safe to run more than once without creating duplicate vehicles.
        Existing vehicle adjustments (e.g. odometer update) are not wiped out.
        """
        # Run first time
        initialize_production_environment(
            owner_email="admin1@fleetcompany.com",
            owner_password="FirstAdminPassword2026!"
        )
        self.assertEqual(Vehicle.objects.count(), 8)

        # Simulate vehicle usage update
        v1 = Vehicle.objects.get(id='veh-1')
        v1.odometer = 45000
        v1.save()

        # Run again with a second owner
        summary = initialize_production_environment(
            owner_email="admin2@fleetcompany.com",
            owner_password="SecondAdminPassword2026!"
        )

        self.assertEqual(summary['vehicles_created'], 0)
        self.assertEqual(summary['vehicles_retained'], 8)
        self.assertEqual(Vehicle.objects.count(), 8)

        # Verify modified odometer was preserved
        v1_reloaded = Vehicle.objects.get(id='veh-1')
        self.assertEqual(v1_reloaded.odometer, 45000)

    def test_password_security_and_no_leakage(self):
        """
        Requirements 1, 2, 7:
        - Rejection of Password123!
        - Rejection of passwords < 8 chars
        - Rejection of reserved demo emails
        - Ensure password secret is never echoed in error message
        """
        secret_pw = "Password123!"
        with self.assertRaises(ValueError) as ctx:
            initialize_production_environment("valid@company.com", secret_pw)
        self.assertIn("strictly forbidden in production", str(ctx.exception))

        short_pw = "short"
        with self.assertRaises(ValueError) as ctx:
            initialize_production_environment("valid@company.com", short_pw)
        self.assertIn("at least 8 characters", str(ctx.exception))
        self.assertNotIn(short_pw, str(ctx.exception))

        for demo_email in RESERVED_DEMO_EMAILS:
            with self.assertRaises(ValueError) as ctx:
                initialize_production_environment(demo_email, "ValidPassword2026!")
            self.assertIn("reserved development demo email", str(ctx.exception))

    def test_management_command_execution_via_env_vars(self):
        """
        Requirement 2 & 1:
        Reads password from PROD_OWNER_PASSWORD environment variable.
        Never prints password in stdout/stderr.
        """
        out = io.StringIO()
        err = io.StringIO()

        test_password = "SecretEnvPassword2026!"
        os.environ['PROD_OWNER_EMAIL'] = "env.owner@domain.com"
        os.environ['PROD_OWNER_PASSWORD'] = test_password
        os.environ['PROD_OWNER_NAME'] = "Env Owner"

        try:
            call_command('init_production', stdout=out, stderr=err)
            output = out.getvalue()
            error_output = err.getvalue()

            self.assertIn("RentFlow Production Initialization Completed Successfully", output)
            self.assertIn("env.owner@domain.com", output)
            self.assertIn("8 demo vehicles", output)

            # CRITICAL SECURITY CHECK: password is NEVER in stdout or stderr
            self.assertNotIn(test_password, output)
            self.assertNotIn(test_password, error_output)

            # Confirm user was created and can log in
            user = User.objects.get(email="env.owner@domain.com")
            self.assertEqual(user.name, "Env Owner")
            u, t, login_err = AuthService.authenticate("env.owner@domain.com", test_password)
            self.assertIsNone(login_err)
            self.assertIsNotNone(t)
        finally:
            os.environ.pop('PROD_OWNER_EMAIL', None)
            os.environ.pop('PROD_OWNER_PASSWORD', None)
            os.environ.pop('PROD_OWNER_NAME', None)

    @override_settings(DEBUG=False, ENABLE_DEMO_MODE=False, TESTING=False)
    def test_production_lockout_of_demo_users_preserved(self):
        """
        Requirement 7:
        Production demo lockout is strictly maintained.
        Predefined demo accounts cannot log in under DEBUG=False,
        but the newly created production owner CAN log in.
        """
        from unittest.mock import patch
        initialize_production_environment(
            owner_email="real.owner@enterprisecorp.com",
            owner_password="RealOwnerPassword2026!",
            owner_name="Real Owner"
        )

        # Also create a demo user with DEFAULT_PASSWORD_HASH for testing
        from api.seed_service import DEFAULT_PASSWORD_HASH
        tenant = Tenant.objects.get(id='tenant-1')
        User.objects.create(
            tenant=tenant,
            email="alex.rivera@apexrentals.com",
            password_hash=DEFAULT_PASSWORD_HASH,
            name="Alex Rivera",
            role="owner",
            is_active=True,
            email_verified_at=timezone.now()
        )

        # Simulate non-testing production runtime (no 'test' in sys.argv)
        with patch('sys.argv', ['gunicorn', 'rentflow_backend.wsgi:application']):
            # Demo account login attempt fails in production
            alex_user, alex_token, alex_err = AuthService.authenticate(
                "alex.rivera@apexrentals.com",
                "Password123!"
            )
            self.assertEqual(alex_err, "INVALID_CREDENTIALS")
            self.assertIsNone(alex_token)

            # Real owner login succeeds in production
            prod_user, prod_token, prod_err = AuthService.authenticate(
                "real.owner@enterprisecorp.com",
                "RealOwnerPassword2026!"
            )
            self.assertIsNone(prod_err)
            self.assertIsNotNone(prod_token)
            self.assertEqual(prod_user.email, "real.owner@enterprisecorp.com")
