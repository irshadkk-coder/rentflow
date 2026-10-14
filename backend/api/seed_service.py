import json
import datetime
from decimal import Decimal
from django.utils import timezone
from django.db import connection, transaction
from .models import (
    Tenant, User, Vehicle, Customer, Rental, Invoice,
    MaintenanceRecord, Enquiry, AuditLog
)

DEFAULT_PASSWORD_HASH = '$2a$10$6Mldds0oJ3.wquRv.Qekp.PY/dg.2byB4JcS2ZPNRUoNzKzVRMaSO'


def seed_database():
    """Cascade truncates all tables and re-seeds baseline multi-tenant demo data."""
    from django.conf import settings
    import sys
    is_testing = getattr(settings, 'TESTING', False) or ('test' in sys.argv)
    if not getattr(settings, 'DEBUG', True) and not getattr(settings, 'ENABLE_DEMO_MODE', False) and not is_testing:
        raise RuntimeError("Operation aborted: seed_database() is strictly prohibited in production environments.")

    with connection.cursor() as cursor:
        cursor.execute("TRUNCATE audit_logs, enquiries, maintenance_records, invoices, rentals, customers, vehicles, users, tenants CASCADE;")

    with transaction.atomic():
        # 1. Tenants
        t1 = Tenant.objects.create(
            id='tenant-1',
            name='Apex Luxury Rentals',
            slug='apex-rentals',
            email='contact@apexrentals.com',
            phone='+1 555-0100',
            currency='₹',
            timezone='UTC',
            tax_rate=Decimal('0.0875'),
            settings={
                'tagline': 'Premium Exotic & Executive Vehicle Hire',
                'address': '742 Evergreen Terrace, Suite 100, San Francisco, CA 94107',
                'currencyCode': 'INR',
                'securityDepositDefault': 350,
                'lateFeePerHour': 35,
                'fuelPenaltyPerPercent': 3.0,
                'locations': ['Downtown Harbor Hub', 'SFO Airport Terminal', 'Marina Bay Outpost', 'Downtown Hub', 'Airport Terminal'],
                'categories': ['car', 'motorcycle', 'ebike', 'scooter'],
                'sequenceCounters': {'rental': 1045, 'invoice': 885}
            }
        )

        t2 = Tenant.objects.create(
            id='tenant-2',
            name='Metro City Car Share',
            slug='metro-carshare',
            email='hello@metrocarshare.com',
            phone='+1 555-0200',
            currency='₹',
            timezone='UTC',
            tax_rate=Decimal('0.0925'),
            settings={
                'tagline': 'Urban EV & Hybrid Carsharing Fleet',
                'address': '101 Market St, San Francisco, CA 94105',
                'currencyCode': 'INR',
                'securityDepositDefault': 150,
                'lateFeePerHour': 20,
                'fuelPenaltyPerPercent': 2.5,
                'locations': ['Downtown Hub', 'Metro Train Depot'],
                'categories': ['car', 'ebike'],
                'sequenceCounters': {'rental': 2005, 'invoice': 2205}
            }
        )

        # 2. Users (all seeded/demo accounts verified by default)
        now_ts = timezone.now()
        User.objects.create(
            id='user-apex-owner',
            tenant=t1,
            email='alex.rivera@apexrentals.com',
            password_hash=DEFAULT_PASSWORD_HASH,
            name='Alex Rivera',
            role='owner',
            email_verified_at=now_ts
        )
        User.objects.create(
            id='user-apex-manager',
            tenant=t1,
            email='sarah.chen@apexrentals.com',
            password_hash=DEFAULT_PASSWORD_HASH,
            name='Sarah Chen',
            role='manager',
            branch='Downtown Harbor Hub',
            email_verified_at=now_ts
        )
        User.objects.create(
            id='user-apex-staff',
            tenant=t1,
            email='jordan.lee@apexrentals.com',
            password_hash=DEFAULT_PASSWORD_HASH,
            name='Jordan Lee',
            role='staff',
            branch='Downtown Harbor Hub',
            email_verified_at=now_ts
        )
        User.objects.create(
            id='user-coastal-owner',
            tenant=t2,
            email='maya.lin@coastalrentals.com',
            password_hash=DEFAULT_PASSWORD_HASH,
            name='Maya Lin',
            role='owner',
            email_verified_at=now_ts
        )
        User.objects.create(
            id='user-coastal-staff',
            tenant=t2,
            email='marcus.vance@metrocarshare.com',
            password_hash=DEFAULT_PASSWORD_HASH,
            name='Marcus Vance',
            role='staff',
            branch='Downtown Hub',
            email_verified_at=now_ts
        )

        # 3. Vehicles
        v1 = Vehicle.objects.create(
            id='veh-1',
            tenant=t1,
            name='2024 Tesla Model 3 Long Range',
            make='Tesla',
            model='Model 3',
            year=2024,
            category='car',
            license_plate='7XYZ890',
            vin='5YJ3E1EB8NF123456',
            daily_rate=Decimal('95.00'),
            deposit_amount=Decimal('350.00'),
            status='available',
            odometer=12450,
            fuel_level=92,
            features=['Autopilot', 'Glass Roof', 'Supercharging', 'Navigation', 'Heated Seats'],
            images={
                'type': 'car',
                'color': 'Pearl White',
                'location': 'Downtown Harbor Hub',
                'hourlyRate': 18,
                'weeklyRate': 550,
                'batteryLevel': 92,
                'transmission': 'Electric',
                'seats': 5,
                'imageUrl': 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=800&q=80'
            }
        )

        v2 = Vehicle.objects.create(
            id='veh-2',
            tenant=t1,
            name='2023 Ford Mustang GT Convertible',
            make='Ford',
            model='Mustang GT',
            year=2023,
            category='car',
            license_plate='MUST888',
            vin='1FA6P8CF9N5100000',
            daily_rate=Decimal('120.00'),
            deposit_amount=Decimal('500.00'),
            status='available',
            odometer=18920,
            fuel_level=85,
            features=['V8 Engine', 'Convertible Top', 'Apple CarPlay', 'Leather Interior'],
            images={
                'type': 'car',
                'color': 'Race Red',
                'location': 'Downtown Harbor Hub',
                'hourlyRate': 25,
                'weeklyRate': 700,
                'transmission': 'Automatic',
                'seats': 4,
                'imageUrl': 'https://images.unsplash.com/photo-1584345604476-8ec5e12e42dd?auto=format&fit=crop&w=800&q=80'
            }
        )

        v3 = Vehicle.objects.create(
            id='veh-3',
            tenant=t1,
            name='2024 BMW 330i M Sport',
            make='BMW',
            model='330i',
            year=2024,
            category='car',
            license_plate='BMW9021',
            vin='WBA5R1C59NA888888',
            daily_rate=Decimal('135.00'),
            deposit_amount=Decimal('450.00'),
            status='available',
            odometer=8340,
            fuel_level=100,
            features=['M Sport Package', 'Harman Kardon', 'Head-up Display', 'Parking Assistant'],
            images={
                'type': 'car',
                'color': 'Portimao Blue',
                'location': 'SFO Airport Terminal',
                'hourlyRate': 28,
                'weeklyRate': 780,
                'transmission': 'Automatic',
                'seats': 5,
                'imageUrl': 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=800&q=80'
            }
        )

        v4 = Vehicle.objects.create(
            id='veh-4',
            tenant=t1,
            name='2023 Porsche 911 Carrera',
            make='Porsche',
            model='911 Carrera',
            year=2023,
            category='car',
            license_plate='911FAST',
            vin='WP0AB2A99PS111111',
            daily_rate=Decimal('220.00'),
            deposit_amount=Decimal('1000.00'),
            status='available',
            odometer=5120,
            fuel_level=90,
            features=['Sport Chrono', 'Sport Exhaust', 'PASM Suspension', 'Bose Surround'],
            images={
                'type': 'car',
                'color': 'Agate Grey',
                'location': 'Downtown Harbor Hub',
                'hourlyRate': 45,
                'weeklyRate': 1300,
                'transmission': 'Automatic',
                'seats': 4,
                'imageUrl': 'https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&w=800&q=80'
            }
        )

        v5 = Vehicle.objects.create(
            id='veh-5',
            tenant=t1,
            name='2024 Trek Allant+ 8S E-Bike',
            make='Trek',
            model='Allant+ 8S',
            year=2024,
            category='ebike',
            license_plate='EBK-001',
            vin='TRK2024EBIKE001',
            daily_rate=Decimal('45.00'),
            deposit_amount=Decimal('100.00'),
            status='available',
            odometer=1450,
            fuel_level=100,
            features=['Bosch Performance Speed', '625Wh Battery', 'Fenders & Rack', 'Hydraulic Disc Brakes'],
            images={
                'type': 'ebike',
                'color': 'Matte Charcoal',
                'location': 'Marina Bay Outpost',
                'hourlyRate': 12,
                'weeklyRate': 250,
                'batteryLevel': 100,
                'transmission': 'Electric',
                'seats': 1,
                'imageUrl': 'https://images.unsplash.com/photo-1571068316344-75bc76f77890?auto=format&fit=crop&w=800&q=80'
            }
        )

        v6 = Vehicle.objects.create(
            id='veh-6',
            tenant=t1,
            name='2023 Ducati Scrambler Icon',
            make='Ducati',
            model='Scrambler Icon',
            year=2023,
            category='motorcycle',
            license_plate='DUC-777',
            vin='ZDM13BKU0NB000000',
            daily_rate=Decimal('85.00'),
            deposit_amount=Decimal('400.00'),
            status='available',
            odometer=6200,
            fuel_level=95,
            features=['803cc L-Twin', 'Cornering ABS', 'LED DRL', 'USB Socket'],
            images={
                'type': 'motorcycle',
                'color': '62 Yellow',
                'location': 'Downtown Harbor Hub',
                'hourlyRate': 20,
                'weeklyRate': 490,
                'transmission': 'Manual',
                'seats': 2,
                'imageUrl': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80'
            }
        )

        v7 = Vehicle.objects.create(
            id='veh-7',
            tenant=t1,
            name='2024 Vespa Primavera 150',
            make='Vespa',
            model='Primavera 150',
            year=2024,
            category='scooter',
            license_plate='VSP-150',
            vin='ZAPM81200R0000000',
            daily_rate=Decimal('40.00'),
            deposit_amount=Decimal('150.00'),
            status='available',
            odometer=2100,
            fuel_level=100,
            features=['i-get 150cc engine', 'ABS', 'Underseat Storage', 'Classic Chrome Details'],
            images={
                'type': 'scooter',
                'color': 'Innocenza White',
                'location': 'Marina Bay Outpost',
                'hourlyRate': 10,
                'weeklyRate': 220,
                'transmission': 'Automatic',
                'seats': 2,
                'imageUrl': 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=800&q=80'
            }
        )

        v8 = Vehicle.objects.create(
            id='veh-8',
            tenant=t1,
            name='2024 Chevrolet Corvette Stingray',
            make='Chevrolet',
            model='Corvette Stingray',
            year=2024,
            category='car',
            license_plate='VETTE24',
            vin='1G1YB2D49R5100000',
            daily_rate=Decimal('185.00'),
            deposit_amount=Decimal('800.00'),
            status='available',
            odometer=4300,
            fuel_level=80,
            features=['6.2L LT2 V8', '8-speed Dual-Clutch', 'GT2 Bucket Seats', 'Performance Exhaust'],
            images={
                'type': 'car',
                'color': 'Torch Red',
                'location': 'Downtown Harbor Hub',
                'hourlyRate': 35,
                'weeklyRate': 1100,
                'transmission': 'Automatic',
                'seats': 2,
                'imageUrl': 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=800&q=80'
            }
        )

        # Tenant 2 Vehicle
        v_t2 = Vehicle.objects.create(
            id='veh-t2-1',
            tenant=t2,
            name='2024 Hyundai Ioniq 5',
            make='Hyundai',
            model='Ioniq 5',
            year=2024,
            category='car',
            license_plate='EV-MTR1',
            vin='KM8KRDA23PU000000',
            daily_rate=Decimal('75.00'),
            deposit_amount=Decimal('150.00'),
            status='available',
            odometer=15300,
            fuel_level=88,
            features=['Ultra-fast 800V charging', 'V2L function', 'Spacious cabin'],
            images={
                'type': 'car',
                'color': 'Digital Teal',
                'location': 'Downtown Hub',
                'hourlyRate': 14,
                'weeklyRate': 450,
                'batteryLevel': 88,
                'transmission': 'Electric',
                'seats': 5,
                'imageUrl': 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=800&q=80'
            }
        )

        # 4. Customers
        c1 = Customer.objects.create(
            id='cust-1',
            tenant=t1,
            name='Marcus Vance',
            email='marcus.vance@example.com',
            phone='+1 555-0101',
            address='123 Mission St, San Francisco, CA',
            driver_license={'number': 'CA-D1234567', 'stateOrCountry': 'California, US', 'expiryDate': '2027-08-15', 'verified': True},
            total_rentals=4,
            total_spent=Decimal('1850.00'),
            rating=Decimal('4.9'),
            status='active'
        )

        c2 = Customer.objects.create(
            id='cust-2',
            tenant=t1,
            name='Elena Rostova',
            email='elena.rostova@example.com',
            phone='+1 555-0102',
            address='456 Broadway, Oakland, CA',
            driver_license={'number': 'CA-D9876543', 'stateOrCountry': 'California, US', 'expiryDate': '2026-11-20', 'verified': True},
            total_rentals=2,
            total_spent=Decimal('780.00'),
            rating=Decimal('5.0'),
            status='active'
        )

        c3 = Customer.objects.create(
            id='cust-3',
            tenant=t1,
            name='David Kim',
            email='david.kim@example.com',
            phone='+1 555-0103',
            address='789 Silicon Ave, San Jose, CA',
            driver_license={'number': 'CA-D5566778', 'stateOrCountry': 'California, US', 'expiryDate': '2025-04-10', 'verified': True},
            total_rentals=1,
            total_spent=Decimal('340.00'),
            rating=Decimal('4.7'),
            status='active'
        )

        # 5. Sample Rentals & Invoices
        now = timezone.now()
        r1_start = now - datetime.timedelta(days=2)
        r1_end = now + datetime.timedelta(days=2)

        r1 = Rental.objects.create(
            id='rent-1',
            tenant=t1,
            rental_number='RF-2024-001041',
            customer=c1,
            vehicle=v1,
            customer_name=c1.name,
            vehicle_name='2024 Tesla Model 3 Long Range',
            status='active',
            start_date=r1_start,
            end_date=r1_end,
            daily_rate=Decimal('95.00'),
            days=4,
            base_rental=Decimal('380.00'),
            add_ons=[
                {'id': 'gps', 'name': 'GPS Navigation System', 'price': 40},
                {'__meta': {
                    'customerEmail': c1.email,
                    'customerPhone': c1.phone,
                    'vehicleType': 'car',
                    'vehiclePlate': v1.license_plate,
                    'vehicleImage': (v1.images or {}).get('imageUrl'),
                    'pickupLocation': 'Downtown Harbor Hub',
                    'dropoffLocation': 'Downtown Harbor Hub',
                    'rentalRateType': 'daily',
                    'insuranceOption': {'name': 'Standard Liability Included', 'dailyRate': 0, 'total': 0},
                    'depositStatus': 'held',
                    'paymentStatus': 'paid',
                    'paymentMethod': 'credit_card'
                }}
            ],
            total_add_ons=Decimal('40.00'),
            tax_rate=Decimal('0.0875'),
            tax_amount=Decimal('36.75'),
            deposit_amount=Decimal('350.00'),
            total_amount=Decimal('456.75'),
            balance_due=Decimal('0.00'),
            check_out_inspection={
                'departureOdometer': 12450,
                'departureFuelOrBattery': 92,
                'departureDate': r1_start.isoformat(),
                'existingDamages': [],
                'agentName': 'Sarah Chen'
            }
        )

        Invoice.objects.create(
            id='inv-1',
            tenant=t1,
            invoice_number='INV-2024-000881',
            rental=r1,
            customer=c1,
            customer_name=c1.name,
            status='paid',
            subtotal=Decimal('420.00'),
            tax_amount=Decimal('36.75'),
            total_amount=Decimal('456.75'),
            paid_amount=Decimal('456.75'),
            balance_due=Decimal('0.00'),
            payments=[
                {
                    '__items': [
                        {'id': 'item-1', 'description': 'Tesla Model 3 (4 days @ $95/day)', 'quantity': 4, 'unitPrice': 95, 'total': 380},
                        {'id': 'item-2', 'description': 'GPS Navigation System', 'quantity': 1, 'unitPrice': 40, 'total': 40}
                    ],
                    'customerEmail': c1.email
                },
                {
                    'id': 'pay-1',
                    'date': r1_start.isoformat(),
                    'amount': 456.75,
                    'method': 'Credit Card',
                    'reference': 'TRANS-INIT-001',
                    'notes': 'Paid in full on departure'
                }
            ],
            due_date=r1_end
        )

        # 6. Maintenance Record
        MaintenanceRecord.objects.create(
            id='maint-1',
            tenant=t1,
            vehicle=v2,
            vehicle_name='2023 Ford Mustang GT Convertible',
            service_type='Periodic Inspection & Brake Flush',
            description='18,000 mile scheduled service. Replaced brake fluid, checked pads and rotors.',
            cost=Decimal('285.00'),
            status='completed',
            scheduled_date=now - datetime.timedelta(days=10),
            completed_date=now - datetime.timedelta(days=9),
            odometer_at_service=18500,
            vendor='Bay Area Ford Performance',
            notes='All brakes within spec.'
        )

        # 7. Enquiry
        Enquiry.objects.create(
            id='enq-1',
            tenant=t1,
            customer_name='Sophia Ramirez',
            customer_email='sophia.ramirez@example.com',
            customer_phone='+1 555-0321',
            vehicle_category='car',
            preferred_vehicle=v3,
            preferred_vehicle_name='2024 BMW 330i M Sport',
            start_date=now + datetime.timedelta(days=5),
            end_date=now + datetime.timedelta(days=8),
            estimated_budget=Decimal('500.00'),
            status='new',
            source='website',
            notes='Looking for an executive car for an upcoming tech conference.'
        )

        # 8. Audit Log
        AuditLog.objects.create(
            id='audit-1',
            tenant=t1,
            user_id='user-apex-owner',
            user_name='Alex Rivera',
            user_role='owner',
            action='system.startup',
            entity_type='tenant',
            entity_id='tenant-1',
            details='Database initialized with production demo data.'
        )
