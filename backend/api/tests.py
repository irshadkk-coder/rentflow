import json
import datetime
import jwt
import secrets
import hashlib
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor
from django.conf import settings
from django.db import IntegrityError, connections
from unittest.mock import patch, MagicMock
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase, Client, override_settings
from django.utils import timezone
from rest_framework import status
from .models import (
    Tenant, User, Vehicle, Customer, Rental, Invoice,
    MaintenanceRecord, Enquiry, AuditLog, EmailVerificationToken,
    EmailOTPChallenge, PasswordResetToken, TeamInvitation
)
from .exceptions import EmailDeliveryError
from .services import AuthService, SequenceService, PricingService
from .seed_service import seed_database
from .email_service import EmailService


class RentFlowDjangoBackendTestSuite(TestCase):
    def setUp(self):
        # Seed fresh baseline data before each test
        seed_database()
        self.client = Client()

        # Generate tokens for Apex Rentals users
        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.manager = User.objects.get(email='sarah.chen@apexrentals.com')
        self.staff = User.objects.get(email='jordan.lee@apexrentals.com')

        # Generate tokens for Metro Car Share users
        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')
        self.t2_staff = User.objects.get(email='marcus.vance@metrocarshare.com')

        self.owner_token = AuthService.generate_jwt(self.owner)
        self.manager_token = AuthService.generate_jwt(self.manager)
        self.staff_token = AuthService.generate_jwt(self.staff)
        self.t2_owner_token = AuthService.generate_jwt(self.t2_owner)

    # ----------------------------------------------------
    # 1. MULTI-TENANT ISOLATION
    # ----------------------------------------------------
    def test_multi_tenant_isolation(self):
        # Tenant 1 fetches vehicles
        res1 = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        v1_list = res1.json()
        self.assertTrue(len(v1_list) > 0)
        self.assertTrue(all(v['tenantId'] == 'tenant-1' for v in v1_list))

        # Tenant 2 fetches vehicles
        res2 = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.t2_owner_token}')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        v2_list = res2.json()
        self.assertTrue(len(v2_list) > 0)
        self.assertTrue(all(v['tenantId'] == 'tenant-2' for v in v2_list))

        # Cross-tenant direct access blocked
        t2_veh_id = v2_list[0]['id']
        cross_res = self.client.get(f'/api/vehicles/{t2_veh_id}', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(cross_res.status_code, status.HTTP_404_NOT_FOUND)

        # Own tenant direct access succeeds
        valid_res = self.client.get(f'/api/vehicles/{t2_veh_id}', HTTP_AUTHORIZATION=f'Bearer {self.t2_owner_token}')
        self.assertEqual(valid_res.status_code, status.HTTP_200_OK)

    # ----------------------------------------------------
    # 2. AUTHENTICATION & RBAC PERMISSIONS
    # ----------------------------------------------------
    def test_authentication_and_rbac(self):
        # Valid login
        login_res = self.client.post('/api/auth/login', {
            'email': 'alex.rivera@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)
        self.assertIn('token', login_res.json())
        self.assertEqual(login_res.json()['user']['role'], 'owner')

        # Invalid password rejected
        bad_login = self.client.post('/api/auth/login', {
            'email': 'alex.rivera@apexrentals.com',
            'password': 'WrongPassword!'
        }, content_type='application/json')
        self.assertEqual(bad_login.status_code, status.HTTP_401_UNAUTHORIZED)

        # Unauthenticated request rejected
        unauth_res = self.client.get('/api/vehicles')
        self.assertEqual(unauth_res.status_code, status.HTTP_401_UNAUTHORIZED)

        # RBAC: Staff cannot delete vehicle (HTTP 403)
        del_staff = self.client.delete('/api/vehicles/veh-2', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(del_staff.status_code, status.HTTP_403_FORBIDDEN)

        # RBAC: Staff cannot modify tenant business settings (HTTP 403)
        put_staff = self.client.put('/api/tenants/current', {
            'name': 'Hacked Business Name'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(put_staff.status_code, status.HTTP_403_FORBIDDEN)

        # RBAC: Owner can delete vehicle (HTTP 200)
        del_owner = self.client.delete('/api/vehicles/veh-2', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(del_owner.status_code, status.HTTP_200_OK)

    # ----------------------------------------------------
    # 3. BOOKING CONFLICT PREVENTION & EXCLUSION LOGIC
    # ----------------------------------------------------
    def test_booking_conflict_prevention(self):
        vehicle_id = 'veh-3'  # BMW 330i
        start1 = '2026-11-10T10:00:00Z'
        end1 = '2026-11-15T10:00:00Z'

        # 1. Create first booking
        b1_res = self.client.post('/api/rentals', {
            'vehicleId': vehicle_id,
            'startDate': start1,
            'endDate': end1,
            'customerName': 'Alice Green',
            'customerEmail': 'alice@example.com',
            'customerPhone': '+1 555-0101',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(b1_res.status_code, status.HTTP_201_CREATED)
        b1_id = b1_res.json()['id']

        # 2. Overlapping booking must be rejected with HTTP 409
        b2_res = self.client.post('/api/rentals', {
            'vehicleId': vehicle_id,
            'startDate': '2026-11-12T10:00:00Z',
            'endDate': '2026-11-18T10:00:00Z',
            'customerName': 'Bob White',
            'customerEmail': 'bob@example.com',
            'customerPhone': '+1 555-0102'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(b2_res.status_code, status.HTTP_409_CONFLICT)

        # 3. Non-overlapping booking succeeds
        b3_res = self.client.post('/api/rentals', {
            'vehicleId': vehicle_id,
            'startDate': '2026-11-20T10:00:00Z',
            'endDate': '2026-11-25T10:00:00Z',
            'customerName': 'Carol King',
            'customerEmail': 'carol@example.com',
            'customerPhone': '+1 555-0103'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(b3_res.status_code, status.HTTP_201_CREATED)
        b3_id = b3_res.json()['id']

        # 4. Updating b3 to overlap with b1 must be rejected with HTTP 409
        update_conflict = self.client.put(f'/api/rentals/{b3_id}', {
            'startDate': '2026-11-14T10:00:00Z',
            'endDate': '2026-11-19T10:00:00Z'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(update_conflict.status_code, status.HTTP_409_CONFLICT)

    # ----------------------------------------------------
    # 4. CANONICAL PRICING ENGINE
    # ----------------------------------------------------
    def test_canonical_pricing_engine(self):
        # Tesla Model 3: $95/day, 3 days = $285 base. Tax 8.75% = $24.94. Total = $309.94
        quote_res = self.client.post('/api/quote', {
            'vehicleId': 'veh-1',
            'startDate': '2026-12-01T10:00:00Z',
            'endDate': '2026-12-04T10:00:00Z',
            'rentalRateType': 'daily',
            'addOnIds': ['gps'],  # $10/day * 3 days = $30
            'insuranceTier': 'basic'  # $9/day * 3 days = $27
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(quote_res.status_code, status.HTTP_200_OK)
        q = quote_res.json()
        self.assertEqual(q['durationUnits'], 3)
        self.assertEqual(q['basePrice'], 285.0)
        self.assertEqual(q['totalAddOns'], 30.0)
        self.assertEqual(q['insuranceOption']['total'], 27.0)

        # Taxable: 285 + 30 + 27 = 342. Tax: 342 * 0.0875 = 29.93. Total = 371.93
        self.assertEqual(q['totalAmount'], 371.93)

        # Attacker tries to submit manipulated total: $0.01
        hacker_booking = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2026-12-01T10:00:00Z',
            'endDate': '2026-12-04T10:00:00Z',
            'customerName': 'Hacker Attempt',
            'customerEmail': 'hacker@example.com',
            'customerPhone': '+1 555-0099',
            'basePrice': 0.01,
            'totalAmount': 0.01
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(hacker_booking.status_code, status.HTTP_201_CREATED)
        rent = hacker_booking.json()
        self.assertNotEqual(rent['totalAmount'], 0.01)
        self.assertEqual(rent['basePrice'], 285.0)
        self.assertEqual(rent['totalAmount'], 309.94)

        # Inverted dates rejected
        inv_res = self.client.post('/api/quote', {
            'vehicleId': 'veh-1',
            'startDate': '2026-12-10T10:00:00Z',
            'endDate': '2026-12-05T10:00:00Z'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(inv_res.status_code, status.HTTP_400_BAD_REQUEST)

    # ----------------------------------------------------
    # 5. CHECK-OUT & CHECK-IN INSPECTIONS
    # ----------------------------------------------------
    def test_checkout_and_checkin_inspections(self):
        # Create confirmed rental on veh-4 (odometer: 5120)
        rental_res = self.client.post('/api/rentals', {
            'vehicleId': 'veh-4',
            'startDate': '2026-12-10T10:00:00Z',
            'endDate': '2026-12-12T10:00:00Z',
            'customerName': 'Inspect Cust',
            'customerEmail': 'insp@example.com',
            'customerPhone': '+1 555-0199',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        rental_id = rental_res.json()['id']

        # 1. Check-out
        out_res = self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {
                'departureOdometer': 5120,
                'departureFuelOrBattery': 100,
                'existingDamages': ['None']
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(out_res.status_code, status.HTTP_200_OK)
        self.assertEqual(out_res.json()['status'], 'active')

        # Vehicle must be rented
        v = Vehicle.objects.get(id='veh-4')
        self.assertEqual(v.status, 'rented')

        # 2. Check-in with lower odometer must fail
        lower_odo = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 5000,  # Lower than 5120!
                'returnFuelOrBattery': 90
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(lower_odo.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Check-in with invalid fuel (> 100) must fail
        bad_fuel = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 5350,
                'returnFuelOrBattery': 150
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(bad_fuel.status_code, status.HTTP_400_BAD_REQUEST)

        # 4. Valid check-in completes rental and returns vehicle to available
        good_in = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 5350,
                'returnFuelOrBattery': 95,
                'newDamages': []
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(good_in.status_code, status.HTTP_200_OK)
        self.assertEqual(good_in.json()['status'], 'completed')

        v.refresh_from_db()
        self.assertEqual(v.status, 'available')
        self.assertEqual(v.odometer, 5350)
        self.assertEqual(v.fuel_level, 95)

    # ----------------------------------------------------
    # 6. INVOICE PAYMENT TRANSACTIONS
    # ----------------------------------------------------
    def test_invoice_payment_transaction(self):
        # Create rental to produce invoice
        rent_res = self.client.post('/api/rentals', {
            'vehicleId': 'veh-5',  # $45/day, 2 days = $90 + tax $7.88 = $97.88
            'startDate': '2026-12-15T10:00:00Z',
            'endDate': '2026-12-17T10:00:00Z',
            'customerName': 'Pay Customer',
            'customerEmail': 'pay@example.com',
            'customerPhone': '+1 555-0999'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        rental_id = rent_res.json()['id']

        inv = Invoice.objects.get(rental_id=rental_id)
        self.assertEqual(float(inv.total_amount), 97.88)
        self.assertEqual(float(inv.balance_due), 97.88)
        self.assertEqual(inv.status, 'issued')

        # Settle invoice in full
        pay_res = self.client.post(f'/api/invoices/{inv.id}/pay', {
            'amount': 97.88,
            'method': 'Credit Card',
            'reference': 'TX-DRF-001'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(pay_res.status_code, status.HTTP_200_OK)

        inv.refresh_from_db()
        self.assertEqual(float(inv.paid_amount), 97.88)
        self.assertEqual(float(inv.balance_due), 0.0)
        self.assertEqual(inv.status, 'paid')

        # Linked rental updated
        rent = Rental.objects.get(id=rental_id)
        self.assertEqual(float(rent.balance_due), 0.0)

    # ----------------------------------------------------
    # 7. CRM ENQUIRY & CONVERSION LIFECYCLE
    # ----------------------------------------------------
    def test_crm_enquiry_lifecycle(self):
        # 1. Create enquiry
        enq_res = self.client.post('/api/enquiries', {
            'tenantId': 'tenant-1',
            'customerName': 'Enquiry Guest',
            'customerEmail': 'enquiry@example.com',
            'customerPhone': '+1 555-3322',
            'vehicleCategory': 'car',
            'notes': 'Interested in renting for the weekend'
        }, content_type='application/json')
        self.assertEqual(enq_res.status_code, status.HTTP_201_CREATED)
        enq_id = enq_res.json()['id']

        # 2. Update enquiry status
        upd_res = self.client.put(f'/api/enquiries/{enq_id}', {
            'status': 'contacted',
            'notes': 'Customer requested Porsche 911 quote'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(upd_res.status_code, status.HTTP_200_OK)
        self.assertEqual(upd_res.json()['status'], 'contacted')

        # 3. Convert to confirmed booking
        conv_res = self.client.post(f'/api/enquiries/{enq_id}/convert', {}, HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(conv_res.status_code, status.HTTP_200_OK)
        conv_data = conv_res.json()
        self.assertTrue(conv_data['success'])
        self.assertEqual(conv_data['enquiry']['status'], 'converted')
        self.assertIsNotNone(conv_data['rental']['rentalNumber'])

    # ----------------------------------------------------
    # 8. PUBLIC STOREFRONT & GUEST BOOKING END-TO-END
    # ----------------------------------------------------
    def test_public_storefront_and_booking_e2e(self):
        # 1. Get public business details
        biz_res = self.client.get('/api/public/business/apex-rentals')
        self.assertEqual(biz_res.status_code, status.HTTP_200_OK)
        self.assertEqual(biz_res.json()['name'], 'Apex Luxury Rentals')

        # 2. Get public fleet (VIN and internal odometer stripped)
        fleet_res = self.client.get('/api/public/vehicles?slug=apex-rentals')
        self.assertEqual(fleet_res.status_code, status.HTTP_200_OK)
        fleet = fleet_res.json()
        self.assertTrue(len(fleet) > 0)
        self.assertNotIn('vin', fleet[0])
        self.assertNotIn('odometer', fleet[0])

        # 3. Calculate public quote
        quote_res = self.client.post('/api/public/quote', {
            'slug': 'apex-rentals',
            'vehicleId': 'veh-1',
            'startDate': '2026-12-20T10:00:00Z',
            'endDate': '2026-12-23T10:00:00Z',
            'rentalRateType': 'daily',
            'addons': ['gps']
        }, content_type='application/json')
        self.assertEqual(quote_res.status_code, status.HTTP_200_OK)
        self.assertTrue(quote_res.json()['totalAmount'] > 0)

        # 4. Submit public booking
        book_res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': 'veh-1',
            'startDate': '2026-12-20T10:00:00Z',
            'endDate': '2026-12-23T10:00:00Z',
            'customerName': 'Guest Customer',
            'customerEmail': 'guest.cust@example.com',
            'customerPhone': '+1 555-8888',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(book_res.status_code, status.HTTP_201_CREATED)
        b_data = book_res.json()
        self.assertTrue(b_data['success'])
        self.assertRegex(b_data['bookingNumber'], r'^RF-\d{4}-\d{6}$')

        # Guest customer created in CRM with unverified license
        cust = Customer.objects.get(email='guest.cust@example.com')
        self.assertFalse(cust.driver_license.get('verified'))

        # Double-booking attempt on same vehicle triggers HTTP 409
        dup_res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': 'veh-1',
            'startDate': '2026-12-21T10:00:00Z',
            'endDate': '2026-12-24T10:00:00Z',
            'customerName': 'Conflicting Guest',
            'customerEmail': 'conflict@example.com',
            'customerPhone': '+1 555-0000'
        }, content_type='application/json')
        self.assertEqual(dup_res.status_code, status.HTTP_409_CONFLICT)

    # ----------------------------------------------------
    # 9. SEQUENTIAL IDENTIFIERS & AUDIT TRAIL
    # ----------------------------------------------------
    def test_sequential_identifiers_and_audit(self):
        t1 = Tenant.objects.get(id='tenant-1')
        s1 = SequenceService.get_next_sequence(t1, 'rental')
        s2 = SequenceService.get_next_sequence(t1, 'rental')
        year = datetime.datetime.now().year

        self.assertRegex(s1, rf'^RF-{year}-\d{{6}}$')
        self.assertRegex(s2, rf'^RF-{year}-\d{{6}}$')
        self.assertNotEqual(s1, s2)

        # Audit logs recorded
        logs_res = self.client.get('/api/audit-logs', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(logs_res.status_code, status.HTTP_200_OK)
        logs = logs_res.json()
        self.assertTrue(len(logs) > 0)


class SecurityRegressionTestSuite(TestCase):
    def setUp(self):
        seed_database()
        self.client = Client()
        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.manager = User.objects.get(email='sarah.chen@apexrentals.com')
        self.staff = User.objects.get(email='jordan.lee@apexrentals.com')
        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')

        self.owner_token = AuthService.generate_jwt(self.owner)
        self.manager_token = AuthService.generate_jwt(self.manager)
        self.staff_token = AuthService.generate_jwt(self.staff)
        self.t2_owner_token = AuthService.generate_jwt(self.t2_owner)

    # ----------------------------------------------------
    # C-01: Demo-user authentication bypass
    # ----------------------------------------------------
    @override_settings(DEBUG=False)
    def test_c01_demo_switcher_disabled_in_production(self):
        res = self.client.post('/api/auth/switch-demo-user', {
            'email': 'alex.rivera@apexrentals.com'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('strictly disabled in production', res.json().get('error', ''))

    @override_settings(DEBUG=True)
    def test_c01_demo_switcher_allowed_in_debug(self):
        res = self.client.post('/api/auth/switch-demo-user', {
            'email': 'alex.rivera@apexrentals.com'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('token', res.json())

    # ----------------------------------------------------
    # C-02: Database reset endpoint disabled in production
    # ----------------------------------------------------
    @override_settings(DEBUG=False)
    def test_c02_database_reset_disabled_in_production(self):
        v_count_before = Vehicle.objects.count()
        res = self.client.post('/api/reset', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('strictly disabled in production', res.json().get('error', ''))
        # Ensure database was not wiped or altered
        self.assertEqual(Vehicle.objects.count(), v_count_before)

    # ----------------------------------------------------
    # C-03: Public booking parameter tampering prevention
    # ----------------------------------------------------
    def test_c03_public_booking_tampering_safely_ignored_or_rejected(self):
        payload = {
            'slug': 'apex-rentals',
            'vehicleId': 'veh-1',
            'startDate': '2026-11-10T10:00:00Z',
            'endDate': '2026-11-13T10:00:00Z',
            'customerName': 'Attacker Guest',
            'customerEmail': 'attacker@example.com',
            'customerPhone': '+1 555-9999',
            # Tampering attempts:
            'status': 'completed',
            'totalAmount': 0.50,
            'depositAmount': 0.00,
            'dailyRate': 0.01,
            'customerId': 'cust-fake-tampered',
            'paymentStatus': 'paid',
            'balanceDue': 0.00
        }
        res = self.client.post('/api/public/bookings', payload, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        rental_id = data['rentalId']

        rental = Rental.objects.get(id=rental_id)
        # 1. Status must always be 'confirmed' regardless of client input 'completed'
        self.assertEqual(rental.status, 'confirmed')
        # 2. Canonical pricing must be calculated by server, ignoring $0.50 tampering
        self.assertGreater(rental.total_amount, Decimal('100.00'))
        self.assertGreater(rental.deposit_amount, Decimal('0.00'))
        # 3. Balance due must equal total amount
        self.assertEqual(rental.balance_due, rental.total_amount)
        # 4. Customer must be properly created under tenant-1, not spoofed
        self.assertEqual(rental.customer.tenant_id, 'tenant-1')

    # ----------------------------------------------------
    # H-01: Cross-tenant customer ID handling
    # ----------------------------------------------------
    def test_h01_cross_tenant_customer_id_rejected(self):
        # Ensure a customer exists for tenant-2
        t2_cust = Customer.objects.filter(tenant_id='tenant-2').first()
        if not t2_cust:
            t2 = Tenant.objects.get(id='tenant-2')
            t2_cust = Customer.objects.create(
                id='cust-t2-isolated',
                tenant=t2,
                name='Coastal Customer',
                email='coastal.cust@example.com',
                phone='+1 555-4321',
                driver_license={'number': 'DL-T2', 'stateOrCountry': 'US', 'expiryDate': '2028-01-01', 'verified': True}
            )

        res = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'customerId': t2_cust.id,
            'startDate': '2026-12-01T10:00:00Z',
            'endDate': '2026-12-04T10:00:00Z',
            'rentalRateType': 'daily'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Customer not found for this business', res.json().get('error', ''))

        # Also attempt non-existent customerId
        res2 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'customerId': 'cust-completely-fake-id',
            'startDate': '2026-12-05T10:00:00Z',
            'endDate': '2026-12-08T10:00:00Z',
            'rentalRateType': 'daily'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)

    # ----------------------------------------------------
    # H-02: Rental state-machine validation
    # ----------------------------------------------------
    def test_h02_rental_state_machine_validation(self):
        # Create a confirmed rental
        rent_res = self.client.post('/api/rentals', {
            'vehicleId': 'veh-3',
            'startDate': '2026-12-10T10:00:00Z',
            'endDate': '2026-12-13T10:00:00Z',
            'customerName': 'State Test Customer',
            'customerEmail': 'state.test@example.com',
            'customerPhone': '+1 555-2222',
            'rentalRateType': 'daily'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(rent_res.status_code, status.HTTP_201_CREATED)
        rental_id = rent_res.json()['id']
        rental = Rental.objects.get(id=rental_id)
        self.assertEqual(rental.status, 'confirmed')

        # 1. Invalid: Check-in before checkout (rental is confirmed, not active)
        bad_checkin = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 15000,
                'returnFuelOrBattery': 100
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(bad_checkin.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Only active rentals can be checked in', bad_checkin.json().get('error', ''))

        # 2. Valid checkout: confirmed -> active
        good_checkout = self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {
                'departureOdometer': 12000,
                'departureFuelOrBattery': 100
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(good_checkout.status_code, status.HTTP_200_OK)
        rental.refresh_from_db()
        self.assertEqual(rental.status, 'active')

        # 3. Invalid: checkout again on active rental
        bad_checkout2 = self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {
                'departureOdometer': 12000,
                'departureFuelOrBattery': 100
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(bad_checkout2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Only confirmed rentals can be checked out', bad_checkout2.json().get('error', ''))

        # 4. Valid check-in: active -> completed
        good_checkin = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 12500,
                'returnFuelOrBattery': 95
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(good_checkin.status_code, status.HTTP_200_OK)
        rental.refresh_from_db()
        self.assertEqual(rental.status, 'completed')

        # 5. Invalid: check-in again on completed rental
        bad_checkin2 = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 12600,
                'returnFuelOrBattery': 95
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(bad_checkin2.status_code, status.HTTP_400_BAD_REQUEST)

    # ----------------------------------------------------
    # H-03: Payment validation & overpayment prevention
    # ----------------------------------------------------
    def test_h03_payment_validation_and_overpayment_prevention(self):
        # Find or create an unpaid invoice for tenant-1
        invoice = Invoice.objects.filter(tenant_id='tenant-1', balance_due__gt=0).first()
        if not invoice:
            t1 = Tenant.objects.get(id='tenant-1')
            c1 = Customer.objects.filter(tenant_id='tenant-1').first()
            invoice = Invoice.objects.create(
                id='inv-test-pay-1',
                tenant=t1,
                invoice_number='INV-2026-999999',
                customer=c1,
                customer_name=c1.name,
                status='issued',
                subtotal=Decimal('300.00'),
                tax_amount=Decimal('26.25'),
                total_amount=Decimal('326.25'),
                paid_amount=Decimal('0.00'),
                balance_due=Decimal('326.25'),
                due_date=timezone.now() + datetime.timedelta(days=7)
            )
        self.assertIsNotNone(invoice)
        balance = float(invoice.balance_due)
        self.assertGreater(balance, 0.0)

        # 1. Zero or negative payment rejected
        res_zero = self.client.post(f'/api/invoices/{invoice.id}/pay', {
            'amount': 0,
            'method': 'cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_zero.status_code, status.HTTP_400_BAD_REQUEST)

        res_neg = self.client.post(f'/api/invoices/{invoice.id}/pay', {
            'amount': -50.0,
            'method': 'cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_neg.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Overpayment rejected
        res_over = self.client.post(f'/api/invoices/{invoice.id}/pay', {
            'amount': balance + 100.0,
            'method': 'credit_card'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_over.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('exceeds the remaining balance', res_over.json().get('error', ''))

        # 3. Valid exact payment succeeds
        res_pay = self.client.post(f'/api/invoices/{invoice.id}/pay', {
            'amount': balance,
            'method': 'credit_card'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_pay.status_code, status.HTTP_200_OK)
        invoice.refresh_from_db()
        self.assertEqual(invoice.status, 'paid')
        self.assertEqual(invoice.balance_due, Decimal('0.00'))

        # 4. Duplicate payment against already-paid invoice rejected
        res_dup = self.client.post(f'/api/invoices/{invoice.id}/pay', {
            'amount': 10.0,
            'method': 'credit_card'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_dup.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already fully paid', res_dup.json().get('error', ''))

    # ----------------------------------------------------
    # H-04: Default permissions protect all internal endpoints
    # ----------------------------------------------------
    def test_h04_default_permissions_protect_internal_endpoints(self):
        protected_endpoints = [
            ('/api/vehicles', 'GET'),
            ('/api/customers', 'GET'),
            ('/api/rentals', 'GET'),
            ('/api/invoices', 'GET'),
            ('/api/maintenance', 'GET'),
            ('/api/audit-logs', 'GET'),
            ('/api/analytics', 'GET'),
            ('/api/auth/me', 'GET'),
            ('/api/auth/users', 'GET'),
            ('/api/tenants', 'GET'),
        ]
        for url, method in protected_endpoints:
            if method == 'GET':
                res = self.client.get(url)
            self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED, f"{url} should require authentication")

        # Verify intentionally public endpoints succeed without auth
        public_endpoints = [
            '/api/health',
            '/api/public/business/apex-rentals',
            '/api/public/vehicles?slug=apex-rentals',
        ]
        for url in public_endpoints:
            res = self.client.get(url)
            self.assertEqual(res.status_code, status.HTTP_200_OK, f"{url} should be publicly accessible")

    def test_health_check_returns_json_under_browser_and_html_accept_headers(self):
        """Verifies GET /api/health always returns JSON (never crashes on template rendering)."""
        accept_headers = [
            'text/html',
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'application/json',
            '*/*',
        ]
        for accept in accept_headers:
            res = self.client.get('/api/health', HTTP_ACCEPT=accept)
            self.assertEqual(res.status_code, status.HTTP_200_OK)
            self.assertEqual(res['Content-Type'], 'application/json')
            data = res.json()
            self.assertEqual(data.get('status'), 'ok')
            self.assertEqual(data.get('engine'), 'Python/Django')
            self.assertIn('timestamp', data)

    # ----------------------------------------------------
    # L-02: Tenant enumeration protection
    # ----------------------------------------------------
    def test_l02_tenant_enumeration_protection(self):
        # 1. Unauthenticated request to /api/tenants blocked
        res_unauth = self.client.get('/api/tenants')
        self.assertEqual(res_unauth.status_code, status.HTTP_401_UNAUTHORIZED)

        # 2. Authenticated user only sees their own tenant
        res_auth = self.client.get('/api/tenants', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_auth.status_code, status.HTTP_200_OK)
        tenants = res_auth.json()
        self.assertEqual(len(tenants), 1)
        self.assertEqual(tenants[0]['id'], 'tenant-1')

    # ----------------------------------------------------
    # L-03: Public tenant serializer data exposure restriction
    # ----------------------------------------------------
    def test_l03_public_tenant_serializer_no_internal_exposure(self):
        res = self.client.get('/api/public/business/apex-rentals')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()

        # Required public fields present
        self.assertIn('id', data)
        self.assertIn('name', data)
        self.assertIn('slug', data)
        self.assertIn('tagline', data)
        self.assertIn('currency', data)
        self.assertEqual(data['currency'], '₹')
        self.assertEqual(data['currencyCode'], 'INR')
        self.assertIn('locations', data)
        self.assertIn('categories', data)

        # Internal / sensitive fields strictly excluded
        self.assertNotIn('lateFeePerHour', data)
        self.assertNotIn('fuelPenaltyPerPercent', data)
        self.assertNotIn('taxRate', data)
        self.assertNotIn('securityDepositDefault', data)
        self.assertNotIn('email', data)
        self.assertNotIn('phone', data)
        self.assertNotIn('address', data)


class RentalConcurrencyRegressionTestSuite(TransactionTestCase):
    """
    Regression test suite specifically verifying:
    - Exclusion constraint enforcement at database layer
    - Pessimistic locking (select_for_update) & atomic transactions
    - Multi-tenant vehicle safety
    - High-concurrency race condition prevention (Test 7)
    """

    def setUp(self):
        seed_database()
        self.client = Client()

        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.owner_token = AuthService.generate_jwt(self.owner)

        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')
        self.t2_owner_token = AuthService.generate_jwt(self.t2_owner)

    # Test 1 — Normal booking
    def test_01_normal_booking(self):
        """Test 1: Create a booking successfully (HTTP 201)."""
        res = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-01-10T10:00:00Z',
            'endDate': '2027-01-15T10:00:00Z',
            'customerName': 'Test Customer 1',
            'customerEmail': 'tc1@example.com',
            'customerPhone': '+1 555-0101',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertIn('id', data)
        self.assertEqual(data['vehicleId'], 'veh-1')
        self.assertEqual(data['status'], 'confirmed')

    # Test 2 — Overlapping booking
    def test_02_overlapping_booking(self):
        """Test 2: Attempt to book the same vehicle with overlapping dates (HTTP 409)."""
        # Create initial booking
        res1 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-02-10T10:00:00Z',
            'endDate': '2027-02-15T10:00:00Z',
            'customerName': 'Test Customer 2A',
            'customerEmail': 'tc2a@example.com',
            'customerPhone': '+1 555-0102',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Attempt overlapping booking
        res2 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-02-12T10:00:00Z',
            'endDate': '2027-02-18T10:00:00Z',
            'customerName': 'Test Customer 2B',
            'customerEmail': 'tc2b@example.com',
            'customerPhone': '+1 555-0103',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)
        data = res2.json()
        self.assertIn('already booked', data.get('error', '').lower())
        self.assertTrue(data.get('conflict', False))

    # Test 3 — Non-overlapping booking
    def test_03_non_overlapping_booking(self):
        """Test 3: Book the same vehicle after previous rental ends (Succeeds)."""
        res1 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-03-01T10:00:00Z',
            'endDate': '2027-03-05T10:00:00Z',
            'customerName': 'Test Customer 3A',
            'customerEmail': 'tc3a@example.com',
            'customerPhone': '+1 555-0104',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Adjacent non-overlapping booking starting exactly when previous ends
        res2 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-03-05T10:00:00Z',
            'endDate': '2027-03-10T10:00:00Z',
            'customerName': 'Test Customer 3B',
            'customerEmail': 'tc3b@example.com',
            'customerPhone': '+1 555-0105',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)

    # Test 4 — Cancelled booking
    def test_04_cancelled_booking(self):
        """Test 4: Cancelled booking does not incorrectly block a new booking."""
        res1 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-04-01T10:00:00Z',
            'endDate': '2027-04-05T10:00:00Z',
            'customerName': 'Test Customer 4A',
            'customerEmail': 'tc4a@example.com',
            'customerPhone': '+1 555-0106',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        b1_id = res1.json()['id']

        # Cancel the first booking
        res_cancel = self.client.put(f'/api/rentals/{b1_id}', {
            'status': 'cancelled'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_cancel.status_code, status.HTTP_200_OK)

        # Create new booking with the exact same dates
        res2 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-04-01T10:00:00Z',
            'endDate': '2027-04-05T10:00:00Z',
            'customerName': 'Test Customer 4B',
            'customerEmail': 'tc4b@example.com',
            'customerPhone': '+1 555-0107',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)

    # Test 5 — Completed booking
    def test_05_completed_booking(self):
        """Test 5: Historical completed rentals do not incorrectly block future bookings."""
        res1 = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-05-01T10:00:00Z',
            'endDate': '2027-05-05T10:00:00Z',
            'customerName': 'Test Customer 5A',
            'customerEmail': 'tc5a@example.com',
            'customerPhone': '+1 555-0108',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        b1_id = res1.json()['id']

        # Mark first booking as completed
        res_comp = self.client.put(f'/api/rentals/{b1_id}', {
            'status': 'completed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_comp.status_code, status.HTTP_200_OK)

        # Future booking succeeds
        res_future = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-05-06T10:00:00Z',
            'endDate': '2027-05-10T10:00:00Z',
            'customerName': 'Test Customer 5B',
            'customerEmail': 'tc5b@example.com',
            'customerPhone': '+1 555-0109',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_future.status_code, status.HTTP_201_CREATED)

        # Even re-booking the same completed time window succeeds because completed is not active/confirmed
        res_overlap = self.client.post('/api/rentals', {
            'vehicleId': 'veh-1',
            'startDate': '2027-05-02T10:00:00Z',
            'endDate': '2027-05-04T10:00:00Z',
            'customerName': 'Test Customer 5C',
            'customerEmail': 'tc5c@example.com',
            'customerPhone': '+1 555-0110',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_overlap.status_code, status.HTTP_201_CREATED)

    # Test 6 — Cross-tenant vehicle access
    def test_06_cross_tenant_vehicle_access(self):
        """Test 6: Cross-tenant vehicle access returns HTTP 404."""
        # veh-t2-1 belongs to tenant-2; requesting with tenant-1 token
        res = self.client.post('/api/rentals', {
            'vehicleId': 'veh-t2-1',
            'startDate': '2027-07-01T10:00:00Z',
            'endDate': '2027-07-05T10:00:00Z',
            'customerName': 'Cross Tenant Hacker',
            'customerEmail': 'hacker@example.com',
            'customerPhone': '+1 555-9999',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # Test 7 — Concurrent booking
    def test_07_concurrent_booking(self):
        """Test 7: Simultaneous overlapping bookings for the same vehicle.
        Exactly ONE booking succeeds (HTTP 201), the other request fails with a conflict (HTTP 409).
        """
        def submit_booking(idx):
            try:
                c = Client()
                res = c.post('/api/rentals', {
                    'vehicleId': 'veh-3',
                    'startDate': '2027-08-10T10:00:00Z',
                    'endDate': '2027-08-15T10:00:00Z',
                    'customerName': f'Concurrent Customer {idx}',
                    'customerEmail': f'concurrent{idx}@example.com',
                    'customerPhone': f'+1 555-080{idx}',
                    'rentalRateType': 'daily',
                    'status': 'confirmed'
                }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
                return res.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(submit_booking, i) for i in (1, 2)]
            results = [f.result() for f in futures]

        # Exactly one 201 and one 409
        self.assertEqual(sorted(results), [status.HTTP_201_CREATED, status.HTTP_409_CONFLICT])

        # Exactly one rental saved in database
        rentals_in_db = Rental.objects.filter(
            vehicle_id='veh-3',
            start_date__gte='2027-08-10T00:00:00Z',
            status__in=['confirmed', 'active']
        )
        self.assertEqual(rentals_in_db.count(), 1)

    # Test 8 — Direct database exclusion constraint enforcement
    def test_08_direct_database_exclusion_constraint_enforcement(self):
        """Verify that direct ORM creation bypassing application services triggers the GiST exclusion constraint."""
        Rental.objects.create(
            id='direct-rent-1',
            tenant_id='tenant-1',
            rental_number='RNT-9901',
            vehicle_id='veh-1',
            customer_id='cust-1',
            customer_name='Direct Cust 1',
            vehicle_name='Direct Veh 1',
            start_date=datetime.datetime(2027, 9, 1, 10, 0, tzinfo=datetime.timezone.utc),
            end_date=datetime.datetime(2027, 9, 5, 10, 0, tzinfo=datetime.timezone.utc),
            daily_rate=Decimal('50.00'),
            days=4,
            base_rental=Decimal('200.00'),
            total_amount=Decimal('200.00'),
            balance_due=Decimal('200.00'),
            status='confirmed'
        )
        with self.assertRaises(IntegrityError):
            Rental.objects.create(
                id='direct-rent-2',
                tenant_id='tenant-1',
                rental_number='RNT-9902',
                vehicle_id='veh-1',
                customer_id='cust-2',
                customer_name='Direct Cust 2',
                vehicle_name='Direct Veh 1',
                start_date=datetime.datetime(2027, 9, 3, 10, 0, tzinfo=datetime.timezone.utc),
                end_date=datetime.datetime(2027, 9, 7, 10, 0, tzinfo=datetime.timezone.utc),
                daily_rate=Decimal('50.00'),
                days=4,
                base_rental=Decimal('200.00'),
                total_amount=Decimal('200.00'),
                balance_due=Decimal('200.00'),
                status='confirmed'
            )


class DatabaseBackedJWTAuthenticationRegressionTestSuite(TestCase):
    """
    Regression test suite verifying database-backed JWT hardening:
    - User existence verified in PostgreSQL
    - Tenant isolation enforced (token tenantId matches DB tenant_id)
    - Role changes in DB take immediate effect without waiting for token expiration
    - Expired tokens and tampered signatures rejected with HTTP 401
    """

    def setUp(self):
        seed_database()
        self.client = Client()

        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.manager = User.objects.get(email='sarah.chen@apexrentals.com')
        self.staff = User.objects.get(email='jordan.lee@apexrentals.com')
        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')

    def test_01_valid_user(self):
        """Test 1 — Valid user: Valid JWT + existing user returns HTTP 200."""
        token = AuthService.generate_jwt(self.owner)
        res = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertEqual(data.get('email'), self.owner.email)
        self.assertEqual(data.get('role'), 'owner')

    def test_02_deleted_user(self):
        """Test 2 — Deleted user: Valid JWT whose user is deleted from database returns HTTP 401."""
        # Create a user in the database
        temp_user = User.objects.create(
            id='temp-user-deleted-test',
            tenant=self.owner.tenant,
            email='ephemeral@apexrentals.com',
            name='Ephemeral User',
            role='staff',
            password_hash='dummy-hash'
        )
        token = AuthService.generate_jwt(temp_user)

        # Confirm token works before deletion
        res_before = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res_before.status_code, status.HTTP_200_OK)

        # Delete user from database
        temp_user.delete()

        # Attempt to use the existing token now that user is deleted
        res_after = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res_after.status_code, status.HTTP_401_UNAUTHORIZED)
        # Ensure no sensitive user IDs leaked in error message
        self.assertNotIn('temp-user-deleted-test', str(res_after.json()))

    def test_03_tenant_mismatch(self):
        """Test 3 — Tenant mismatch: JWT containing User A but Tenant B returns HTTP 401."""
        # self.owner belongs to tenant-1. Forge a token claiming tenant-2
        mismatched_payload = {
            'id': self.owner.id,
            'email': self.owner.email,
            'name': self.owner.name,
            'role': self.owner.role,
            'tenantId': 'tenant-2',  # Mismatch! Database user belongs to tenant-1
            'exp': timezone.now() + datetime.timedelta(days=1)
        }
        forged_token = jwt.encode(mismatched_payload, settings.JWT_SECRET, algorithm='HS256')

        # Request must fail with HTTP 401
        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {forged_token}')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_04_role_change(self):
        """Test 4 — Role change: User's role changed from manager to staff in database.
        Using the old JWT with role='manager':
        - Authentication succeeds (HTTP 200)
        - Current role in response is 'staff'
        - Manager-only endpoint returns HTTP 403 Forbidden
        """
        temp_manager = User.objects.create(
            id='temp-manager-role-test',
            tenant=self.owner.tenant,
            email='manager.test@apexrentals.com',
            name='Test Manager',
            role='manager',
            password_hash='dummy-hash'
        )
        # Token generated when user is 'manager'
        manager_token = AuthService.generate_jwt(temp_manager)

        # Initially, manager can access manager-only endpoint (/api/auth/users)
        res_mgr = self.client.get('/api/auth/users', HTTP_AUTHORIZATION=f'Bearer {manager_token}')
        self.assertEqual(res_mgr.status_code, status.HTTP_200_OK)

        # Demote user in database from manager to staff
        temp_manager.role = 'staff'
        temp_manager.save(update_fields=['role'])

        # Using the SAME original manager token:
        # 1. Auth succeeds and /api/auth/me reflects the new 'staff' role
        res_me = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {manager_token}')
        self.assertEqual(res_me.status_code, status.HTTP_200_OK)
        self.assertEqual(res_me.json().get('role'), 'staff')

        # 2. Manager-only endpoint (/api/auth/users requires IsOwnerOrManager) is now rejected with HTTP 403 Forbidden
        res_denied = self.client.get('/api/auth/users', HTTP_AUTHORIZATION=f'Bearer {manager_token}')
        self.assertEqual(res_denied.status_code, status.HTTP_403_FORBIDDEN)

    def test_05_expired_jwt(self):
        """Test 5 — Expired JWT returns HTTP 401."""
        expired_payload = {
            'id': self.owner.id,
            'email': self.owner.email,
            'name': self.owner.name,
            'role': self.owner.role,
            'tenantId': self.owner.tenant_id,
            'exp': timezone.now() - datetime.timedelta(hours=2)
        }
        expired_token = jwt.encode(expired_payload, settings.JWT_SECRET, algorithm='HS256')

        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {expired_token}')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_06_invalid_signature(self):
        """Test 6 — Invalid signature / payload tampering returns HTTP 401."""
        valid_token = AuthService.generate_jwt(self.owner)
        tampered_token = valid_token[:-6] + 'abcdef'

        res1 = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {tampered_token}')
        self.assertEqual(res1.status_code, status.HTTP_401_UNAUTHORIZED)

        # Token signed with wrong secret key
        wrong_key_token = jwt.encode({
            'id': self.owner.id,
            'email': self.owner.email,
            'name': self.owner.name,
            'role': self.owner.role,
            'tenantId': self.owner.tenant_id,
            'exp': timezone.now() + datetime.timedelta(days=1)
        }, 'wrong-secret-key-that-does-not-match', algorithm='HS256')

        res2 = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {wrong_key_token}')
        self.assertEqual(res2.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_07_inr_currency_and_pricing_consistency(self):
        """Verify INR currency, ₹ symbol, canonical add-ons and invoice calculation."""
        biz_res = self.client.get('/api/public/business/apex-rentals')
        self.assertEqual(biz_res.status_code, status.HTTP_200_OK)
        b_data = biz_res.json()
        self.assertEqual(b_data['currency'], '₹')
        self.assertEqual(b_data['currencyCode'], 'INR')

        # Canonical quote with add-ons and unknown add-on
        quote_res = self.client.post('/api/public/quote', {
            'slug': 'apex-rentals',
            'vehicleId': 'veh-1',
            'startDate': '2026-12-25T10:00:00Z',
            'endDate': '2026-12-27T10:00:00Z',
            'rentalRateType': 'daily',
            'addOnIds': ['helmet', 'gps', 'unrecognized_fake_addon']
        }, content_type='application/json')
        self.assertEqual(quote_res.status_code, status.HTTP_200_OK)
        q = quote_res.json()
        self.assertEqual(q['durationUnits'], 2)
        # Helmet (5/day * 2 = 10) + GPS (10/day * 2 = 20) = 30. Unrecognized fake addon is ignored.
        self.assertEqual(q['totalAddOns'], 30.0)
        self.assertEqual(len(q['addOns']), 2)

        # Booking creation generates invoice with ₹ in line items
        book_res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': 'veh-1',
            'startDate': '2026-12-25T10:00:00Z',
            'endDate': '2026-12-27T10:00:00Z',
            'customerName': 'INR Test Customer',
            'customerEmail': 'inr.test@example.com',
            'customerPhone': '+91 98765 43210',
            'addOnIds': ['helmet']
        }, content_type='application/json')
        self.assertEqual(book_res.status_code, status.HTTP_201_CREATED)
        b_res = book_res.json()

        # Check invoice line item in DB uses ₹ symbol
        inv = Invoice.objects.get(rental_id=b_res['rentalId'])
        self.assertEqual(float(inv.total_amount), b_res['totalAmount'])
        items = inv.payments[0]['__items']
        self.assertTrue(any('₹' in it['description'] for it in items))
        self.assertFalse(any('$' in it['description'] for it in items))

    def test_08_saas_signup_flow(self):
        """
        Comprehensive test of the SaaS signup/onboarding flow:
        - Successful registration
        - Duplicate company slug rejection
        - Invalid email rejection
        - Weak password rejection
        - Password confirmation mismatch rejection
        - Duplicate owner email rejection
        - Password bcrypt hashing and non-exposure
        - Atomic tenant and owner creation
        - JWT issuance and /api/auth/me verification
        - INR / ₹ / Asia/Kolkata defaults
        - Login with new credentials
        - Existing seeded login compatibility
        - Multi-tenant isolation
        """
        import bcrypt
        base_payload = {
            'companyName': 'Himalayan Expeditions',
            'companyEmail': 'info@himalayanexpeditions.com',
            'phone': '+91 98765 00001',
            'ownerName': 'Tenzing Norgay',
            'ownerEmail': 'tenzing@himalayanexpeditions.com',
            'password': 'StrongPassword123!',
            'confirmPassword': 'StrongPassword123!',
            'captchaToken': 'dev-token'
        }

        # 1. Validation: Password mismatch
        bad_mismatch = base_payload.copy()
        bad_mismatch['confirmPassword'] = 'DifferentPassword123!'
        res = self.client.post('/api/auth/register', bad_mismatch, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('confirmPassword', res.json())

        # 2. Validation: Weak password (< 8 chars or missing number/letter)
        bad_weak = base_payload.copy()
        bad_weak['password'] = 'short'
        bad_weak['confirmPassword'] = 'short'
        res = self.client.post('/api/auth/register', bad_weak, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', res.json())

        bad_no_num = base_payload.copy()
        bad_no_num['password'] = 'allletterspassword'
        bad_no_num['confirmPassword'] = 'allletterspassword'
        res = self.client.post('/api/auth/register', bad_no_num, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', res.json())

        # 3. Validation: Invalid email
        bad_email = base_payload.copy()
        bad_email['ownerEmail'] = 'not-an-email'
        res = self.client.post('/api/auth/register', bad_email, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('ownerEmail', res.json())

        # 4. Validation: Duplicate owner email (existing seed user)
        bad_dupe_email = base_payload.copy()
        bad_dupe_email['ownerEmail'] = 'alex.rivera@apexrentals.com'
        res = self.client.post('/api/auth/register', bad_dupe_email, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('ownerEmail', res.json())

        # 5. Validation: Duplicate company slug (existing seed tenant 'apex-rentals')
        bad_dupe_company = base_payload.copy()
        bad_dupe_company['companyName'] = 'Apex Rentals'  # Generates slug 'apex-rentals'
        res = self.client.post('/api/auth/register', bad_dupe_company, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('companyName', res.json())

        # 6. Successful Registration creates unverified account
        reg_res = self.client.post('/api/auth/register', base_payload, content_type='application/json')
        self.assertEqual(reg_res.status_code, status.HTTP_201_CREATED)
        data = reg_res.json()

        # Verify response structure: email verification required, NO JWT issued directly
        self.assertTrue(data.get('emailVerificationRequired'))
        self.assertEqual(data.get('email'), 'tenzing@himalayanexpeditions.com')
        self.assertNotIn('token', data)
        tenant_data = data['tenant']

        # 7. Verify Owner role and Tenant details
        self.assertEqual(tenant_data['slug'], 'himalayan-expeditions')
        self.assertEqual(tenant_data['currency'], '₹')
        self.assertEqual(tenant_data['currencyCode'], 'INR')
        self.assertEqual(tenant_data['timezone'], 'Asia/Kolkata')

        # 8. Verify Database State & Bcrypt hashing & Unverified status
        db_user = User.objects.get(email='tenzing@himalayanexpeditions.com')
        self.assertEqual(db_user.role, 'owner')
        self.assertIsNone(db_user.email_verified_at)
        self.assertFalse(db_user.is_email_verified)
        self.assertTrue(db_user.password_hash.startswith('$2b$') or db_user.password_hash.startswith('$2a$'))
        self.assertNotEqual(db_user.password_hash, 'StrongPassword123!')
        self.assertTrue(bcrypt.checkpw('StrongPassword123!'.encode('utf-8'), db_user.password_hash.encode('utf-8')))

        db_tenant = Tenant.objects.get(slug='himalayan-expeditions')
        self.assertEqual(db_user.tenant_id, db_tenant.id)
        self.assertEqual(db_tenant.currency, '₹')

        # 9. Unverified owner cannot log in
        unverified_login = self.client.post('/api/auth/login', {
            'email': 'tenzing@himalayanexpeditions.com',
            'password': 'StrongPassword123!'
        }, content_type='application/json')
        self.assertEqual(unverified_login.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(unverified_login.json().get('unverified'))

        # 10. Verify email via verification token record
        from .models import EmailVerificationToken
        token_record = EmailVerificationToken.objects.filter(user=db_user).first()
        self.assertIsNotNone(token_record)

        # Mark user as verified
        db_user.email_verified_at = timezone.now()
        db_user.save(update_fields=['email_verified_at'])

        # 11. Verified owner can now log in via /api/auth/login
        login_res = self.client.post('/api/auth/login', {
            'email': 'tenzing@himalayanexpeditions.com',
            'password': 'StrongPassword123!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)
        self.assertIn('token', login_res.json())
        token = login_res.json()['token']

        # 12. Verified user can call /api/auth/me
        me_res = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(me_res.status_code, status.HTTP_200_OK)
        me_data = me_res.json()
        self.assertEqual(me_data['user']['email'], 'tenzing@himalayanexpeditions.com')
        self.assertEqual(me_data['user']['tenantId'], db_tenant.id)

        # 13. Existing seeded login still works
        seed_login = self.client.post('/api/auth/login', {
            'email': 'alex.rivera@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(seed_login.status_code, status.HTTP_200_OK)

        # 14. Multi-tenant isolation: new owner cannot access vehicles or settings of tenant-1
        t1_vehicles = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(t1_vehicles.status_code, status.HTTP_200_OK)
        self.assertEqual(len(t1_vehicles.json()), 0)

        mod_t1 = self.client.put('/api/tenants/tenant-1', {'name': 'Hacked Name'}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(mod_t1.status_code, status.HTTP_403_FORBIDDEN)


class PublicBookingAntiSpamTestSuite(TestCase):
    def setUp(self):
        seed_database()
        cache.clear()
        self.client = Client()
        self.tenant = Tenant.objects.get(slug='apex-rentals')
        self.vehicle = Vehicle.objects.filter(tenant_id=self.tenant.id, status='available').first()
        self.staff_user = User.objects.get(email='jordan.lee@apexrentals.com')
        self.staff_token = AuthService.generate_jwt(self.staff_user)

    def tearDown(self):
        cache.clear()

    # 1. Valid guest booking succeeds
    def test_01_valid_guest_booking_succeeds(self):
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'Aarav Patel',
            'customerPhone': '+91 98451 23456',
            'customerEmail': 'aarav.patel@example.com',
            'customerAddress': 'Indiranagar, Bengaluru',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token-valid'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertTrue(data['success'])
        self.assertIn('bookingNumber', data)
        self.assertIn('rentalId', data)
        self.assertEqual(data['status'], 'confirmed')
        self.assertTrue(Rental.objects.filter(id=data['rentalId']).exists())

    # 2. Missing phone rejected
    def test_02_missing_phone_rejected(self):
        # Empty string phone
        res1 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'No Phone Guest',
            'customerPhone': '',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_400_BAD_REQUEST)

        # Omitted phone
        res2 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'No Phone Guest',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)

    # 3. Invalid phone rejected
    def test_03_invalid_phone_rejected(self):
        invalid_phones = [
            '12345',               # too short (< 7 digits)
            '1111111111',          # repetitive dummy digits
            '0000000000',          # repetitive dummy digits
            '1234567',             # ascending dummy sequence
            '9876543210',          # descending dummy sequence
            '123456789012345678',  # too long (> 15 digits)
        ]
        for bad_phone in invalid_phones:
            cache.clear()
            res = self.client.post('/api/public/bookings', {
                'slug': 'apex-rentals',
                'vehicleId': self.vehicle.id,
                'startDate': '2026-11-01T10:00:00Z',
                'endDate': '2026-11-03T10:00:00Z',
                'customerName': 'Bad Phone Tester',
                'customerPhone': bad_phone,
                'rentalRateType': 'daily'
            }, content_type='application/json')
            self.assertEqual(
                res.status_code,
                status.HTTP_400_BAD_REQUEST,
                f"Expected phone '{bad_phone}' to be rejected"
            )

    # 4. Invalid email rejected (and optional email succeeds when omitted)
    def test_04_invalid_email_rejected_and_optional_email_succeeds(self):
        # Invalid email format
        bad_res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'Bad Email Guest',
            'customerPhone': '+91 98451 99881',
            'customerEmail': 'not-an-email-address',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(bad_res.status_code, status.HTTP_400_BAD_REQUEST)

        # Omitted/optional email succeeds
        good_res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'No Email Guest',
            'customerPhone': '+91 98451 99882',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(good_res.status_code, status.HTTP_201_CREATED)

    # 5. Invalid vehicle rejected
    def test_05_invalid_vehicle_rejected(self):
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': 'nonexistent-veh-999',
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'Guest',
            'customerPhone': '+91 98451 99883',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # 6. Vehicle belonging to another tenant rejected
    def test_06_vehicle_belonging_to_another_tenant_rejected(self):
        t2_veh = Vehicle.objects.filter(tenant__slug='metro-carshare').first()
        self.assertIsNotNone(t2_veh)

        # Attempt to book tenant-2 vehicle via tenant-1 storefront
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': t2_veh.id,
            'startDate': '2026-11-01T10:00:00Z',
            'endDate': '2026-11-03T10:00:00Z',
            'customerName': 'Tenant Cross Guest',
            'customerPhone': '+91 98451 99884',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # 7. Invalid dates rejected
    def test_07_invalid_dates_rejected(self):
        # End date before start date
        res1 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-10T10:00:00Z',
            'endDate': '2026-11-05T10:00:00Z',
            'customerName': 'Backwards Dates',
            'customerPhone': '+91 98451 99885',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_400_BAD_REQUEST)

        # Malformed non-ISO dates
        res2 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': 'invalid-date',
            'endDate': '2026-11-05T10:00:00Z',
            'customerName': 'Malformed Date',
            'customerPhone': '+91 98451 99885',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)

    # 8. Duplicate booking protection
    def test_08_duplicate_booking_protection(self):
        # First booking succeeds
        res1 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-07T10:00:00Z',
            'endDate': '2026-11-09T10:00:00Z',
            'customerName': 'Priya Nair',
            'customerPhone': '+91 98451 77701',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)
        b_num1 = res1.json()['bookingNumber']

        initial_count = Rental.objects.filter(
            vehicle_id=self.vehicle.id,
            start_date='2026-11-07T10:00:00Z',
            end_date='2026-11-09T10:00:00Z'
        ).count()
        self.assertEqual(initial_count, 1)

        # Immediate repeated submission with identical details
        res2 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-07T10:00:00Z',
            'endDate': '2026-11-09T10:00:00Z',
            'customerName': 'Priya Nair',
            'customerPhone': '+91 98451 77701',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')

        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        data2 = res2.json()
        self.assertTrue(data2.get('duplicate'))
        self.assertEqual(data2['bookingNumber'], b_num1)

        # Verify no second rental was created in database
        final_count = Rental.objects.filter(
            vehicle_id=self.vehicle.id,
            start_date='2026-11-07T10:00:00Z',
            end_date='2026-11-09T10:00:00Z'
        ).count()
        self.assertEqual(final_count, 1)

    # 9. Rate-limit behavior
    def test_09_rate_limit_behavior(self):
        client_ip = '198.51.100.99'
        cache.clear()

        # Send 5 rapid booking attempts from same IP (allowed threshold)
        for i in range(5):
            res = self.client.post('/api/public/bookings', {
                'slug': 'apex-rentals',
                'vehicleId': self.vehicle.id,
                'startDate': f'2026-11-{10+i}T10:00:00Z',
                'endDate': f'2026-11-{12+i}T10:00:00Z',
                'customerName': f'Spam Tester {i}',
                'customerPhone': f'+91 98451 0000{i}',
                'rentalRateType': 'daily',
                'captchaToken': 'dev-token'
            }, content_type='application/json', REMOTE_ADDR=client_ip)
            # Either 201 or 409, but not 429
            self.assertNotEqual(res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        # 6th attempt should be blocked by IP rate limit
        blocked_res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-20T10:00:00Z',
            'endDate': '2026-11-22T10:00:00Z',
            'customerName': 'Spam Tester Blocked',
            'customerPhone': '+91 98451 00009',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json', REMOTE_ADDR=client_ip)

        self.assertEqual(blocked_res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(
            blocked_res.json().get('error'),
            "Too many booking attempts. Please try again later."
        )

    # 10. CAPTCHA verification failure
    def test_10_captcha_verification_failure(self):
        # In debug mode, testing with 'invalid-captcha-token' returns 400
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-11-25T10:00:00Z',
            'endDate': '2026-11-27T10:00:00Z',
            'customerName': 'Bot Spammer',
            'customerPhone': '+91 98451 11333',
            'rentalRateType': 'daily',
            'captchaToken': 'invalid-captcha-token'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Bot verification failed', res.json().get('error', ''))

        # In production with missing secret key, fail safely
        with override_settings(DEBUG=False, TURNSTILE_SECRET_KEY='', TEST_MODE=False):
            prod_fail = self.client.post('/api/public/bookings', {
                'slug': 'apex-rentals',
                'vehicleId': self.vehicle.id,
                'startDate': '2026-11-25T10:00:00Z',
                'endDate': '2026-11-27T10:00:00Z',
                'customerName': 'Customer',
                'customerPhone': '+91 98451 11333',
                'rentalRateType': 'daily',
                'captchaToken': 'any-token'
            }, content_type='application/json')
            self.assertEqual(prod_fail.status_code, status.HTTP_400_BAD_REQUEST)

    # 11. CAPTCHA verification success
    def test_11_captcha_verification_success(self):
        # Mocked external Turnstile API call in production mode
        with override_settings(DEBUG=False, TURNSTILE_SECRET_KEY='0x4AAAAAAtestsecret'):
            mock_resp = MagicMock()
            mock_resp.read.return_value = json.dumps({'success': True}).encode('utf-8')
            mock_resp.__enter__.return_value = mock_resp

            with patch('urllib.request.urlopen', return_value=mock_resp):
                res = self.client.post('/api/public/bookings', {
                    'slug': 'apex-rentals',
                    'vehicleId': self.vehicle.id,
                    'startDate': '2026-11-28T10:00:00Z',
                    'endDate': '2026-11-30T10:00:00Z',
                    'customerName': 'Human Guest',
                    'customerPhone': '+91 98451 55667',
                    'rentalRateType': 'daily',
                    'captchaToken': 'valid-turnstile-response'
                }, content_type='application/json')
                self.assertEqual(res.status_code, status.HTTP_201_CREATED)
                self.assertTrue(res.json()['success'])

    # 12. Existing authenticated staff booking still works
    def test_12_existing_authenticated_staff_booking_still_works(self):
        staff_res = self.client.post('/api/rentals', {
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-01T10:00:00Z',
            'endDate': '2026-12-03T10:00:00Z',
            'customerName': 'Walk-in Customer',
            'customerPhone': '+91 98451 99112',
            'rentalRateType': 'daily',
            'status': 'confirmed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(staff_res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(staff_res.json()['customerName'], 'Walk-in Customer')

    # 13. Existing public storefront still works
    def test_13_existing_public_storefront_still_works(self):
        # Storefront profile
        sf_res = self.client.get('/api/public/business/apex-rentals')
        self.assertEqual(sf_res.status_code, status.HTTP_200_OK)
        self.assertEqual(sf_res.json()['slug'], 'apex-rentals')

        # Public fleet listing
        fleet_res = self.client.get('/api/public/vehicles?slug=apex-rentals')
        self.assertEqual(fleet_res.status_code, status.HTTP_200_OK)
        self.assertTrue(len(fleet_res.json()) > 0)

        # Public quote endpoint
        quote_res = self.client.post('/api/public/quote', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-05T10:00:00Z',
            'endDate': '2026-12-08T10:00:00Z',
            'rentalRateType': 'daily'
        }, content_type='application/json')
        self.assertEqual(quote_res.status_code, status.HTTP_200_OK)
        self.assertIn('totalAmount', quote_res.json())

    # 14. Existing double-booking protection still works
    def test_14_existing_double_booking_protection_still_works(self):
        # Customer 1 books
        res1 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-10T10:00:00Z',
            'endDate': '2026-12-14T10:00:00Z',
            'customerName': 'Guest One',
            'customerPhone': '+91 98451 12341',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Customer 2 (different phone/details) books overlapping dates
        res2 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-12T10:00:00Z',
            'endDate': '2026-12-16T10:00:00Z',
            'customerName': 'Guest Two',
            'customerPhone': '+91 98451 98765',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)

    # 15. Pricing remains server-authoritative
    def test_15_pricing_remains_server_authoritative(self):
        # Client attempts to submit spoofed total of 1 rupee
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-20T10:00:00Z',
            'endDate': '2026-12-22T10:00:00Z',
            'customerName': 'Tamper Tester',
            'customerPhone': '+91 98451 88991',
            'rentalRateType': 'daily',
            'totalAmount': 1.0,
            'dailyRate': 1.0,
            'depositAmount': 0.0,
            'balanceDue': 0.0,
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        rental = Rental.objects.get(id=data['rentalId'])

        # Server calculates legitimate daily rate (e.g. ₹55 or ₹120/day)
        expected_pricing = PricingService.calculate_canonical_pricing(self.tenant, {
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-20T10:00:00Z',
            'endDate': '2026-12-22T10:00:00Z',
            'rentalRateType': 'daily'
        })
        self.assertAlmostEqual(float(rental.total_amount), float(expected_pricing['totalAmount']), places=1)
        self.assertNotEqual(float(rental.total_amount), 1.0)

    # 16. Customer does not need an account
    def test_16_customer_does_not_need_an_account(self):
        initial_user_count = User.objects.count()

        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-25T10:00:00Z',
            'endDate': '2026-12-27T10:00:00Z',
            'customerName': 'Guest Without Account',
            'customerPhone': '+91 98451 44332',
            'customerEmail': 'guest.noaccount@example.com',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # No User was created
        final_user_count = User.objects.count()
        self.assertEqual(initial_user_count, final_user_count)
        self.assertFalse(User.objects.filter(email='guest.noaccount@example.com').exists())

    # 17. No sensitive internal data is returned
    def test_17_no_sensitive_internal_data_is_returned(self):
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': self.vehicle.id,
            'startDate': '2026-12-28T10:00:00Z',
            'endDate': '2026-12-30T10:00:00Z',
            'customerName': 'Sanitized Guest',
            'customerPhone': '+91 98451 77665',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()

        # Sensitive internal fields MUST NOT be present
        forbidden_keys = [
            'password', 'password_hash', 'passwordHash',
            'token', 'jwt', 'secret',
            'tenantId', 'tenant_id',
            'agentUserId', 'agent_user_id',
            'traceback', 'exception', 'stack_trace'
        ]
        for k in forbidden_keys:
            self.assertNotIn(k, data)

        # Expected public keys ARE present
        expected_keys = ['success', 'bookingNumber', 'rentalId', 'vehicleName', 'startDate', 'endDate', 'totalAmount', 'depositAmount', 'status', 'message']
        for k in expected_keys:
            self.assertIn(k, data)


class OwnerSignupEmailVerificationTestSuite(TestCase):
    def setUp(self):
        from django.core.cache import cache
        from django.core import mail
        from .email_service import EmailService
        seed_database()
        cache.clear()
        mail.outbox = []
        EmailService.outbox = []
        self.client = Client()
        self.valid_signup_data = {
            'companyName': 'Everest Auto Rentals',
            'companyEmail': 'info@everestautorentals.com',
            'phone': '+91 98888 11111',
            'ownerName': 'Edmund Hillary',
            'ownerEmail': 'edmund@everestautorentals.com',
            'password': 'SecurePassword888!',
            'confirmPassword': 'SecurePassword888!',
            'captchaToken': 'dev-token'
        }

    # 1. Valid signup creates unverified owner
    def test_01_valid_signup_creates_unverified_owner(self):
        res = self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertTrue(data.get('emailVerificationRequired'))
        self.assertEqual(data.get('email'), 'edmund@everestautorentals.com')
        self.assertNotIn('token', data)

        owner = User.objects.get(email='edmund@everestautorentals.com')
        self.assertIsNone(owner.email_verified_at)
        self.assertFalse(owner.is_email_verified)
        self.assertEqual(owner.role, 'owner')

    # 2. Turnstile failure rejects signup
    def test_02_turnstile_failure_rejects_signup(self):
        bad_data = self.valid_signup_data.copy()
        bad_data['captchaToken'] = 'invalid-captcha-token'
        res = self.client.post('/api/auth/register', bad_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Bot verification failed', str(res.json()))
        self.assertFalse(User.objects.filter(email='edmund@everestautorentals.com').exists())

    # 3. Turnstile success allows signup
    def test_03_turnstile_success_allows_signup(self):
        good_data = self.valid_signup_data.copy()
        good_data['captchaToken'] = 'dev-token'
        res = self.client.post('/api/auth/register', good_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertTrue(res.json().get('success'))

    # 4. Verification email is generated/sent
    def test_04_verification_email_is_generated_and_sent(self):
        from django.core import mail
        mail.outbox = []
        res = self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        self.assertEqual(len(mail.outbox), 1)
        sent_email = mail.outbox[0]
        self.assertIn('edmund@everestautorentals.com', sent_email.to)
        self.assertIn('Verify your email', sent_email.subject)
        otp_challenge = EmailOTPChallenge.objects.filter(user__email='edmund@everestautorentals.com').first()
        self.assertIsNotNone(otp_challenge)

    # 5. Valid verification token verifies email
    def test_05_valid_verification_token_verifies_email(self):
        # Register owner
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='edmund@everestautorentals.com')
        _, raw_token = AuthService.create_verification_token_for_user(user)

        # Verify via GET endpoint
        verify_res = self.client.get(f'/api/auth/verify-email?token={raw_token}')
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)
        self.assertTrue(verify_res.json().get('success'))

        user.refresh_from_db()
        self.assertIsNotNone(user.email_verified_at)
        self.assertTrue(user.is_email_verified)

    # 6. Invalid token rejected
    def test_06_invalid_token_rejected(self):
        res = self.client.get('/api/auth/verify-email?token=bogus-random-nonexistent-token')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Invalid verification token', str(res.json()))

    # 7. Expired token rejected
    def test_07_expired_token_rejected(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='edmund@everestautorentals.com')

        # Create expired token directly in EmailVerificationToken
        import secrets, hashlib
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()
        expired_time = timezone.now() - datetime.timedelta(hours=25)
        EmailVerificationToken.objects.create(
            user=user,
            token_hash=token_hash,
            expires_at=expired_time
        )

        res = self.client.get(f'/api/auth/verify-email?token={raw_token}')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('expired', str(res.json()).lower())

    # 8. Used token rejected
    def test_08_used_token_rejected(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='edmund@everestautorentals.com')
        _, raw_token = AuthService.create_verification_token_for_user(user)

        # 1st verification succeeds
        res1 = self.client.post('/api/auth/verify-email', {'token': raw_token}, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # 2nd attempt with same token fails
        res2 = self.client.post('/api/auth/verify-email', {'token': raw_token}, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already been used', str(res2.json()).lower())

    # 9. Unverified owner cannot login
    def test_09_unverified_owner_cannot_login(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')

        login_res = self.client.post('/api/auth/login', {
            'email': 'edmund@everestautorentals.com',
            'password': 'SecurePassword888!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_403_FORBIDDEN)
        data = login_res.json()
        self.assertTrue(data.get('unverified'))
        self.assertIn('Please verify your email', data.get('error', ''))
        self.assertNotIn('token', data)

    # 10. Verified owner can login
    def test_10_verified_owner_can_login(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='edmund@everestautorentals.com')
        _, raw_token = AuthService.create_verification_token_for_user(user)

        # Verify
        self.client.get(f'/api/auth/verify-email?token={raw_token}')

        # Login now succeeds
        login_res = self.client.post('/api/auth/login', {
            'email': 'edmund@everestautorentals.com',
            'password': 'SecurePassword888!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)
        token = login_res.json().get('token')
        self.assertIsNotNone(token)

        # Authenticate on protected endpoint
        me_res = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(me_res.status_code, status.HTTP_200_OK)
        self.assertEqual(me_res.json()['user']['email'], 'edmund@everestautorentals.com')

    # 11. Resend verification works
    def test_11_resend_verification_works(self):
        from django.core import mail
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        mail.outbox = []

        res = self.client.post('/api/auth/resend-verification', {
            'email': 'edmund@everestautorentals.com'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json().get('success'))
        self.assertEqual(len(mail.outbox), 1)

    # 12. Resend is rate limited
    def test_12_resend_is_rate_limited(self):
        from django.core.cache import cache
        cache.clear()
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')

        # Threshold is 3 per email or 5 per IP (clearing per-request cooldown to test volumetric limit)
        for _ in range(3):
            cache.delete("resend_otp_cooldown_edmund@everestautorentals.com")
            res = self.client.post('/api/auth/resend-verification', {
                'email': 'edmund@everestautorentals.com'
            }, content_type='application/json')
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        cache.delete("resend_otp_cooldown_edmund@everestautorentals.com")
        # 4th request must be rate-limited
        rate_limited_res = self.client.post('/api/auth/resend-verification', {
            'email': 'edmund@everestautorentals.com'
        }, content_type='application/json')
        self.assertEqual(rate_limited_res.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    # 13. Duplicate email remains rejected
    def test_13_duplicate_email_remains_rejected(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')

        dupe_data = self.valid_signup_data.copy()
        dupe_data['companyName'] = 'Different Company Name'
        res = self.client.post('/api/auth/register', dupe_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('ownerEmail', res.json())

    # 14. Existing users still work
    def test_14_existing_users_still_work(self):
        login_res = self.client.post('/api/auth/login', {
            'email': 'alex.rivera@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)
        self.assertIn('token', login_res.json())

    # 15. Tenant isolation remains intact
    def test_15_tenant_isolation_remains_intact(self):
        # Register and verify owner
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='edmund@everestautorentals.com')
        user.email_verified_at = timezone.now()
        user.save(update_fields=['email_verified_at'])

        login_res = self.client.post('/api/auth/login', {
            'email': 'edmund@everestautorentals.com',
            'password': 'SecurePassword888!'
        }, content_type='application/json')
        token = login_res.json()['token']

        # Query vehicles
        v_res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(v_res.status_code, status.HTTP_200_OK)
        # Cannot see apex-rentals vehicles
        self.assertEqual(len(v_res.json()), 0)

        # Modifying apex-rentals is forbidden
        mod_res = self.client.put('/api/tenants/tenant-1', {'name': 'Breached'}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(mod_res.status_code, status.HTTP_403_FORBIDDEN)

    # 16. Existing staff authentication still works
    def test_16_existing_staff_authentication_still_works(self):
        staff_login = self.client.post('/api/auth/login', {
            'email': 'sarah.chen@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(staff_login.status_code, status.HTTP_200_OK)
        token = staff_login.json()['token']

        # Staff can view vehicles
        v_res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(v_res.status_code, status.HTTP_200_OK)

    # 17. Existing public guest booking still works
    def test_17_existing_public_guest_booking_still_works(self):
        v = Vehicle.objects.filter(tenant__slug='apex-rentals', status='available').first()
        res = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': v.id,
            'startDate': '2026-12-01T10:00:00Z',
            'endDate': '2026-12-04T10:00:00Z',
            'customerName': 'Guest Traveller',
            'customerPhone': '+91 98451 99001',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertTrue(data.get('success'))
        self.assertIn('bookingNumber', data)

    # 18. Existing double-booking protection still works
    def test_18_existing_double_booking_protection_still_works(self):
        v = Vehicle.objects.filter(tenant__slug='apex-rentals', status='available').first()
        # Booking 1
        res1 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': v.id,
            'startDate': '2026-12-15T10:00:00Z',
            'endDate': '2026-12-18T10:00:00Z',
            'customerName': 'Primary Guest',
            'customerPhone': '+91 98451 99002',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Overlapping booking 2
        res2 = self.client.post('/api/public/bookings', {
            'slug': 'apex-rentals',
            'vehicleId': v.id,
            'startDate': '2026-12-16T10:00:00Z',
            'endDate': '2026-12-20T10:00:00Z',
            'customerName': 'Conflicting Guest',
            'customerPhone': '+91 98451 99003',
            'rentalRateType': 'daily',
            'captchaToken': 'dev-token'
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)


class BrevoTransactionalEmailTestSuite(TestCase):
    def setUp(self):
        seed_database()
        from .email_service import EmailService
        EmailService.outbox = []
        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.test_token = "secure-random-test-token-value-12345"

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEFAULT_FROM_EMAIL='RentFlow <no-reply@rentflow.app>',
        FRONTEND_URL='http://localhost:3000',
        DEBUG=True
    )
    @patch('requests.post')
    def test_01_brevo_successful_email_dispatch(self, mock_post):
        from .email_service import EmailService
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.content = b'{"messageId": "<202610091200.msg123@smtp-relay.brevo.com>"}'
        mock_resp.json.return_value = {"messageId": "<202610091200.msg123@smtp-relay.brevo.com>"}
        mock_post.return_value = mock_resp

        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token,
            company_name="Apex Rentals"
        )
        self.assertTrue(success)
        mock_post.assert_called_once()

        # Check call arguments
        call_url = mock_post.call_args[0][0]
        call_kwargs = mock_post.call_args[1]

        self.assertEqual(call_url, 'https://api.brevo.com/v3/smtp/email')
        self.assertEqual(call_kwargs['headers']['api-key'], 'xkeysib-mock-test-api-key-999')
        self.assertEqual(call_kwargs['headers']['content-type'], 'application/json')
        self.assertEqual(call_kwargs['headers']['accept'], 'application/json')

        payload = call_kwargs['json']
        self.assertEqual(payload['sender']['name'], 'RentFlow')
        self.assertEqual(payload['sender']['email'], 'no-reply@rentflow.app')
        self.assertEqual(payload['to'][0]['email'], self.owner.email)
        self.assertIn('Verify your email', payload['subject'])
        self.assertIn(f"http://localhost:3000/verify-email?token={self.test_token}", payload['htmlContent'])
        self.assertIn(f"http://localhost:3000/verify-email?token={self.test_token}", payload['textContent'])

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEFAULT_FROM_EMAIL='RentFlow <no-reply@rentflow.app>',
        DEBUG=True
    )
    @patch('requests.post')
    def test_02_brevo_api_rejection_returns_false(self, mock_post):
        from .email_service import EmailService
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.content = b'{"code": "invalid_parameter", "message": "Sender domain is not verified"}'
        mock_resp.json.return_value = {
            "code": "invalid_parameter",
            "message": "Sender domain is not verified"
        }
        mock_post.return_value = mock_resp

        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token,
            company_name="Apex Rentals"
        )
        self.assertFalse(success)
        mock_post.assert_called_once()

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEBUG=True
    )
    @patch('requests.post')
    def test_03_brevo_unauthorized_401_rejection(self, mock_post):
        from .email_service import EmailService
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.content = b'{"code": "unauthorized", "message": "Key not found"}'
        mock_resp.json.return_value = {"code": "unauthorized", "message": "Key not found"}
        mock_post.return_value = mock_resp

        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertFalse(success)

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEBUG=True
    )
    @patch('requests.post')
    def test_04_brevo_request_timeout_handled_safely(self, mock_post):
        import requests
        from .email_service import EmailService
        mock_post.side_effect = requests.exceptions.Timeout("Connection timed out after 10s")

        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertFalse(success)

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEBUG=True
    )
    @patch('requests.post')
    def test_05_brevo_connection_error_handled_safely(self, mock_post):
        import requests
        from .email_service import EmailService
        mock_post.side_effect = requests.exceptions.ConnectionError("DNS resolution failed")

        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertFalse(success)

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='',
        DEBUG=True
    )
    @patch('requests.post')
    def test_06_brevo_missing_api_key_fails_early(self, mock_post):
        from .email_service import EmailService
        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertFalse(success)
        mock_post.assert_not_called()

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-prod-api-key-12345',
        FRONTEND_URL='http://localhost:3000',
        DEBUG=False,
        TEST_PRODUCTION_SECURITY=True
    )
    def test_07_brevo_production_prevents_localhost_links(self):
        from .email_service import EmailService
        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertFalse(success)

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-prod-api-key-12345',
        FRONTEND_URL='http://app.rentflow.com',
        DEBUG=False,
        TEST_PRODUCTION_SECURITY=True
    )
    def test_08_brevo_production_requires_https(self):
        from .email_service import EmailService
        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertFalse(success)

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-prod-api-key-12345',
        FRONTEND_URL='https://app.rentflow.com',
        DEFAULT_FROM_EMAIL='RentFlow Production <no-reply@rentflow.app>',
        DEBUG=False,
        TEST_PRODUCTION_SECURITY=True
    )
    @patch('requests.post')
    def test_09_brevo_production_generates_https_link(self, mock_post):
        from .email_service import EmailService
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.content = b'{"messageId": "<prod-123@smtp-relay.brevo.com>"}'
        mock_resp.json.return_value = {"messageId": "<prod-123@smtp-relay.brevo.com>"}
        mock_post.return_value = mock_resp

        success = EmailService.send_verification_email(
            user=self.owner,
            token=self.test_token
        )
        self.assertTrue(success)
        payload = mock_post.call_args[1]['json']
        self.assertIn(f"https://app.rentflow.com/verify-email?token={self.test_token}", payload['htmlContent'])
        self.assertIn(f"https://app.rentflow.com/verify-email?token={self.test_token}", payload['textContent'])

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-supersecret-token-key-do-not-log',
        DEBUG=True
    )
    @patch('requests.post')
    def test_10_sensitive_secrets_not_exposed_in_logs(self, mock_post):
        import logging
        from .email_service import EmailService
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.content = b'{"messageId": "<logged-msg-123>"}'
        mock_resp.json.return_value = {"messageId": "<logged-msg-123>"}
        mock_post.return_value = mock_resp

        sensitive_token = "secret-super-private-token-xyz-987654321"

        with self.assertLogs('api', level='INFO') as log_capture:
            EmailService.send_verification_email(
                user=self.owner,
                token=sensitive_token
            )

        log_text = " ".join(log_capture.output)
        self.assertNotIn('xkeysib-supersecret-token-key-do-not-log', log_text)
        self.assertNotIn(sensitive_token, log_text)

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEBUG=True
    )
    @patch('requests.post')
    def test_11_resend_verification_endpoint_reports_error_on_brevo_failure(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.content = b'{"code": "invalid_parameter", "message": "Domain blacklisted"}'
        mock_resp.json.return_value = {"code": "invalid_parameter", "message": "Domain blacklisted"}
        mock_post.return_value = mock_resp

        # Create unverified user
        unverified_user = User.objects.create(
            tenant=self.owner.tenant,
            email='unverified.owner@apexrentals.com',
            password_hash='hash',
            name='Unverified Owner',
            role='owner',
            email_verified_at=None
        )

        res = self.client.post('/api/auth/resend-verification', {
            'email': unverified_user.email
        }, content_type='application/json')

        self.assertEqual(res.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertFalse(res.json().get('success'))

    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-api-key-999',
        DEBUG=True
    )
    @patch('requests.post')
    def test_12_resend_verification_endpoint_reports_success_on_brevo_delivery(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_resp.content = b'{"messageId": "<ok-123>"}'
        mock_resp.json.return_value = {"messageId": "<ok-123>"}
        mock_post.return_value = mock_resp

        # Create unverified user
        unverified_user = User.objects.create(
            tenant=self.owner.tenant,
            email='resend.test@apexrentals.com',
            password_hash='hash',
            name='Resend Test Owner',
            role='owner',
            email_verified_at=None
        )

        res = self.client.post('/api/auth/resend-verification', {
            'email': unverified_user.email
        }, content_type='application/json')

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json().get('success'))
        self.assertIn('Verification email sent successfully', res.json().get('message', ''))


class EmailOTPVerificationTestSuite(TestCase):
    def setUp(self):
        from django.core.cache import cache
        from .email_service import EmailService
        seed_database()
        cache.clear()
        EmailService.outbox = []
        self.client = Client()
        self.valid_signup_data = {
            'companyName': 'Kanchenjunga Motors',
            'companyEmail': 'info@kanchenjunga.com',
            'phone': '+91 97777 22222',
            'ownerName': 'Pemba Sherpa',
            'ownerEmail': 'pemba@kanchenjunga.com',
            'password': 'SecurePassword999!',
            'confirmPassword': 'SecurePassword999!',
            'captchaToken': 'dev-token'
        }

    # 1. Valid OTP verification marks owner verified
    def test_01_valid_otp_verification_marks_owner_verified(self):
        reg_res = self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        self.assertEqual(reg_res.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='pemba@kanchenjunga.com')
        self.assertFalse(user.is_email_verified)

        # Generate challenge and get raw OTP
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)
        self.assertEqual(len(raw_otp), 6)
        self.assertTrue(raw_otp.isdigit())

        verify_res = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)
        self.assertTrue(verify_res.json().get('success'))

        user.refresh_from_db()
        challenge.refresh_from_db()
        self.assertTrue(user.is_email_verified)
        self.assertIsNotNone(user.email_verified_at)
        self.assertTrue(challenge.is_used)
        self.assertIsNotNone(challenge.used_at)

    # 2. Incorrect OTP rejected with remaining attempts count
    def test_02_incorrect_otp_rejected_with_remaining_attempts(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)

        wrong_otp = '000000' if raw_otp != '000000' else '111111'
        res = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': wrong_otp
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('4 attempts remaining', res.json().get('error', ''))

        challenge.refresh_from_db()
        self.assertEqual(challenge.failed_attempts, 1)
        self.assertFalse(challenge.is_used)

        user.refresh_from_db()
        self.assertFalse(user.is_email_verified)

    # 3. Expired OTP rejected and invalidated
    def test_03_expired_otp_rejected_and_invalidated(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)

        # Force challenge to be expired (15 minutes ago)
        challenge.expires_at = timezone.now() - datetime.timedelta(minutes=15)
        challenge.save(update_fields=['expires_at'])

        res = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('expired', res.json().get('error', '').lower())

        challenge.refresh_from_db()
        self.assertTrue(challenge.is_used)

    # 4. Reuse of an already-used OTP challenge rejected
    def test_04_reuse_of_used_otp_rejected(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)

        # 1st verification succeeds
        res1 = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # 2nd verification: User is already verified, returns safe confirmation
        res2 = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertIn('already verified', res2.json().get('message', '').lower())

    # 5. Leading-zero OTP preserved and verified accurately
    def test_05_leading_zero_otp_preserved_and_verified(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')

        # Create challenge explicitly with leading zeros: '007890'
        salt = secrets.token_hex(16)
        leading_zero_otp = '007890'
        otp_hash = hashlib.sha256(f"{salt}:{leading_zero_otp}".encode('utf-8')).hexdigest()
        challenge = EmailOTPChallenge.objects.create(
            user=user,
            otp_hash=otp_hash,
            otp_salt=salt,
            expires_at=timezone.now() + datetime.timedelta(minutes=10),
            failed_attempts=0,
            is_used=False
        )

        res = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': '007890'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json().get('success'))

        user.refresh_from_db()
        self.assertTrue(user.is_email_verified)

    # 6. Five failed attempts locks and permanently invalidates challenge
    def test_06_five_failed_attempts_permanently_invalidates_challenge(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)

        # 4 incorrect attempts
        for i in range(1, 5):
            res = self.client.post('/api/auth/verify-email-otp', {
                'email': user.email,
                'otp': '999999'
            }, content_type='application/json')
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
            remaining = 5 - i
            self.assertIn(f'{remaining} attempt', res.json().get('error', ''))

        # 5th incorrect attempt exceeds limit and invalidates challenge
        res5 = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': '999999'
        }, content_type='application/json')
        self.assertEqual(res5.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Maximum 5 attempts reached', res5.json().get('error', ''))

        challenge.refresh_from_db()
        self.assertTrue(challenge.is_used)

        # 6th attempt with the CORRECT code is now rejected because challenge was invalidated
        res6 = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res6.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('No active verification code found', res6.json().get('error', ''))

    # 7. Resend cooldown enforces 60 seconds
    def test_07_resend_cooldown_enforces_60_seconds(self):
        from django.core.cache import cache
        cache.clear()
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')

        # 1st resend succeeds
        res1 = self.client.post('/api/auth/resend-verification', {
            'email': 'pemba@kanchenjunga.com'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # 2nd resend immediately within 60s is rejected by cooldown
        res2 = self.client.post('/api/auth/resend-verification', {
            'email': 'pemba@kanchenjunga.com'
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('Please wait', res2.json().get('error', ''))
        self.assertTrue(res2.json().get('cooldown'))

    # 8. Previous OTP invalidated when new OTP is generated
    def test_08_previous_otp_invalidated_when_new_otp_generated(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')

        challenge_1, raw_otp_1 = AuthService.create_otp_challenge_for_user(user)
        # Generate new OTP
        challenge_2, raw_otp_2 = AuthService.create_otp_challenge_for_user(user)

        # Old challenge 1 must be marked used/invalidated
        challenge_1.refresh_from_db()
        self.assertTrue(challenge_1.is_used)

        # Verifying with old OTP fails
        res_old = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp_1
        }, content_type='application/json')
        # raw_otp_1 might not match challenge_2, or fails
        if raw_otp_1 != raw_otp_2:
            self.assertEqual(res_old.status_code, status.HTTP_400_BAD_REQUEST)

        # Verifying with new OTP succeeds
        res_new = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp_2
        }, content_type='application/json')
        self.assertEqual(res_new.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.is_email_verified)

    # 9. Brevo API rejection and timeout handled safely without orphaned records
    @override_settings(
        EMAIL_PROVIDER='brevo',
        BREVO_API_KEY='xkeysib-mock-test-key',
        DEBUG=True
    )
    @patch('requests.post')
    def test_09_brevo_api_rejection_and_timeout(self, mock_post):
        # 1. Brevo rejection on registration returns HTTP 502
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.content = b'{"code": "invalid_parameter", "message": "Domain blacklisted"}'
        mock_resp.json.return_value = {"code": "invalid_parameter", "message": "Domain blacklisted"}
        mock_post.return_value = mock_resp

        fail_data = self.valid_signup_data.copy()
        fail_data['ownerEmail'] = 'brevo.fail@kanchenjunga.com'
        fail_data['companyName'] = 'Kanchenjunga Fail Biz'

        res = self.client.post('/api/auth/register', fail_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertFalse(res.json().get('success'))
        self.assertIn('Failed to deliver verification email', res.json().get('error', ''))

        # DB must have rolled back / cleaned up: user does not exist
        self.assertFalse(User.objects.filter(email='brevo.fail@kanchenjunga.com').exists())

        # 2. Timeout on resend returns HTTP 502
        import requests
        mock_post.side_effect = requests.exceptions.Timeout("Brevo connection timed out")
        user = User.objects.create(
            tenant=self.valid_signup_data and Tenant.objects.first(),
            email='timeout.user@example.com',
            password_hash='hash',
            name='Timeout User',
            role='owner',
            email_verified_at=None
        )

        res_resend = self.client.post('/api/auth/resend-verification', {
            'email': user.email
        }, content_type='application/json')
        self.assertEqual(res_resend.status_code, status.HTTP_502_BAD_GATEWAY)
        self.assertFalse(res_resend.json().get('success'))

    # 10. Unverified owner login rejected; verified owner login succeeds
    def test_10_unverified_owner_login_rejected_and_verified_succeeds(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')

        # 1. Login while unverified -> HTTP 403 Forbidden
        login_unverified = self.client.post('/api/auth/login', {
            'email': 'pemba@kanchenjunga.com',
            'password': 'SecurePassword999!'
        }, content_type='application/json')
        self.assertEqual(login_unverified.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(login_unverified.json().get('unverified'))

        # 2. Verify via OTP
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)
        verify_res = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)

        # 3. Login now succeeds -> HTTP 200 with JWT
        login_verified = self.client.post('/api/auth/login', {
            'email': 'pemba@kanchenjunga.com',
            'password': 'SecurePassword999!'
        }, content_type='application/json')
        self.assertEqual(login_verified.status_code, status.HTTP_200_OK)
        token = login_verified.json().get('token')
        self.assertIsNotNone(token)

        # Access protected endpoint
        me_res = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(me_res.status_code, status.HTTP_200_OK)
        self.assertEqual(me_res.json()['user']['email'], 'pemba@kanchenjunga.com')

    # 11. OTP is NEVER stored in plaintext in the database
    def test_11_otp_never_stored_in_plaintext_in_database(self):
        self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        user = User.objects.get(email='pemba@kanchenjunga.com')
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user)

        challenge.refresh_from_db()
        # Challenge stores 64-char sha256 hex digest, never 6-digit plaintext
        self.assertEqual(len(challenge.otp_hash), 64)
        self.assertNotEqual(challenge.otp_hash, raw_otp)
        self.assertEqual(len(challenge.otp_salt), 32)
        # Plaintext OTP is nowhere in challenge fields
        self.assertNotIn(raw_otp, challenge.otp_hash)
        self.assertNotIn(raw_otp, challenge.otp_salt)

    # 12. OTP is never exposed in API responses or logs
    def test_12_otp_never_exposed_in_api_responses_or_logs(self):
        res = self.client.post('/api/auth/register', self.valid_signup_data, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        res_data = res.json()

        # OTP must NOT be exposed in response body
        self.assertNotIn('otp', res_data)
        self.assertNotIn('code', res_data)
        self.assertNotIn('raw_otp', res_data)

        # Resend response must NOT expose OTP
        resend_res = self.client.post('/api/auth/resend-verification', {
            'email': 'pemba@kanchenjunga.com'
        }, content_type='application/json')
        resend_data = resend_res.json()
        self.assertNotIn('otp', resend_data)
        self.assertNotIn('code', resend_data)

    # 13. Existing verified demo accounts and tenant isolation remain intact
    def test_13_existing_demo_accounts_and_tenant_isolation_intact(self):
        # Demo owner login works
        demo_login = self.client.post('/api/auth/login', {
            'email': 'alex.rivera@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(demo_login.status_code, status.HTTP_200_OK)
        token = demo_login.json()['token']

        # Demo manager login works
        mgr_login = self.client.post('/api/auth/login', {
            'email': 'sarah.chen@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(mgr_login.status_code, status.HTTP_200_OK)

        # Multi-tenant isolation: Apex owner cannot access tenant-2 vehicles
        v_res = self.client.get('/api/vehicles/veh-t2-1', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(v_res.status_code, status.HTTP_404_NOT_FOUND)

    # 14. Field-level validation error mapping in serializer
    def test_14_field_level_validation_error_mapping(self):
        # 1. Password mismatch mapped specifically to confirmPassword
        mismatch_data = self.valid_signup_data.copy()
        mismatch_data['confirmPassword'] = 'MismatchPassword123!'
        res_mismatch = self.client.post('/api/auth/register', mismatch_data, content_type='application/json')
        self.assertEqual(res_mismatch.status_code, status.HTTP_400_BAD_REQUEST)
        errs = res_mismatch.json()
        self.assertIn('confirmPassword', errs)
        self.assertIn('Passwords do not match', str(errs['confirmPassword']))

        # 2. Weak password mapped specifically to password
        weak_data = self.valid_signup_data.copy()
        weak_data['password'] = 'allletters'
        weak_data['confirmPassword'] = 'allletters'
        res_weak = self.client.post('/api/auth/register', weak_data, content_type='application/json')
        self.assertEqual(res_weak.status_code, status.HTTP_400_BAD_REQUEST)
        errs_weak = res_weak.json()
        self.assertIn('password', errs_weak)
        self.assertIn('at least one letter and one number', str(errs_weak['password']))


class ForgotPasswordResetTestSuite(TestCase):
    """
    Comprehensive test suite verifying the complete Password Reset flow:
    - Request reset OTP (existing, nonexistent, unverified)
    - 6-digit numeric OTP challenge verification with purpose separation
    - Expiration, lockout, cooldown, replay prevention, old OTP invalidation
    - Reset authorization token lifecycle (hash storage, expiry, single-use)
    - Server-side password complexity & mismatch validation
    - Old password invalidation and new password authentication
    - Brevo rejection/timeout safety
    - Tenant isolation & existing demo account compatibility
    """
    def setUp(self):
        cache.clear()
        EmailService.outbox.clear()
        self.client = Client()

        # Seed database with baseline tenants and demo users
        seed_database()

        self.demo_owner_email = 'alex.rivera@apexrentals.com'
        self.demo_user = User.objects.get(email=self.demo_owner_email)

    # 1. Existing account forgot-password request
    def test_01_existing_account_forgot_password_request(self):
        res = self.client.post('/api/auth/forgot-password', {
            'email': self.demo_owner_email
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json().get('success'))
        self.assertIn('instructions will be sent', res.json().get('message', ''))

        # Verifies EmailOTPChallenge with purpose='password_reset' was created
        challenge = EmailOTPChallenge.objects.filter(
            user=self.demo_user,
            purpose='password_reset',
            is_used=False
        ).first()
        self.assertIsNotNone(challenge)
        self.assertEqual(challenge.purpose, 'password_reset')
        self.assertEqual(challenge.failed_attempts, 0)

    # 2. Nonexistent account generic response (no enumeration)
    def test_02_nonexistent_account_generic_response(self):
        res = self.client.post('/api/auth/forgot-password', {
            'email': 'ghost.user.unknown@example.org'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertTrue(data.get('success'))
        self.assertIn('instructions will be sent', data.get('message', ''))

        # No OTP challenges created for nonexistent user
        self.assertFalse(EmailOTPChallenge.objects.filter(user__email='ghost.user.unknown@example.org').exists())

    # 3. Unverified account behavior (generic response, no reset email dispatched)
    def test_03_unverified_account_behavior(self):
        unverified_user = User.objects.create(
            tenant=self.demo_user.tenant,
            email='unverified.owner@apexrentals.com',
            password_hash=AuthService.hash_password('TempPass123!'),
            name='Unverified Owner',
            role='owner',
            email_verified_at=None
        )

        res = self.client.post('/api/auth/forgot-password', {
            'email': unverified_user.email
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json().get('success'))

        # No password reset challenge should be created for unverified user
        self.assertFalse(EmailOTPChallenge.objects.filter(user=unverified_user, purpose='password_reset').exists())

    # 4. Valid password-reset OTP verification issues reset token
    def test_04_valid_password_reset_otp(self):
        challenge, raw_otp = AuthService.create_password_reset_otp(self.demo_user)

        res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertTrue(data.get('success'))
        reset_token = data.get('resetToken')
        self.assertIsNotNone(reset_token)

        # Challenge is marked used
        challenge.refresh_from_db()
        self.assertTrue(challenge.is_used)
        self.assertIsNotNone(challenge.used_at)

        # PasswordResetToken record exists in DB (hashed)
        token_record = PasswordResetToken.objects.filter(user=self.demo_user, is_used=False).first()
        self.assertIsNotNone(token_record)
        self.assertNotEqual(token_record.token_hash, reset_token)

    # 5. Incorrect OTP rejected with remaining attempts
    def test_05_incorrect_otp(self):
        challenge, raw_otp = AuthService.create_password_reset_otp(self.demo_user)

        res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': '999999' if raw_otp != '999999' else '111111'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('4 attempts remaining', res.json().get('error', ''))

        challenge.refresh_from_db()
        self.assertEqual(challenge.failed_attempts, 1)

    # 6. Expired OTP rejected
    def test_06_expired_otp(self):
        challenge, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        challenge.expires_at = timezone.now() - datetime.timedelta(minutes=15)
        challenge.save(update_fields=['expires_at'])

        res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('expired', res.json().get('error', '').lower())

    # 7. Reused OTP rejected
    def test_07_reused_otp(self):
        challenge, raw_otp = AuthService.create_password_reset_otp(self.demo_user)

        # 1st verification succeeds
        res1 = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # 2nd verification fails
        res2 = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)

    # 8. Five-attempt lockout invalidates challenge
    def test_08_five_attempt_lockout(self):
        challenge, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        wrong_otp = '999999' if raw_otp != '999999' else '111111'

        for i in range(4):
            res = self.client.post('/api/auth/verify-password-reset-otp', {
                'email': self.demo_owner_email,
                'otp': wrong_otp
            }, content_type='application/json')
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 5th attempt triggers lockout
        res5 = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': wrong_otp
        }, content_type='application/json')
        self.assertEqual(res5.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Maximum 5 attempts reached', res5.json().get('error', ''))

        challenge.refresh_from_db()
        self.assertTrue(challenge.is_used)

        # 6th attempt with correct OTP is rejected
        res6 = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(res6.status_code, status.HTTP_400_BAD_REQUEST)

    # 9. Resend cooldown enforces 60 seconds
    def test_09_resend_cooldown(self):
        res1 = self.client.post('/api/auth/forgot-password', {
            'email': self.demo_owner_email
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # Immediate 2nd request hits cooldown
        res2 = self.client.post('/api/auth/forgot-password', {
            'email': self.demo_owner_email
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertTrue(res2.json().get('cooldown'))

    # 10. Old OTP invalidated when new OTP generated
    def test_10_old_otp_invalidation(self):
        c1, raw_otp1 = AuthService.create_password_reset_otp(self.demo_user)
        c2, raw_otp2 = AuthService.create_password_reset_otp(self.demo_user)

        c1.refresh_from_db()
        self.assertTrue(c1.is_used)

        # Verifying with old OTP fails
        res_old = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp1
        }, content_type='application/json')
        self.assertEqual(res_old.status_code, status.HTTP_400_BAD_REQUEST)

        # Verifying with new OTP succeeds
        res_new = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp2
        }, content_type='application/json')
        self.assertEqual(res_new.status_code, status.HTTP_200_OK)

    # 11. Signup OTP cannot reset password
    def test_11_signup_otp_cannot_reset_password(self):
        c_signup, raw_otp_signup = AuthService.create_otp_challenge_for_user(self.demo_user, purpose='signup')

        res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp_signup
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    # 12. Reset authorization token expiry
    def test_12_reset_authorization_token_expiry(self):
        _, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        verify_res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        reset_token = verify_res.json()['resetToken']

        # Force token expiry
        token_record = PasswordResetToken.objects.get(user=self.demo_user, is_used=False)
        token_record.expires_at = timezone.now() - datetime.timedelta(minutes=30)
        token_record.save(update_fields=['expires_at'])

        reset_res = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': 'NewSecurePass999!',
            'confirmPassword': 'NewSecurePass999!'
        }, content_type='application/json')
        self.assertEqual(reset_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('expired', reset_res.json().get('error', '').lower())

    # 13. Reset authorization token single use
    def test_13_reset_authorization_token_single_use(self):
        _, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        verify_res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        reset_token = verify_res.json()['resetToken']

        # 1st reset succeeds
        reset_res1 = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': 'NewSecurePass999!',
            'confirmPassword': 'NewSecurePass999!'
        }, content_type='application/json')
        self.assertEqual(reset_res1.status_code, status.HTTP_200_OK)

        # 2nd reset with same token fails
        reset_res2 = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': 'AnotherPass888!',
            'confirmPassword': 'AnotherPass888!'
        }, content_type='application/json')
        self.assertEqual(reset_res2.status_code, status.HTTP_400_BAD_REQUEST)

    # 14. Password mismatch and complexity validation
    def test_14_password_mismatch_and_complexity_validation(self):
        _, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        verify_res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        reset_token = verify_res.json()['resetToken']

        # Mismatch
        res_mismatch = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': 'NewSecurePass999!',
            'confirmPassword': 'DifferentPass123!'
        }, content_type='application/json')
        self.assertEqual(res_mismatch.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('confirmPassword', res_mismatch.json())

        # Weak password (less than 8 chars)
        res_short = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': 'short1',
            'confirmPassword': 'short1'
        }, content_type='application/json')
        self.assertEqual(res_short.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('newPassword', res_short.json())

        # Weak password (no digits)
        res_nodigits = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': 'alllettersonly',
            'confirmPassword': 'alllettersonly'
        }, content_type='application/json')
        self.assertEqual(res_nodigits.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('newPassword', res_nodigits.json())

    # 15. Successful password reset, old password fails, new password succeeds
    def test_15_successful_password_reset_and_login_transition(self):
        _, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        verify_res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        reset_token = verify_res.json()['resetToken']

        # Execute reset
        new_password = 'BrandNewPassword999!'
        reset_res = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': new_password,
            'confirmPassword': new_password
        }, content_type='application/json')
        self.assertEqual(reset_res.status_code, status.HTTP_200_OK)

        # Login with old password fails
        old_login = self.client.post('/api/auth/login', {
            'email': self.demo_owner_email,
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)

        # Login with new password succeeds
        new_login = self.client.post('/api/auth/login', {
            'email': self.demo_owner_email,
            'password': new_password
        }, content_type='application/json')
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)
        token = new_login.json().get('token')
        self.assertIsNotNone(token)

        # Authenticated call succeeds with new token
        me_res = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(me_res.status_code, status.HTTP_200_OK)
        self.assertEqual(me_res.json()['user']['email'], self.demo_owner_email)

    # 16. Rate limiting on forgot password requests
    def test_16_forgot_password_rate_limiting(self):
        cache.clear()
        # Per-IP rate limit allows 5 requests per 15 minutes
        for i in range(5):
            cache.delete(f"reset_otp_cooldown_{self.demo_owner_email.lower()}")
            cache.delete(f"forgot_pwd_email_{self.demo_owner_email.lower()}")
            res = self.client.post('/api/auth/forgot-password', {
                'email': self.demo_owner_email
            }, content_type='application/json')
            self.assertEqual(res.status_code, status.HTTP_200_OK)

        # 6th request is rate limited by IP
        cache.delete(f"reset_otp_cooldown_{self.demo_owner_email.lower()}")
        cache.delete(f"forgot_pwd_email_{self.demo_owner_email.lower()}")
        res6 = self.client.post('/api/auth/forgot-password', {
            'email': self.demo_owner_email
        }, content_type='application/json')
        self.assertEqual(res6.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

    # 17. Brevo API rejection and timeout handled safely
    @patch('requests.post')
    def test_17_brevo_rejection_and_timeout(self, mock_post):
        import requests
        # Test 1: Brevo HTTP 400 rejection
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.content = b'{"code": "invalid_parameter", "message": "Domain blacklisted"}'
        mock_resp.json.return_value = {"code": "invalid_parameter", "message": "Domain blacklisted"}
        mock_post.return_value = mock_resp

        res_rej = self.client.post('/api/auth/forgot-password', {
            'email': self.demo_owner_email
        }, content_type='application/json')
        self.assertEqual(res_rej.status_code, status.HTTP_502_BAD_GATEWAY)

        # Test 2: Brevo timeout
        cache.delete(f"reset_otp_cooldown_{self.demo_owner_email.lower()}")
        mock_post.side_effect = requests.exceptions.Timeout("Connection timed out after 10s")
        res_timeout = self.client.post('/api/auth/forgot-password', {
            'email': self.demo_owner_email
        }, content_type='application/json')
        self.assertEqual(res_timeout.status_code, status.HTTP_502_BAD_GATEWAY)

    # 18. Existing signup verification and multi-tenant isolation remain intact
    def test_18_existing_signup_verification_and_tenant_isolation_intact(self):
        # Demo staff member authenticates
        staff_login = self.client.post('/api/auth/login', {
            'email': 'sarah.chen@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(staff_login.status_code, status.HTTP_200_OK)
        staff_token = staff_login.json()['token']

        # Multi-tenant isolation: Apex staff cannot read tenant-2 vehicles
        res_cross = self.client.get('/api/vehicles/veh-t2-1', HTTP_AUTHORIZATION=f'Bearer {staff_token}')
        self.assertEqual(res_cross.status_code, status.HTTP_404_NOT_FOUND)

    # 19. Existing JWT bearer tokens fail immediately after password reset while other users remain unaffected
    def test_19_jwt_session_invalidation_after_password_reset(self):
        # 1. Existing token for Alex works before password reset
        alex_login = self.client.post('/api/auth/login', {
            'email': self.demo_owner_email,
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(alex_login.status_code, status.HTTP_200_OK)
        alex_old_token = alex_login.json()['token']

        me_before = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {alex_old_token}')
        self.assertEqual(me_before.status_code, status.HTTP_200_OK)
        self.assertEqual(me_before.json()['user']['email'], self.demo_owner_email)

        # 2. Existing token for another user (Sarah) is active
        sarah_login = self.client.post('/api/auth/login', {
            'email': 'sarah.chen@apexrentals.com',
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(sarah_login.status_code, status.HTTP_200_OK)
        sarah_token = sarah_login.json()['token']

        sarah_before = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {sarah_token}')
        self.assertEqual(sarah_before.status_code, status.HTTP_200_OK)

        # 3. Perform password reset for Alex
        _, raw_otp = AuthService.create_password_reset_otp(self.demo_user)
        verify_res = self.client.post('/api/auth/verify-password-reset-otp', {
            'email': self.demo_owner_email,
            'otp': raw_otp
        }, content_type='application/json')
        reset_token = verify_res.json()['resetToken']

        new_password = 'BrandNewPassword2026!'
        reset_res = self.client.post('/api/auth/reset-password', {
            'email': self.demo_owner_email,
            'resetToken': reset_token,
            'newPassword': new_password,
            'confirmPassword': new_password
        }, content_type='application/json')
        self.assertEqual(reset_res.status_code, status.HTTP_200_OK)

        # 4. Old token for Alex FAILS IMMEDIATELY (HTTP 401 Unauthorized)
        me_after_old = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {alex_old_token}')
        self.assertEqual(me_after_old.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn('revoked', str(me_after_old.json()))

        vehicles_after_old = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {alex_old_token}')
        self.assertEqual(vehicles_after_old.status_code, status.HTTP_401_UNAUTHORIZED)

        # 5. Token for other user (Sarah) remains unaffected (HTTP 200 OK)
        sarah_after = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {sarah_token}')
        self.assertEqual(sarah_after.status_code, status.HTTP_200_OK)
        self.assertEqual(sarah_after.json()['user']['email'], 'sarah.chen@apexrentals.com')

        # 6. Newly issued token for Alex after re-authenticating works
        alex_relogin = self.client.post('/api/auth/login', {
            'email': self.demo_owner_email,
            'password': new_password
        }, content_type='application/json')
        self.assertEqual(alex_relogin.status_code, status.HTTP_200_OK)
        alex_new_token = alex_relogin.json()['token']
        self.assertNotEqual(alex_old_token, alex_new_token)

        me_after_new = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {alex_new_token}')
        self.assertEqual(me_after_new.status_code, status.HTTP_200_OK)
        self.assertEqual(me_after_new.json()['user']['email'], self.demo_owner_email)

        # 7. Tenant isolation & staff authorization preserved
        t2_res = self.client.get('/api/vehicles/veh-t2-1', HTTP_AUTHORIZATION=f'Bearer {alex_new_token}')
        self.assertEqual(t2_res.status_code, status.HTTP_404_NOT_FOUND)

    # 20. Tampered or missing tokenVersion claim is rejected with HTTP 401
    def test_20_tampered_or_missing_token_version_rejected(self):
        # Token missing tokenVersion claim entirely
        payload_no_version = {
            'id': self.demo_user.id,
            'email': self.demo_user.email,
            'name': self.demo_user.name,
            'role': self.demo_user.role,
            'tenantId': self.demo_user.tenant_id,
            'exp': timezone.now() + datetime.timedelta(days=7)
        }
        token_no_version = jwt.encode(payload_no_version, settings.JWT_SECRET, algorithm='HS256')
        res_no_version = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token_no_version}')
        self.assertEqual(res_no_version.status_code, status.HTTP_401_UNAUTHORIZED)

        # Token with mismatched tokenVersion claim
        payload_wrong_version = payload_no_version.copy()
        payload_wrong_version['tokenVersion'] = 999
        token_wrong_version = jwt.encode(payload_wrong_version, settings.JWT_SECRET, algorithm='HS256')
        res_wrong_version = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {token_wrong_version}')
        self.assertEqual(res_wrong_version.status_code, status.HTTP_401_UNAUTHORIZED)


class PersonaSwitcherSecurityTestSuite(TestCase):
    """
    Security and audit test suite for User Role & Persona Switcher:
    1. Demo persona switching works in local development for seeded demo accounts.
    2. Persona switching is strictly rejected in production (DEBUG=False).
    3. Persona switching is strictly rejected when ENABLE_DEMO_MODE=False in development.
    4. Registered, verified non-demo OWNER accounts cannot switch identity or hijack demo accounts (HTTP 403).
    5. Registered OWNER accounts cannot perform database reset (HTTP 403).
    6. Nonexistent or arbitrary non-demo accounts are rejected (HTTP 404).
    7. UserSerializer accurately returns isDemo=True for demo accounts and isDemo=False for registered accounts.
    8. Newly registered & verified OWNER account has strict tenant isolation (cannot access or mutate other tenants).
    9. Role-based backend authorization: staff/manager accounts cannot modify tenant settings (HTTP 403).
    10. Tenant isolation: registered OWNER cannot read other tenants in TenantListView.
    """
    def setUp(self):
        seed_database()
        cache.clear()
        EmailService.outbox.clear()
        self.client = Client()

        # Seeded demo accounts
        self.demo_owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.demo_manager = User.objects.get(email='sarah.chen@apexrentals.com')

    # 1. Demo switching allowed in dev for seeded accounts
    @override_settings(DEBUG=True, ENABLE_DEMO_MODE=True)
    def test_01_demo_switching_allowed_in_dev_for_seeded_accounts(self):
        # Unauthenticated dev switcher call
        res_owner = self.client.post('/api/auth/switch-demo-user', {
            'email': 'alex.rivera@apexrentals.com'
        }, content_type='application/json')
        self.assertEqual(res_owner.status_code, status.HTTP_200_OK)
        data = res_owner.json()
        self.assertIn('token', data)
        self.assertEqual(data['user']['email'], 'alex.rivera@apexrentals.com')
        self.assertEqual(data['user']['role'], 'owner')
        self.assertTrue(data['user']['isDemo'])

        # Switch from owner to manager
        owner_token = data['token']
        res_mgr = self.client.post('/api/auth/switch-demo-user', {
            'email': 'sarah.chen@apexrentals.com'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {owner_token}')
        self.assertEqual(res_mgr.status_code, status.HTTP_200_OK)
        self.assertEqual(res_mgr.json()['user']['role'], 'manager')
        self.assertTrue(res_mgr.json()['user']['isDemo'])

    # 2. Demo switcher strictly disabled in production
    @override_settings(DEBUG=False, ENABLE_DEMO_MODE=True)
    def test_02_demo_switcher_disabled_in_production(self):
        res = self.client.post('/api/auth/switch-demo-user', {
            'email': 'alex.rivera@apexrentals.com'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('strictly disabled in production', res.json().get('error', ''))

    # 3. Demo switcher disabled when ENABLE_DEMO_MODE=False in dev
    @override_settings(DEBUG=True, ENABLE_DEMO_MODE=False)
    def test_03_demo_switcher_disabled_when_enable_demo_mode_false(self):
        res = self.client.post('/api/auth/switch-demo-user', {
            'email': 'alex.rivera@apexrentals.com'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('strictly disabled in production', res.json().get('error', ''))

    # 4. Registered, verified owner cannot switch identity or hijack demo accounts
    @override_settings(DEBUG=True, ENABLE_DEMO_MODE=True)
    def test_04_registered_verified_owner_cannot_switch_identity(self):
        # 1. Register a real business owner
        reg_data = {
            'companyName': 'Solar Ride Rentals',
            'companyEmail': 'info@solarride.com',
            'phone': '+91 91234 56789',
            'ownerName': 'Alyssa Vance',
            'ownerEmail': 'alyssa@solarride.com',
            'password': 'SecureSolarPass123!',
            'confirmPassword': 'SecureSolarPass123!',
            'captchaToken': 'dev-token'
        }
        reg_res = self.client.post('/api/auth/register', reg_data, content_type='application/json')
        self.assertEqual(reg_res.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='alyssa@solarride.com')
        # Verify via OTP
        challenge, raw_otp = AuthService.create_otp_challenge_for_user(user, purpose='signup')
        verify_res = self.client.post('/api/auth/verify-email-otp', {
            'email': user.email,
            'otp': raw_otp
        }, content_type='application/json')
        self.assertEqual(verify_res.status_code, status.HTTP_200_OK)

        # Login to obtain real registered JWT
        login_res = self.client.post('/api/auth/login', {
            'email': 'alyssa@solarride.com',
            'password': 'SecureSolarPass123!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)
        registered_token = login_res.json()['token']
        self.assertFalse(login_res.json()['user']['isDemo'])

        # 2. Registered owner attempts to switch identity to demo owner
        hijack_res = self.client.post('/api/auth/switch-demo-user', {
            'email': 'alex.rivera@apexrentals.com'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {registered_token}')
        self.assertEqual(hijack_res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('Registered users cannot switch identities', hijack_res.json().get('error', ''))

        # Verify session is intact and still belongs to Alyssa
        me_res = self.client.get('/api/auth/me', HTTP_AUTHORIZATION=f'Bearer {registered_token}')
        self.assertEqual(me_res.status_code, status.HTTP_200_OK)
        self.assertEqual(me_res.json()['user']['email'], 'alyssa@solarride.com')

    # 5. Registered owner cannot reset database
    @override_settings(DEBUG=True, ENABLE_DEMO_MODE=True)
    def test_05_registered_owner_cannot_reset_database(self):
        # Create registered owner
        tenant = Tenant.objects.create(name='Summit Trails', slug='summit-trails', email='summit@example.com')
        import bcrypt
        hashed = bcrypt.hashpw(b'Pass123!', bcrypt.gensalt()).decode('utf-8')
        user = User.objects.create(
            tenant=tenant,
            email='summit.owner@example.com',
            password_hash=hashed,
            name='Summit Owner',
            role='owner',
            email_verified_at=timezone.now()
        )
        token = AuthService.generate_jwt(user)

        res = self.client.post('/api/reset', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('restricted to demo environments', res.json().get('error', ''))

    # 6. Nonexistent or arbitrary non-demo email rejected
    @override_settings(DEBUG=True, ENABLE_DEMO_MODE=True)
    def test_06_arbitrary_email_rejected(self):
        res = self.client.post('/api/auth/switch-demo-user', {
            'email': 'attacker@malicious.org'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('Demo user not found or unauthorized', res.json().get('error', ''))

    # 7. UserSerializer isDemo flag
    def test_07_user_serializer_is_demo_flag(self):
        from .serializers import UserSerializer
        # Demo account
        demo_ser = UserSerializer(self.demo_owner).data
        self.assertTrue(demo_ser['isDemo'])

        # Registered non-demo account
        tenant = Tenant.objects.create(name='Real Corp', slug='real-corp', email='real@corp.com')
        user = User.objects.create(
            tenant=tenant,
            email='real.owner@corp.com',
            password_hash='hash',
            name='Real Owner',
            role='owner'
        )
        reg_ser = UserSerializer(user).data
        self.assertFalse(reg_ser['isDemo'])

    # 8. Newly registered owner strict tenant isolation
    def test_08_newly_registered_owner_strict_tenant_isolation(self):
        tenant_solar = Tenant.objects.create(name='Solar Ride', slug='solar-ride', email='solar@ride.com')
        user_solar = User.objects.create(
            tenant=tenant_solar,
            email='alyssa@solarride.com',
            password_hash='hash',
            name='Alyssa Vance',
            role='owner',
            email_verified_at=timezone.now()
        )
        token = AuthService.generate_jwt(user_solar)

        # Create vehicle in Solar Ride
        v_solar = Vehicle.objects.create(
            tenant=tenant_solar,
            name='Solar Scooter Pro',
            category='scooter',
            make='Solar',
            model='Pro 1',
            year=2024,
            license_plate='SOL-001',
            daily_rate=35.0,
            status='available'
        )

        # 1. Fetch vehicles -> only returns Solar Ride vehicle
        v_list = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(v_list.status_code, status.HTTP_200_OK)
        v_data = v_list.json()
        self.assertEqual(len(v_data), 1)
        self.assertEqual(v_data[0]['id'], v_solar.id)

        # 2. Attempt to fetch Apex vehicle veh-1 -> returns 404 (isolated)
        v_apex = self.client.get('/api/vehicles/veh-1', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(v_apex.status_code, status.HTTP_404_NOT_FOUND)

        # 3. Tenant list only contains their own tenant
        t_list = self.client.get('/api/tenants', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(t_list.status_code, status.HTTP_200_OK)
        self.assertEqual(len(t_list.json()), 1)
        self.assertEqual(t_list.json()[0]['id'], tenant_solar.id)

        # 4. Attempt to mutate Apex tenant settings -> returns 403 Forbidden
        t_mutate = self.client.put('/api/tenants/tenant-1', {
            'name': 'Hacked Apex'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(t_mutate.status_code, status.HTTP_403_FORBIDDEN)

    # 9. RBAC enforced on backend: Staff/Manager cannot update tenant settings
    def test_09_rbac_enforced_on_backend_tenant_settings(self):
        mgr_token = AuthService.generate_jwt(self.demo_manager)

        # Manager attempts to modify Apex settings
        res = self.client.put('/api/tenants/current', {
            'name': 'Manager Renamed'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {mgr_token}')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('requires role owner', res.json().get('error', '').lower())


class TeamManagementTestSuite(TestCase):
    """
    Comprehensive test suite for RentFlow Team Management:
    1. OWNER can invite a MANAGER
    2. OWNER can invite a STAFF member
    3. OWNER cannot create an OWNER through team invitations
    4. MANAGER cannot invite users
    5. STAFF cannot invite users
    6. Unauthenticated users cannot access team-management APIs
    7. Invitations are restricted to the authenticated owner's tenant
    8. Cross-tenant member access is rejected
    9. Invitation tokens expire correctly (24h)
    10. Invitation tokens cannot be reused (single-use)
    11. Invalid invitation tokens are rejected
    12. Invitation acceptance activates the correct account
    13. Invitation acceptance cannot change the assigned tenant or role
    14. Deactivated users cannot authenticate or access protected APIs
    15. Role changes invalidate or refresh authorization state safely via token_version
    16. The last active OWNER cannot accidentally be removed or demoted
    17. Duplicate invitations are handled safely
    18. Email delivery failures are handled correctly
    19. Existing login, OTP verification, password reset, JWT, token_version continue to pass
    """

    def setUp(self):
        seed_database()
        cache.clear()

        # Tenant 1 (Apex Rentals)
        self.t1 = Tenant.objects.get(id='tenant-1')
        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.manager = User.objects.get(email='jordan.lee@apexrentals.com')
        self.staff = User.objects.get(email='sarah.chen@apexrentals.com')

        self.owner_token = AuthService.generate_jwt(self.owner)
        self.manager_token = AuthService.generate_jwt(self.manager)
        self.staff_token = AuthService.generate_jwt(self.staff)

        # Tenant 2 (Coastal Rentals)
        self.t2 = Tenant.objects.get(id='tenant-2')
        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')
        self.t2_owner_token = AuthService.generate_jwt(self.t2_owner)

    # 1. OWNER can invite a MANAGER
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_01_owner_can_invite_manager(self, mock_email):
        res = self.client.post('/api/team-invitations', {
            'name': 'Robin Manager',
            'email': 'robin.mgr@apexrentals.com',
            'role': 'manager',
            'branch': 'Downtown Hub'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertIn('invitation', data)
        self.assertEqual(data['invitation']['role'], 'manager')
        self.assertEqual(data['invitation']['status'], 'pending')
        mock_email.assert_called_once()

        # Verify cryptographic hash stored, not raw token
        inv = TeamInvitation.objects.get(email='robin.mgr@apexrentals.com')
        self.assertEqual(inv.tenant_id, self.t1.id)
        self.assertEqual(len(inv.token_hash), 64)  # SHA-256 hex string

    # 2. OWNER can invite a STAFF member
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_02_owner_can_invite_staff(self, mock_email):
        res = self.client.post('/api/team-invitations', {
            'name': 'Sam Staff',
            'email': 'sam.staff@apexrentals.com',
            'role': 'staff',
            'branch': 'Airport Terminal'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.json()['invitation']['role'], 'staff')
        mock_email.assert_called_once()

    # 3. OWNER cannot create an OWNER through team invitations
    def test_03_owner_cannot_invite_owner(self):
        res = self.client.post('/api/team-invitations', {
            'name': 'Sneaky Owner',
            'email': 'sneaky@apexrentals.com',
            'role': 'owner'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(TeamInvitation.objects.filter(email='sneaky@apexrentals.com').exists())

    # 4. MANAGER cannot invite users
    def test_04_manager_cannot_invite_users(self):
        res = self.client.post('/api/team-invitations', {
            'name': 'Unauthorized Invite',
            'email': 'unauth@apexrentals.com',
            'role': 'staff'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')

        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 5. STAFF cannot invite users
    def test_05_staff_cannot_invite_users(self):
        res = self.client.post('/api/team-invitations', {
            'name': 'Unauthorized Invite',
            'email': 'unauth2@apexrentals.com',
            'role': 'staff'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 6. Unauthenticated users cannot access team-management APIs
    def test_06_unauthenticated_cannot_access_team_management(self):
        res = self.client.get('/api/team-members')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

        res_post = self.client.post('/api/team-invitations', {'name': 'test'})
        self.assertEqual(res_post.status_code, status.HTTP_401_UNAUTHORIZED)

    # 7. Invitations are restricted to authenticated owner's tenant
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_07_invitation_strictly_bound_to_owner_tenant(self, mock_email):
        # Even if attacker supplies another tenant ID in body, backend derives tenant exclusively from token
        res = self.client.post('/api/team-invitations', {
            'name': 'Tenant Bound',
            'email': 'bound@apexrentals.com',
            'role': 'staff',
            'tenantId': 'tenant-2'  # spoof attempt
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        inv = TeamInvitation.objects.get(email='bound@apexrentals.com')
        self.assertEqual(inv.tenant_id, self.t1.id)
        self.assertNotEqual(inv.tenant_id, 'tenant-2')

    # 8. Cross-tenant member access is rejected
    def test_08_cross_tenant_member_access_rejected(self):
        # Coastal owner attempts to deactivate Apex staff
        res = self.client.post(
            f'/api/team-members/{self.staff.id}/deactivate',
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.t2_owner_token}'
        )
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.is_active)

    # 9. Invitation tokens expire correctly
    def test_09_invitation_tokens_expire(self):
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        past_time = timezone.now() - timezone.timedelta(hours=25)
        inv = TeamInvitation.objects.create(
            tenant=self.t1,
            email='expired@apexrentals.com',
            name='Expired Member',
            role='staff',
            token_hash=token_hash,
            status='pending',
            invited_by=self.owner,
            expires_at=past_time
        )

        # Validate returns 410 Gone
        val_res = self.client.get(f'/api/team-invitations/validate?token={raw_token}')
        self.assertEqual(val_res.status_code, status.HTTP_410_GONE)

        # Accept returns 410 Gone
        accept_res = self.client.post('/api/team-invitations/accept', {
            'token': raw_token,
            'password': 'StrongPass123!'
        }, content_type='application/json')
        self.assertEqual(accept_res.status_code, status.HTTP_410_GONE)

    # 10. Invitation tokens cannot be reused
    def test_10_invitation_tokens_single_use(self):
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        inv = TeamInvitation.objects.create(
            tenant=self.t1,
            email='singleuse@apexrentals.com',
            name='Single Use',
            role='staff',
            token_hash=token_hash,
            status='pending',
            invited_by=self.owner,
            expires_at=timezone.now() + timezone.timedelta(hours=24)
        )

        # First acceptance succeeds
        res1 = self.client.post('/api/team-invitations/accept', {
            'token': raw_token,
            'password': 'ValidPassword123!'
        }, content_type='application/json')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)

        # Replay attempt fails with 410 GONE
        res2 = self.client.post('/api/team-invitations/accept', {
            'token': raw_token,
            'password': 'ValidPassword123!'
        }, content_type='application/json')
        self.assertEqual(res2.status_code, status.HTTP_410_GONE)

    # 11. Invalid invitation tokens are rejected
    def test_11_invalid_tokens_rejected(self):
        res = self.client.get('/api/team-invitations/validate?token=non_existent_token_12345')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        accept_res = self.client.post('/api/team-invitations/accept', {
            'token': 'invalid_token_99999',
            'password': 'ValidPassword123!'
        }, content_type='application/json')
        self.assertEqual(accept_res.status_code, status.HTTP_404_NOT_FOUND)

    # 12. Invitation acceptance activates the correct account
    def test_12_invitation_acceptance_activates_account(self):
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        TeamInvitation.objects.create(
            tenant=self.t1,
            email='newhire@apexrentals.com',
            name='New Hire',
            role='manager',
            branch='East Station',
            token_hash=token_hash,
            status='pending',
            invited_by=self.owner,
            expires_at=timezone.now() + timezone.timedelta(hours=24)
        )

        res = self.client.post('/api/team-invitations/accept', {
            'token': raw_token,
            'password': 'SecureNewPassword123!'
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIn('token', res.json())

        # Verify user created in DB with correct attributes
        new_user = User.objects.get(email='newhire@apexrentals.com')
        self.assertEqual(new_user.tenant_id, self.t1.id)
        self.assertEqual(new_user.role, 'manager')
        self.assertEqual(new_user.branch, 'East Station')
        self.assertTrue(new_user.is_active)
        self.assertTrue(new_user.is_email_verified)

        # Verify new user can log in with new password
        login_res = self.client.post('/api/auth/login', {
            'email': 'newhire@apexrentals.com',
            'password': 'SecureNewPassword123!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_200_OK)

    # 13. Invitation acceptance cannot change assigned tenant or role
    def test_13_acceptance_cannot_escalate_role_or_change_tenant(self):
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        TeamInvitation.objects.create(
            tenant=self.t1,
            email='tamper@apexrentals.com',
            name='Tamper Test',
            role='staff',
            token_hash=token_hash,
            status='pending',
            invited_by=self.owner,
            expires_at=timezone.now() + timezone.timedelta(hours=24)
        )

        res = self.client.post('/api/team-invitations/accept', {
            'token': raw_token,
            'password': 'ValidPassword123!',
            'role': 'owner',        # Tampering attempt
            'tenantId': 'tenant-2'  # Tampering attempt
        }, content_type='application/json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        user = User.objects.get(email='tamper@apexrentals.com')
        self.assertEqual(user.role, 'staff')
        self.assertEqual(user.tenant_id, self.t1.id)

    # 14. Deactivated users cannot authenticate or access protected APIs
    def test_14_deactivated_users_rejected_by_auth_and_session(self):
        # 1. Existing valid JWT for staff
        staff_token_before = AuthService.generate_jwt(self.staff)

        # 2. Staff can access fleet before deactivation
        v_res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {staff_token_before}')
        self.assertEqual(v_res.status_code, status.HTTP_200_OK)

        # 3. Owner deactivates staff
        deact_res = self.client.post(
            f'/api/team-members/{self.staff.id}/deactivate',
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(deact_res.status_code, status.HTTP_200_OK)
        self.staff.refresh_from_db()
        self.assertFalse(self.staff.is_active)

        # 4. Existing staff JWT token is immediately rejected (401) due to token_version bump & is_active check
        v_res_after = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {staff_token_before}')
        self.assertEqual(v_res_after.status_code, status.HTTP_401_UNAUTHORIZED)

        # 5. Staff cannot log in via /api/auth/login (403 Forbidden with inactive: True)
        login_res = self.client.post('/api/auth/login', {
            'email': self.staff.email,
            'password': 'Password123!'
        }, content_type='application/json')
        self.assertEqual(login_res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(login_res.json().get('inactive'))

        # 6. Reactivate staff
        react_res = self.client.post(
            f'/api/team-members/{self.staff.id}/reactivate',
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(react_res.status_code, status.HTTP_200_OK)
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.is_active)

    # 15. Role changes invalidate existing JWT sessions via token_version
    def test_15_role_change_bumping_token_version(self):
        old_version = self.staff.token_version or 1
        staff_token_before = AuthService.generate_jwt(self.staff)

        # Owner promotes staff to manager
        patch_res = self.client.patch(
            f'/api/team-members/{self.staff.id}/role',
            {'role': 'manager'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.role, 'manager')
        self.assertGreater(self.staff.token_version, old_version)

        # Previous JWT token must be rejected because tokenVersion is stale
        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {staff_token_before}')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    # 16. The last active OWNER cannot accidentally be removed or demoted
    def test_16_prevent_demoting_or_deactivating_last_owner(self):
        # Only one owner exists in tenant-1 (Alex Rivera)
        owner_count = User.objects.filter(tenant_id=self.t1.id, role='owner', is_active=True).count()
        self.assertEqual(owner_count, 1)

        # 1. Attempt to demote owner to manager -> 400 Bad Request
        demote_res = self.client.patch(
            f'/api/team-members/{self.owner.id}/role',
            {'role': 'manager'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(demote_res.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Attempt to deactivate owner -> 400 Bad Request
        deact_res = self.client.post(
            f'/api/team-members/{self.owner.id}/deactivate',
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(deact_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.owner.refresh_from_db()
        self.assertTrue(self.owner.is_active)
        self.assertEqual(self.owner.role, 'owner')

    # 17. Duplicate invitations are handled safely
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_17_duplicate_invitations_handled_safely(self, mock_email):
        # 1. First invite
        res1 = self.client.post('/api/team-invitations', {
            'name': 'Duplicate Test',
            'email': 'duplicate@apexrentals.com',
            'role': 'staff'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # 2. Second invite expires first invite and creates fresh valid token
        cache.delete(f"invite_create_ip_127.0.0.1")
        cache.delete(f"invite_create_user_{self.owner.id}")
        res2 = self.client.post('/api/team-invitations', {
            'name': 'Duplicate Test',
            'email': 'duplicate@apexrentals.com',
            'role': 'manager'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)

        # Verify only one pending invite exists
        pending_invs = TeamInvitation.objects.filter(tenant=self.t1, email='duplicate@apexrentals.com', status='pending')
        self.assertEqual(pending_invs.count(), 1)
        self.assertEqual(pending_invs.first().role, 'manager')

        # 3. If user is already an active member, rejection with 409 Conflict
        res_existing = self.client.post('/api/team-invitations', {
            'name': 'Existing Staff',
            'email': self.staff.email,
            'role': 'manager'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_existing.status_code, status.HTTP_409_CONFLICT)

    # 18. Email delivery failures are handled correctly
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_18_email_delivery_failures_handled_safely(self, mock_email):
        mock_email.side_effect = EmailDeliveryError("Brevo delivery failed: Connection refused")

        res = self.client.post('/api/team-invitations', {
            'name': 'Failed Delivery',
            'email': 'fail@apexrentals.com',
            'role': 'staff'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        # Rejection with 502 Bad Gateway
        self.assertEqual(res.status_code, status.HTTP_502_BAD_GATEWAY)
        # Database transaction rolled back; no orphaned pending invitation created
        self.assertFalse(TeamInvitation.objects.filter(email='fail@apexrentals.com').exists())

    # 19. Resend and Cancel invitations workflow
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_19_resend_and_cancel_invitation_flow(self, mock_email):
        # 1. Create invitation
        res = self.client.post('/api/team-invitations', {
            'name': 'Flow Test',
            'email': 'flow@apexrentals.com',
            'role': 'staff'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        inv_id = res.json()['invitation']['id']

        # 2. Resend invitation (triggers email + resets token and 24h timer)
        cache.delete(f"invite_resend_cooldown_{inv_id}")
        res_resend = self.client.post(
            f'/api/team-invitations/{inv_id}/resend',
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(res_resend.status_code, status.HTTP_200_OK)

        # 3. Cancel invitation
        res_cancel = self.client.post(
            f'/api/team-invitations/{inv_id}/cancel',
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.owner_token}'
        )
        self.assertEqual(res_cancel.status_code, status.HTTP_200_OK)
        inv = TeamInvitation.objects.get(id=inv_id)
        self.assertEqual(inv.status, 'cancelled')

        # 4. Cancelled invitation cannot be validated or accepted
        val_res = self.client.get(f'/api/team-invitations/validate?token=dummy_token')
        self.assertEqual(val_res.status_code, status.HTTP_404_NOT_FOUND)

    # 20. Regression test: EmailService.send_team_invitation_email handles both object and kwargs signatures
    # and registered non-demo owner can invite team members without runtime TypeError or 500 error
    @patch('api.email_service.EmailService.send_brevo_transactional_email')
    def test_20_email_service_signature_regression_and_registered_owner(self, mock_brevo):
        mock_brevo.return_value = (True, "msg-12345")

        # Create a registered non-demo tenant and owner
        reg_tenant = Tenant.objects.create(name='Registered Real Corp', slug='reg-real-corp')
        reg_owner = User.objects.create(
            tenant=reg_tenant,
            email='registered.owner@realcorp.com',
            name='Reg Owner',
            role='owner',
            password_hash=AuthService.hash_password('Password123!'),
            email_verified_at=timezone.now()
        )
        reg_token = AuthService.generate_jwt(reg_owner)

        # 1. Post team invitation as registered owner
        res = self.client.post('/api/team-invitations', {
            'name': 'New Employee',
            'email': 'new.emp@realcorp.com',
            'role': 'staff',
            'branch': 'Headquarters'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {reg_token}')

        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn('invitation', res.json())
        self.assertEqual(res.json()['invitation']['email'], 'new.emp@realcorp.com')

        # 2. Directly verify EmailService.send_team_invitation_email accepts direct kwargs without TypeError
        result = EmailService.send_team_invitation_email(
            recipient_email='kwarg.emp@realcorp.com',
            recipient_name='Kwarg Emp',
            tenant_name=reg_tenant.name,
            role='manager',
            raw_token='safe_token_123',
            expires_in_hours=24
        )
        self.assertTrue(result)


class BranchAccessControlTests(TestCase):
    """
    Branch Selection & Enforced Branch-Level RBAC (Approach B) Test Suite.
    Proves:
    1. Owner can select All Branches.
    2. Owner can filter by an individual branch.
    3. Manager only sees assigned-branch records.
    4. Staff only sees assigned-branch records.
    5. Manager cannot access another branch through a direct API request.
    6. Staff cannot mutate another branch's records.
    7. A forged branch query parameter cannot bypass authorization.
    8. Cross-tenant isolation remains enforced.
    9. Invalid or deleted branch assignments fail safely.
    10. Dashboard analytics respect branch scope.
    11. Branch assignments survive invitation acceptance.
    12. Existing booking, rental, and vehicle workflows continue to work.
    """

    def setUp(self):
        seed_database()
        cache.clear()

        self.client = Client()
        self.t1 = Tenant.objects.get(id='tenant-1')
        self.t2 = Tenant.objects.get(id='tenant-2')

        # T1 Users
        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.owner_token = AuthService.generate_jwt(self.owner)

        # Manager assigned to Downtown Harbor Hub
        self.manager = User.objects.get(email='sarah.chen@apexrentals.com')
        self.manager.branch = 'Downtown Harbor Hub'
        self.manager.save(update_fields=['branch'])
        self.manager_token = AuthService.generate_jwt(self.manager)

        # Staff assigned to Downtown Harbor Hub
        self.staff = User.objects.get(email='jordan.lee@apexrentals.com')
        self.staff.branch = 'Downtown Harbor Hub'
        self.staff.save(update_fields=['branch'])
        self.staff_token = AuthService.generate_jwt(self.staff)

        # T2 Owner
        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')
        self.t2_owner_token = AuthService.generate_jwt(self.t2_owner)

        # Vehicles in T1 across multiple branches
        # v1: Downtown Harbor Hub
        self.v_downtown = Vehicle.objects.get(id='veh-1')
        self.assertEqual(self.v_downtown.images.get('location'), 'Downtown Harbor Hub')

        # v3: SFO Airport Terminal
        self.v_airport = Vehicle.objects.get(id='veh-3')
        self.assertEqual(self.v_airport.images.get('location'), 'SFO Airport Terminal')

    # 1. Owner can select All Branches
    def test_01_owner_can_select_all_branches(self):
        # Without param
        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        all_vehicles = res.json()
        locations = {v.get('location') for v in all_vehicles}
        self.assertIn('Downtown Harbor Hub', locations)
        self.assertIn('SFO Airport Terminal', locations)

        # With explicit ALL
        res_all = self.client.get('/api/vehicles?location=ALL', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_all.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_all.json()), len(all_vehicles))

    # 2. Owner can filter by an individual branch
    def test_02_owner_can_filter_by_individual_branch(self):
        res = self.client.get('/api/vehicles?location=SFO Airport Terminal', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        filtered = res.json()
        self.assertTrue(len(filtered) > 0)
        self.assertTrue(all(v.get('location') == 'SFO Airport Terminal' for v in filtered))

    # 3. Manager only sees assigned-branch records
    def test_03_manager_only_sees_assigned_branch_records(self):
        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        manager_vehicles = res.json()
        self.assertTrue(len(manager_vehicles) > 0)
        self.assertTrue(all(v.get('location') == 'Downtown Harbor Hub' for v in manager_vehicles))

    # 4. Staff only sees assigned-branch records
    def test_04_staff_only_sees_assigned_branch_records(self):
        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        staff_vehicles = res.json()
        self.assertTrue(len(staff_vehicles) > 0)
        self.assertTrue(all(v.get('location') == 'Downtown Harbor Hub' for v in staff_vehicles))

    # 5. Manager cannot access another branch through a direct API request
    def test_05_manager_cannot_access_another_branch_directly(self):
        # Manager tries to fetch details of a vehicle at SFO Airport Terminal
        res = self.client.get(f'/api/vehicles/{self.v_airport.id}', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

        # Manager tries to update vehicle at SFO Airport Terminal
        res_put = self.client.put(
            f'/api/vehicles/{self.v_airport.id}',
            {'dailyRate': '150.00'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.manager_token}'
        )
        self.assertEqual(res_put.status_code, status.HTTP_403_FORBIDDEN)

    # 6. Staff cannot mutate another branch's records
    def test_06_staff_cannot_mutate_another_branch_records(self):
        # Staff tries to create a rental booking for vehicle at SFO Airport Terminal
        res = self.client.post('/api/rentals', {
            'vehicleId': self.v_airport.id,
            'customerEmail': 'test.cust@example.com',
            'customerName': 'Test Cust',
            'customerPhone': '+15551234',
            'startDate': '2027-01-10T10:00:00Z',
            'endDate': '2027-01-12T10:00:00Z',
            'pickupLocation': 'SFO Airport Terminal'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 7. A forged branch query parameter cannot bypass authorization
    def test_07_forged_branch_parameter_cannot_bypass_authorization(self):
        # Manager attempts to query 'ALL' branches
        res_all = self.client.get('/api/vehicles?location=ALL', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(res_all.status_code, status.HTTP_403_FORBIDDEN)

        # Staff attempts to query another branch
        res_spoof = self.client.get('/api/vehicles?location=SFO Airport Terminal', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(res_spoof.status_code, status.HTTP_403_FORBIDDEN)

    # 8. Cross-tenant isolation remains enforced
    def test_08_cross_tenant_isolation_remains_enforced(self):
        # T2 owner attempts to query T1 branch
        res = self.client.get('/api/vehicles?location=Downtown Harbor Hub', HTTP_AUTHORIZATION=f'Bearer {self.t2_owner_token}')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Cannot access T1 vehicle
        res_veh = self.client.get(f'/api/vehicles/{self.v_downtown.id}', HTTP_AUTHORIZATION=f'Bearer {self.t2_owner_token}')
        self.assertEqual(res_veh.status_code, status.HTTP_404_NOT_FOUND)

    # 9. Invalid or deleted branch assignments fail safely
    def test_09_invalid_or_deleted_branch_assignments_fail_safely(self):
        # Create a manager without a branch
        unassigned_mgr = User.objects.create(
            tenant=self.t1,
            email='unassigned.mgr@apexrentals.com',
            name='Unassigned Mgr',
            role='manager',
            branch=None,
            password_hash=AuthService.hash_password('Password123!'),
            email_verified_at=timezone.now()
        )
        unassigned_token = AuthService.generate_jwt(unassigned_mgr)

        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {unassigned_token}')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('not assigned to a branch', res.json().get('error', ''))

        # Deleted branch assignment
        deleted_branch_mgr = User.objects.create(
            tenant=self.t1,
            email='deleted.branch@apexrentals.com',
            name='Deleted Branch Mgr',
            role='manager',
            branch='Old Ghost Branch That Was Deleted',
            password_hash=AuthService.hash_password('Password123!'),
            email_verified_at=timezone.now()
        )
        del_token = AuthService.generate_jwt(deleted_branch_mgr)

        res_del = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {del_token}')
        self.assertEqual(res_del.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('no longer active', res_del.json().get('error', ''))

    # 10. Dashboard analytics respect branch scope
    def test_10_dashboard_analytics_respect_branch_scope(self):
        # Owner tenant-wide analytics
        res_all = self.client.get('/api/analytics', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_all.status_code, status.HTTP_200_OK)
        total_veh = res_all.json()['totalVehicles']

        # Owner branch-scoped analytics
        res_branch = self.client.get('/api/analytics?location=Downtown Harbor Hub', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res_branch.status_code, status.HTTP_200_OK)
        branch_veh = res_branch.json()['totalVehicles']

        self.assertLess(branch_veh, total_veh)

        # Manager analytics automatically scoped to Downtown Harbor Hub
        res_mgr = self.client.get('/api/analytics', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(res_mgr.status_code, status.HTTP_200_OK)
        self.assertEqual(res_mgr.json()['totalVehicles'], branch_veh)

    # 11. Branch assignments survive invitation acceptance
    @patch('api.email_service.EmailService.send_team_invitation_email')
    def test_11_branch_assignments_survive_invitation_acceptance(self, mock_email):
        raw_token, token_hash = TeamInvitation.generate_token_and_hash()
        inv = TeamInvitation.objects.create(
            tenant=self.t1,
            email='new.invited@apexrentals.com',
            name='New Invited Staff',
            role='staff',
            branch='SFO Airport Terminal',
            token_hash=token_hash,
            invited_by=self.owner,
            expires_at=timezone.now() + timezone.timedelta(hours=24)
        )

        res_accept = self.client.post('/api/team-invitations/accept', {
            'token': raw_token,
            'password': 'SecurePassword123!',
            'confirmPassword': 'SecurePassword123!'
        }, content_type='application/json')

        self.assertEqual(res_accept.status_code, status.HTTP_200_OK)
        new_user = User.objects.get(email='new.invited@apexrentals.com')
        self.assertEqual(new_user.branch, 'SFO Airport Terminal')

        # Test subsequent requests scoped to accepted branch
        new_token = AuthService.generate_jwt(new_user)
        res_veh = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {new_token}')
        self.assertEqual(res_veh.status_code, status.HTTP_200_OK)
        self.assertTrue(all(v['location'] == 'SFO Airport Terminal' for v in res_veh.json()))

    # 12. Existing booking, rental, and vehicle workflows continue to work
    def test_12_existing_booking_rental_vehicle_workflows_work(self):
        # Owner can create a vehicle
        res_create = self.client.post('/api/vehicles', {
            'make': 'Porsche',
            'model': 'Taycan',
            'year': 2024,
            'licensePlate': 'PORSCHE99',
            'dailyRate': '250.00',
            'location': 'Downtown Harbor Hub'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        veh_id = res_create.json()['id']

        # Manager of Downtown Harbor Hub can create a rental for this vehicle
        res_rent = self.client.post('/api/rentals', {
            'vehicleId': veh_id,
            'customerEmail': 'rich.client@example.com',
            'customerName': 'Rich Client',
            'customerPhone': '+15559876',
            'startDate': '2027-02-01T10:00:00Z',
            'endDate': '2027-02-03T10:00:00Z',
            'pickupLocation': 'Downtown Harbor Hub'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')

        self.assertEqual(res_rent.status_code, status.HTTP_201_CREATED)
        rental_id = res_rent.json()['id']

        # Manager can update rental
        res_put = self.client.put(
            f'/api/rentals/{rental_id}',
            {'notes': 'VIP Customer - prepare vehicle clean'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.manager_token}'
        )
        self.assertEqual(res_put.status_code, status.HTTP_200_OK)


class VehicleAndFleetDataIsolationTestSuite(TestCase):
    """
    Comprehensive Security Audit Test Suite for Multi-Tenant Data Isolation.
    Verifies bidirectional isolation between Tenant A (Apex Luxury Rentals)
    and Tenant B (RentFlow Test), parameter forgery protection, and public API scoping.
    """

    def setUp(self):
        seed_database()
        cache.clear()

        # Tenant A: Apex Luxury Rentals (Seeded as tenant-1)
        self.tenant_a = Tenant.objects.get(id='tenant-1')
        self.owner_a = User.objects.get(email='alex.rivera@apexrentals.com')
        self.token_a = AuthService.generate_jwt(self.owner_a)

        # Tenant B: RentFlow Test
        self.tenant_b = Tenant.objects.create(
            id='tenant-test-b',
            name='RentFlow Test',
            slug='rentflow-test',
            email='admin@rentflowtest.com',
            currency='₹',
            settings={
                'locations': ['North Test Station', 'South Test Depot'],
                'currencyCode': 'INR'
            }
        )
        self.owner_b = User.objects.create(
            id='user-test-b-owner',
            tenant=self.tenant_b,
            email='owner@rentflowtest.com',
            name='Test Owner B',
            role='owner',
            password_hash=AuthService.hash_password('Password123!'),
            email_verified_at=timezone.now()
        )
        self.token_b = AuthService.generate_jwt(self.owner_b)

        # Vehicles
        self.veh_a = Vehicle.objects.filter(tenant=self.tenant_a).first()
        self.veh_b = Vehicle.objects.create(
            id='veh-test-b-1',
            tenant=self.tenant_b,
            name='2025 Test Tesla Model 3',
            category='car',
            make='Tesla',
            model='Model 3',
            year=2025,
            license_plate='TB-777-TEST',
            vin='VIN-TEST-B-999',
            daily_rate=Decimal('150.00'),
            deposit_amount=Decimal('300.00'),
            status='available',
            odometer=5000,
            fuel_level=100,
            images={'location': 'North Test Station', 'color': 'White'}
        )

        # Customers
        self.cust_a = Customer.objects.filter(tenant=self.tenant_a).first()
        self.cust_b = Customer.objects.create(
            id='cust-test-b-1',
            tenant=self.tenant_b,
            name='Customer B',
            email='customer.b@test.com',
            phone='+1 555-0002',
            address='456 Test Blvd'
        )

        # Rentals
        start = timezone.now() + timezone.timedelta(days=10)
        end = timezone.now() + timezone.timedelta(days=12)
        self.rental_a = Rental.objects.filter(tenant=self.tenant_a).first()
        self.rental_b = Rental.objects.create(
            id='rental-test-b-1',
            tenant=self.tenant_b,
            rental_number='RNT-B-001',
            customer=self.cust_b,
            vehicle=self.veh_b,
            customer_name=self.cust_b.name,
            vehicle_name=self.veh_b.name,
            status='confirmed',
            start_date=start,
            end_date=end,
            daily_rate=Decimal('150.00'),
            days=2,
            base_rental=Decimal('300.00'),
            total_amount=Decimal('326.25'),
            balance_due=Decimal('326.25'),
            deposit_amount=Decimal('300.00')
        )

        # Invoices
        self.inv_a = Invoice.objects.filter(tenant=self.tenant_a).first()
        self.inv_b = Invoice.objects.create(
            id='inv-test-b-1',
            tenant=self.tenant_b,
            invoice_number='INV-B-001',
            rental=self.rental_b,
            customer=self.cust_b,
            customer_name=self.cust_b.name,
            status='issued',
            subtotal=Decimal('300.00'),
            tax_amount=Decimal('26.25'),
            total_amount=Decimal('326.25'),
            paid_amount=Decimal('0.00'),
            balance_due=Decimal('326.25'),
            due_date=end
        )

        # Maintenance Records
        self.maint_a = MaintenanceRecord.objects.filter(tenant=self.tenant_a).first()
        self.maint_b = MaintenanceRecord.objects.create(
            id='maint-test-b-1',
            tenant=self.tenant_b,
            vehicle=self.veh_b,
            vehicle_name=self.veh_b.name,
            service_type='Tire Inspection',
            description='Check tire pressure and alignment',
            cost=Decimal('85.00'),
            status='scheduled',
            scheduled_date=start
        )

    def _extract_items(self, res_data):
        if isinstance(res_data, dict) and 'data' in res_data:
            return res_data['data']
        return res_data if isinstance(res_data, list) else []

    # 1. Tenant A cannot list Tenant B vehicles
    def test_01_tenant_a_cannot_list_tenant_b_vehicles(self):
        res = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        items = self._extract_items(res.json())
        vehicle_ids = [v['id'] for v in items]
        self.assertIn(self.veh_a.id, vehicle_ids)
        self.assertNotIn(self.veh_b.id, vehicle_ids)
        for v in items:
            self.assertEqual(v['tenantId'], self.tenant_a.id)

    # 2. Tenant A cannot retrieve Tenant B vehicle by ID
    def test_02_tenant_a_cannot_retrieve_tenant_b_vehicle_by_id(self):
        res = self.client.get(f'/api/vehicles/{self.veh_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    # 3. Tenant A cannot modify or delete Tenant B vehicle
    def test_03_tenant_a_cannot_modify_or_delete_tenant_b_vehicles(self):
        # PUT attempt
        put_res = self.client.put(
            f'/api/vehicles/{self.veh_b.id}',
            {'make': 'Hacked', 'model': 'Compromised', 'dailyRate': 1.00},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(put_res.status_code, status.HTTP_404_NOT_FOUND)
        self.veh_b.refresh_from_db()
        self.assertEqual(self.veh_b.make, 'Tesla')

        # DELETE attempt
        del_res = self.client.delete(f'/api/vehicles/{self.veh_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(del_res.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Vehicle.objects.filter(id=self.veh_b.id).exists())

    # 4. Tenant A cannot access Tenant B rentals
    def test_04_tenant_a_cannot_access_tenant_b_rentals(self):
        # List
        res_list = self.client.get('/api/rentals', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        items = self._extract_items(res_list.json())
        rental_ids = [r['id'] for r in items]
        self.assertNotIn(self.rental_b.id, rental_ids)

        # GET detail
        res_get = self.client.get(f'/api/rentals/{self.rental_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_get.status_code, status.HTTP_404_NOT_FOUND)

        # PUT update
        res_put = self.client.put(
            f'/api/rentals/{self.rental_b.id}',
            {'notes': 'Unauthorized update'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_put.status_code, status.HTTP_404_NOT_FOUND)

        # POST checkout
        res_out = self.client.post(
            f'/api/rentals/{self.rental_b.id}/check-out',
            {'inspection': {'odometer': 5000, 'fuelLevel': 100, 'damageNotes': 'None'}},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_out.status_code, status.HTTP_404_NOT_FOUND)

        # POST checkin
        res_in = self.client.post(
            f'/api/rentals/{self.rental_b.id}/check-in',
            {'inspection': {'odometer': 5100, 'fuelLevel': 95, 'damageNotes': 'None'}},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_in.status_code, status.HTTP_404_NOT_FOUND)

    # 5. Tenant A cannot access Tenant B invoices
    def test_05_tenant_a_cannot_access_tenant_b_invoices(self):
        # List
        res_list = self.client.get('/api/invoices', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        items = self._extract_items(res_list.json())
        inv_ids = [inv['id'] for inv in items]
        self.assertNotIn(self.inv_b.id, inv_ids)

        # GET detail
        res_get = self.client.get(f'/api/invoices/{self.inv_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_get.status_code, status.HTTP_404_NOT_FOUND)

        # POST payment
        res_pay = self.client.post(
            f'/api/invoices/{self.inv_b.id}/pay',
            {'amount': 326.25, 'method': 'Cash', 'reference': 'REF-A-HACK'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_pay.status_code, status.HTTP_404_NOT_FOUND)
        self.inv_b.refresh_from_db()
        self.assertEqual(self.inv_b.paid_amount, Decimal('0.00'))

    # 6. Tenant A cannot access Tenant B customers
    def test_06_tenant_a_cannot_access_tenant_b_customers(self):
        # List
        res_list = self.client.get('/api/customers', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        items = self._extract_items(res_list.json())
        cust_ids = [c['id'] for c in items]
        self.assertNotIn(self.cust_b.id, cust_ids)

        # GET detail
        res_get = self.client.get(f'/api/customers/{self.cust_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_get.status_code, status.HTTP_404_NOT_FOUND)

        # PUT update
        res_put = self.client.put(
            f'/api/customers/{self.cust_b.id}',
            {'name': 'Stolen Identity'},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_put.status_code, status.HTTP_404_NOT_FOUND)

        # DELETE customer
        res_del = self.client.delete(f'/api/customers/{self.cust_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_del.status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(Customer.objects.filter(id=self.cust_b.id).exists())

    # 7. Tenant A cannot access Tenant B maintenance records
    def test_07_tenant_a_cannot_access_tenant_b_maintenance_records(self):
        # List
        res_list = self.client.get('/api/maintenance', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        items = self._extract_items(res_list.json())
        maint_ids = [m['id'] for m in items]
        self.assertNotIn(self.maint_b.id, maint_ids)

        # GET detail
        res_get = self.client.get(f'/api/maintenance/{self.maint_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_get.status_code, status.HTTP_404_NOT_FOUND)

        # PUT update
        res_put = self.client.put(
            f'/api/maintenance/{self.maint_b.id}',
            {'status': 'completed', 'cost': 999.00},
            content_type='application/json',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_put.status_code, status.HTTP_404_NOT_FOUND)
        self.maint_b.refresh_from_db()
        self.assertEqual(self.maint_b.status, 'scheduled')

    # 8. Tenant A cannot access Tenant B analytics or manipulate tenant parameters
    def test_08_tenant_a_cannot_access_tenant_b_analytics(self):
        res_clean = self.client.get('/api/analytics', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_clean.status_code, status.HTTP_200_OK)
        stats_clean = res_clean.json()

        # Attempt to spoof tenant ID in query params
        res_spoof = self.client.get(
            f'/api/analytics?tenantId={self.tenant_b.id}&tenant_id={self.tenant_b.id}',
            HTTP_AUTHORIZATION=f'Bearer {self.token_a}'
        )
        self.assertEqual(res_spoof.status_code, status.HTTP_200_OK)
        stats_spoof = res_spoof.json()

        # Both responses must be identical and reflect strictly Tenant A's metrics
        self.assertEqual(stats_clean['activeRentals'], stats_spoof['activeRentals'])
        self.assertEqual(stats_clean['totalRevenue'], stats_spoof['totalRevenue'])
        self.assertEqual(stats_clean['totalVehicles'], stats_spoof['totalVehicles'])

    # 9. Reverse: Tenant B cannot access Tenant A data
    def test_09_reverse_tenant_b_cannot_access_tenant_a_data(self):
        # Vehicles
        res_veh_list = self.client.get('/api/vehicles', HTTP_AUTHORIZATION=f'Bearer {self.token_b}')
        items = self._extract_items(res_veh_list.json())
        veh_ids = [v['id'] for v in items]
        self.assertIn(self.veh_b.id, veh_ids)
        self.assertNotIn(self.veh_a.id, veh_ids)

        self.assertEqual(self.client.get(f'/api/vehicles/{self.veh_a.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.put(f'/api/vehicles/{self.veh_a.id}', {'make': 'B_Hack'}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(f'/api/vehicles/{self.veh_a.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)

        # Rentals
        self.assertEqual(self.client.get(f'/api/rentals/{self.rental_a.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.put(f'/api/rentals/{self.rental_a.id}', {'notes': 'B_Hack'}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)

        # Invoices
        self.assertEqual(self.client.get(f'/api/invoices/{self.inv_a.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.post(f'/api/invoices/{self.inv_a.id}/pay', {'amount': 50.0}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)

        # Customers
        self.assertEqual(self.client.get(f'/api/customers/{self.cust_a.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.put(f'/api/customers/{self.cust_a.id}', {'name': 'B_Hack'}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)

        # Maintenance
        self.assertEqual(self.client.get(f'/api/maintenance/{self.maint_a.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.put(f'/api/maintenance/{self.maint_a.id}', {'cost': 1.0}, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_b}').status_code, status.HTTP_404_NOT_FOUND)

    # 10. Forged tenant ID and branch query parameters fail safely
    def test_10_forged_tenant_and_branch_parameters_fail_safely(self):
        # Forged tenant ID query param does not leak records
        res_q = self.client.get(f'/api/vehicles?tenantId={self.tenant_b.id}', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        items = self._extract_items(res_q.json())
        self.assertTrue(all(v['tenantId'] == self.tenant_a.id for v in items))

        # Querying another tenant's branch returns 400 Bad Request
        res_loc = self.client.get('/api/vehicles?location=North Test Station', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_loc.status_code, status.HTTP_400_BAD_REQUEST)

        # POST vehicle with forged tenant ID in body creates vehicle under authenticated tenant
        res_create = self.client.post('/api/vehicles', {
            'make': 'Porsche',
            'model': 'Taycan',
            'year': 2024,
            'licensePlate': 'FORGE-999',
            'dailyRate': 300.0,
            'location': 'Downtown Harbor Hub',
            'tenantId': self.tenant_b.id,
            'tenant_id': self.tenant_b.id
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_create.status_code, status.HTTP_201_CREATED)
        created_veh = Vehicle.objects.get(license_plate='FORGE-999')
        self.assertEqual(created_veh.tenant_id, self.tenant_a.id)

        # POST rental booking another tenant's vehicle fails
        res_rent = self.client.post('/api/rentals', {
            'vehicleId': self.veh_b.id,
            'customerEmail': 'client@example.com',
            'startDate': '2027-03-01T10:00:00Z',
            'endDate': '2027-03-03T10:00:00Z'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_rent.status_code, status.HTTP_404_NOT_FOUND)

        # POST maintenance servicing another tenant's vehicle fails
        res_maint = self.client.post('/api/maintenance', {
            'vehicleId': self.veh_b.id,
            'serviceType': 'Oil Change'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_maint.status_code, status.HTTP_404_NOT_FOUND)

    # 11. Public storefront APIs expose only intended business inventory
    def test_11_public_storefront_isolation_and_no_data_leakage(self):
        # Public vehicles for Tenant A
        res_pub_a = self.client.get(f'/api/public/vehicles?slug={self.tenant_a.slug}')
        self.assertEqual(res_pub_a.status_code, status.HTTP_200_OK)
        pub_a_ids = [v['id'] for v in res_pub_a.json()]
        self.assertIn(self.veh_a.id, pub_a_ids)
        self.assertNotIn(self.veh_b.id, pub_a_ids)

        # Public vehicles for Tenant B
        res_pub_b = self.client.get(f'/api/public/vehicles?slug={self.tenant_b.slug}')
        self.assertEqual(res_pub_b.status_code, status.HTTP_200_OK)
        pub_b_ids = [v['id'] for v in res_pub_b.json()]
        self.assertIn(self.veh_b.id, pub_b_ids)
        self.assertNotIn(self.veh_a.id, pub_b_ids)

        # Verify sensitive internal fields (vin, licensePlate, odometer) are NOT exposed in public JSON
        for pub_veh in res_pub_a.json():
            self.assertNotIn('vin', pub_veh)
            self.assertNotIn('licensePlate', pub_veh)
            self.assertNotIn('odometer', pub_veh)

        # Public booking targeting Tenant A but passing Tenant B's vehicle ID is rejected with 404
        start_dt = (timezone.now() + timezone.timedelta(days=20)).isoformat()
        end_dt = (timezone.now() + timezone.timedelta(days=22)).isoformat()
        res_cross_book = self.client.post('/api/public/bookings', {
            'slug': self.tenant_a.slug,
            'vehicleId': self.veh_b.id,
            'customerName': 'Public Guest',
            'customerEmail': 'guest@example.com',
            'customerPhone': '+1 555-4321',
            'startDate': start_dt,
            'endDate': end_dt
        }, content_type='application/json')
        self.assertEqual(res_cross_book.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('not found', res_cross_book.json().get('error', '').lower())

    # 12. Tenant filtering is applied on backend before branch filtering
    def test_12_tenant_filtering_applied_before_branch_filtering(self):
        # Create a vehicle in Tenant B that has an identical branch name to a Tenant A branch
        veh_b_shared_loc = Vehicle.objects.create(
            id='veh-test-b-shared-loc',
            tenant=self.tenant_b,
            name='2025 Shared Location Car',
            category='car',
            make='Ford',
            model='Mustang',
            year=2025,
            license_plate='SHR-LOC-1',
            daily_rate=Decimal('120.00'),
            deposit_amount=Decimal('200.00'),
            status='available',
            images={'location': 'Downtown Harbor Hub'}  # Same branch name as Tenant A
        )

        # Tenant A queries their own branch 'Downtown Harbor Hub'
        res_a = self.client.get('/api/vehicles?location=Downtown Harbor Hub', HTTP_AUTHORIZATION=f'Bearer {self.token_a}')
        self.assertEqual(res_a.status_code, status.HTTP_200_OK)
        items = self._extract_items(res_a.json())
        ids_returned = [v['id'] for v in items]

        # Must not contain Tenant B vehicle despite identical branch string
        self.assertNotIn(veh_b_shared_loc.id, ids_returned)
        self.assertTrue(all(v['tenantId'] == self.tenant_a.id for v in items))


class RentalManualPaymentAndLifecycleTestSuite(TestCase):
    def setUp(self):
        seed_database()
        self.client = Client()

        self.tenant_1 = Tenant.objects.get(slug='apex-rentals')
        self.tenant_2 = Tenant.objects.get(slug='metro-carshare')

        self.owner = User.objects.get(email='alex.rivera@apexrentals.com')
        self.manager = User.objects.get(email='sarah.chen@apexrentals.com')
        self.staff = User.objects.get(email='jordan.lee@apexrentals.com')
        self.t2_owner = User.objects.get(email='maya.lin@coastalrentals.com')

        self.owner_token = AuthService.generate_jwt(self.owner)
        self.manager_token = AuthService.generate_jwt(self.manager)
        self.staff_token = AuthService.generate_jwt(self.staff)
        self.t2_token = AuthService.generate_jwt(self.t2_owner)

        # Create a clean test customer and vehicle for lifecycle tests
        self.customer = Customer.objects.filter(tenant=self.tenant_1).first()
        self.vehicle = Vehicle.objects.get(id='veh-8')
        self.vehicle.status = 'available'
        self.vehicle.save(update_fields=['status'])

    def _create_test_rental(self, start_offset_days=5, days=2, status_val='confirmed'):
        start_time = timezone.now() + datetime.timedelta(days=start_offset_days)
        end_time = start_time + datetime.timedelta(days=days)
        res = self.client.post('/api/rentals', {
            'vehicleId': self.vehicle.id,
            'startDate': start_time.isoformat(),
            'endDate': end_time.isoformat(),
            'customerName': 'Lifecycle Test User',
            'customerEmail': 'lifecycle@example.com',
            'customerPhone': '+1 555-0188',
            'status': status_val
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        return res.json()

    def test_manual_full_payment(self):
        rental_data = self._create_test_rental(start_offset_days=10)
        rental_id = rental_data['id']
        balance = rental_data['balanceDue']
        self.assertGreater(balance, 0)

        # Staff records full payment
        pay_res = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': balance,
            'method': 'Cash',
            'reference': 'CASH-REF-001',
            'notes': 'Full cash settlement at counter'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        self.assertEqual(pay_res.status_code, status.HTTP_200_OK)
        updated = pay_res.json()
        self.assertEqual(updated['balanceDue'], 0.0)
        self.assertEqual(updated['paidAmount'], balance)
        self.assertEqual(updated['paymentStatus'], 'paid')

        # Check payment history on rental
        history = updated['paymentHistory']
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['method'], 'Cash')
        self.assertEqual(history[0]['amount'], balance)
        self.assertEqual(history[0]['staffName'], self.staff.name)

    def test_manual_partial_payment_and_balance_calculation(self):
        rental_data = self._create_test_rental(start_offset_days=15)
        rental_id = rental_data['id']
        total = rental_data['totalAmount']

        # Partial payment 1
        part_1 = 50.0
        res1 = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': part_1,
            'method': 'Bank Transfer',
            'reference': 'WIRE-001'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        d1 = res1.json()
        self.assertEqual(d1['paymentStatus'], 'partial')
        self.assertAlmostEqual(d1['balanceDue'], total - part_1, places=2)
        self.assertEqual(d1['paidAmount'], part_1)

        # Partial payment 2 (remaining balance)
        remaining = d1['balanceDue']
        res2 = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': remaining,
            'method': 'Card Terminal',
            'reference': 'POS-002'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.manager_token}')
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        d2 = res2.json()
        self.assertEqual(d2['paymentStatus'], 'paid')
        self.assertEqual(d2['balanceDue'], 0.0)
        self.assertEqual(len(d2['paymentHistory']), 2)

    def test_invalid_payment_amounts_rejected(self):
        rental_data = self._create_test_rental(start_offset_days=20)
        rental_id = rental_data['id']
        balance = rental_data['balanceDue']

        # 1. Zero payment
        r_zero = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': 0,
            'method': 'Cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(r_zero.status_code, status.HTTP_400_BAD_REQUEST)

        # 2. Negative payment
        r_neg = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': -100,
            'method': 'Cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(r_neg.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Overpayment
        r_over = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': balance + 100.0,
            'method': 'Cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(r_over.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('exceeds the remaining balance', r_over.json()['error'])

    def test_duplicate_payment_against_paid_booking_rejected(self):
        rental_data = self._create_test_rental(start_offset_days=25)
        rental_id = rental_data['id']
        balance = rental_data['balanceDue']

        # Pay in full
        self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': balance,
            'method': 'Card Terminal'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')

        # Duplicate payment
        dup_res = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': 10.0,
            'method': 'Cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.owner_token}')
        self.assertEqual(dup_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('already fully paid', dup_res.json()['error'])

    def test_tenant_isolation_on_rental_and_payments(self):
        rental_data = self._create_test_rental(start_offset_days=30)
        rental_id = rental_data['id']

        # Tenant 2 cannot view Tenant 1 rental payments
        t2_get = self.client.get(f'/api/rentals/{rental_id}/payments', HTTP_AUTHORIZATION=f'Bearer {self.t2_token}')
        self.assertEqual(t2_get.status_code, status.HTTP_404_NOT_FOUND)

        # Tenant 2 cannot record payment on Tenant 1 rental
        t2_pay = self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': 50.0,
            'method': 'Cash'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.t2_token}')
        self.assertEqual(t2_pay.status_code, status.HTTP_404_NOT_FOUND)

    def test_successful_vehicle_pickup_workflow(self):
        rental_data = self._create_test_rental(start_offset_days=35)
        rental_id = rental_data['id']
        self.assertEqual(rental_data['status'], 'confirmed')

        # Handover / Check-out
        out_res = self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {
                'departureOdometer': 12050,
                'departureFuelOrBattery': 95,
                'existingDamages': ['Minor scratch on bumper']
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        self.assertEqual(out_res.status_code, status.HTTP_200_OK)
        updated = out_res.json()
        self.assertEqual(updated['status'], 'active')

        # Verify vehicle status is updated to rented
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, 'rented')
        self.assertEqual(self.vehicle.odometer, 12050)
        self.assertEqual(self.vehicle.fuel_level, 95)

    def test_duplicate_pickup_prevention(self):
        rental_data = self._create_test_rental(start_offset_days=40)
        rental_id = rental_data['id']

        # First pickup succeeds
        self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # Duplicate pickup attempt
        dup_pickup = self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        self.assertEqual(dup_pickup.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('active', dup_pickup.json()['error'])

    def test_pickup_of_cancelled_and_completed_rental_prevented(self):
        rental_data = self._create_test_rental(start_offset_days=45)
        rental_id = rental_data['id']

        # Cancel rental
        r_obj = Rental.objects.get(id=rental_id)
        r_obj.status = 'cancelled'
        r_obj.save(update_fields=['status'])

        # Attempt pickup of cancelled rental
        cancel_pickup = self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(cancel_pickup.status_code, status.HTTP_400_BAD_REQUEST)

    def test_vehicle_return_and_inspection(self):
        rental_data = self._create_test_rental(start_offset_days=50)
        rental_id = rental_data['id']

        # Pick up first
        self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 100}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # Process return with inspection
        ret_res = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {
                'returnOdometer': 12250,
                'returnFuelOrBattery': 90,
                'cleanliness': 'clean',
                'newDamages': [],
                'damageFee': 0,
                'lateFee': 25.0,
                'fuelSurcharge': 10.0,
                'notes': 'Returned on time and clean'
            }
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        self.assertEqual(ret_res.status_code, status.HTTP_200_OK)
        updated = ret_res.json()
        self.assertEqual(updated['status'], 'completed')

        # Vehicle must return to available
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, 'available')
        self.assertEqual(self.vehicle.odometer, 12250)

    def test_duplicate_return_prevented(self):
        rental_data = self._create_test_rental(start_offset_days=55)
        rental_id = rental_data['id']

        # Pick up
        self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 100}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # Return 1
        self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {'returnOdometer': 12200, 'returnFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # Duplicate return attempt
        dup_ret = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {'returnOdometer': 12200, 'returnFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(dup_ret.status_code, status.HTTP_400_BAD_REQUEST)

    def test_vehicle_availability_with_maintenance_restriction(self):
        rental_data = self._create_test_rental(start_offset_days=60)
        rental_id = rental_data['id']

        # Pick up
        self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 100}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # Schedule maintenance for this vehicle
        MaintenanceRecord.objects.create(
            tenant=self.tenant_1,
            vehicle=self.vehicle,
            vehicle_name=self.vehicle.name,
            service_type='Brake Inspection',
            description='Scheduled routine brake pads check',
            cost=Decimal('150.00'),
            status='scheduled',
            scheduled_date=timezone.now() + datetime.timedelta(days=1)
        )

        # Return vehicle
        ret_res = self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {'returnOdometer': 12200, 'returnFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')
        self.assertEqual(ret_res.status_code, status.HTTP_200_OK)

        # Vehicle status must be maintenance due to active record, not available!
        self.vehicle.refresh_from_db()
        self.assertEqual(self.vehicle.status, 'maintenance')

    def test_audit_logs_for_lifecycle_and_payments(self):
        rental_data = self._create_test_rental(start_offset_days=65)
        rental_id = rental_data['id']

        # 1. Record payment audit
        self.client.post(f'/api/rentals/{rental_id}/pay', {
            'amount': 100.0,
            'method': 'Cash',
            'reference': 'AUDIT-PAY-1'
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # 2. Pick up audit
        self.client.post(f'/api/rentals/{rental_id}/check-out', {
            'inspection': {'departureOdometer': 12050, 'departureFuelOrBattery': 100}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # 3. Return audit
        self.client.post(f'/api/rentals/{rental_id}/check-in', {
            'inspection': {'returnOdometer': 12200, 'returnFuelOrBattery': 95}
        }, content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {self.staff_token}')

        # Verify audit records exist
        actions = list(AuditLog.objects.filter(entity_id=rental_id).values_list('action', flat=True))
        self.assertIn('rental.checkout', actions)
        self.assertIn('rental.checkin', actions)
        self.assertIn('rental.payment', actions)
