import logging
from decimal import Decimal
from django.utils import timezone
from django.db import transaction
from .models import Tenant, User, Vehicle
from .services import AuthService

logger = logging.getLogger(__name__)

# Predefined demo accounts that are strictly prohibited as production Owner accounts
RESERVED_DEMO_EMAILS = {
    'alex.rivera@apexrentals.com',
    'sarah.chen@apexrentals.com',
    'jordan.lee@apexrentals.com',
    'maya.lin@coastalrentals.com',
    'marcus.vance@metrocarshare.com',
}

# The approved baseline demo vehicles for public storefront listing
APPROVED_DEMO_VEHICLES = [
    {
        'id': 'veh-1',
        'name': '2024 Tesla Model 3 Long Range',
        'make': 'Tesla',
        'model': 'Model 3',
        'year': 2024,
        'category': 'car',
        'license_plate': '7XYZ890',
        'vin': '5YJ3E1EB8NF123456',
        'daily_rate': Decimal('95.00'),
        'deposit_amount': Decimal('350.00'),
        'status': 'available',
        'odometer': 12450,
        'fuel_level': 92,
        'features': ['Autopilot', 'Glass Roof', 'Supercharging', 'Navigation', 'Heated Seats'],
        'images': {
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
    },
    {
        'id': 'veh-2',
        'name': '2023 Ford Mustang GT Convertible',
        'make': 'Ford',
        'model': 'Mustang GT',
        'year': 2023,
        'category': 'car',
        'license_plate': 'MUST888',
        'vin': '1FA6P8CF9N5100000',
        'daily_rate': Decimal('120.00'),
        'deposit_amount': Decimal('500.00'),
        'status': 'available',
        'odometer': 18920,
        'fuel_level': 85,
        'features': ['V8 Engine', 'Convertible Top', 'Apple CarPlay', 'Leather Interior'],
        'images': {
            'type': 'car',
            'color': 'Race Red',
            'location': 'Downtown Harbor Hub',
            'hourlyRate': 25,
            'weeklyRate': 700,
            'transmission': 'Automatic',
            'seats': 4,
            'imageUrl': 'https://images.unsplash.com/photo-1584345604476-8ec5e12e42dd?auto=format&fit=crop&w=800&q=80'
        }
    },
    {
        'id': 'veh-3',
        'name': '2024 BMW 330i M Sport',
        'make': 'BMW',
        'model': '330i',
        'year': 2024,
        'category': 'car',
        'license_plate': 'BMW9021',
        'vin': 'WBA5R1C59NA888888',
        'daily_rate': Decimal('135.00'),
        'deposit_amount': Decimal('450.00'),
        'status': 'available',
        'odometer': 8340,
        'fuel_level': 100,
        'features': ['M Sport Package', 'Harman Kardon', 'Head-up Display', 'Parking Assistant'],
        'images': {
            'type': 'car',
            'color': 'Portimao Blue',
            'location': 'SFO Airport Terminal',
            'hourlyRate': 28,
            'weeklyRate': 780,
            'transmission': 'Automatic',
            'seats': 5,
            'imageUrl': 'https://images.unsplash.com/photo-1555215695-3004980ad54e?auto=format&fit=crop&w=800&q=80'
        }
    },
    {
        'id': 'veh-4',
        'name': '2023 Porsche 911 Carrera',
        'make': 'Porsche',
        'model': '911 Carrera',
        'year': 2023,
        'category': 'car',
        'license_plate': '911FAST',
        'vin': 'WP0AB2A99PS111111',
        'daily_rate': Decimal('220.00'),
        'deposit_amount': Decimal('1000.00'),
        'status': 'available',
        'odometer': 5120,
        'fuel_level': 90,
        'features': ['Sport Chrono', 'Sport Exhaust', 'PASM Suspension', 'Bose Surround'],
        'images': {
            'type': 'car',
            'color': 'Agate Grey',
            'location': 'Downtown Harbor Hub',
            'hourlyRate': 45,
            'weeklyRate': 1300,
            'transmission': 'Automatic',
            'seats': 4,
            'imageUrl': 'https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&w=800&q=80'
        }
    },
    {
        'id': 'veh-5',
        'name': '2024 Trek Allant+ 8S E-Bike',
        'make': 'Trek',
        'model': 'Allant+ 8S',
        'year': 2024,
        'category': 'ebike',
        'license_plate': 'EBK-001',
        'vin': 'TRK2024EBIKE001',
        'daily_rate': Decimal('45.00'),
        'deposit_amount': Decimal('100.00'),
        'status': 'available',
        'odometer': 1450,
        'fuel_level': 100,
        'features': ['Bosch Performance Speed', '625Wh Battery', 'Fenders & Rack', 'Hydraulic Disc Brakes'],
        'images': {
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
    },
    {
        'id': 'veh-6',
        'name': '2023 Ducati Scrambler Icon',
        'make': 'Ducati',
        'model': 'Scrambler Icon',
        'year': 2023,
        'category': 'motorcycle',
        'license_plate': 'DUC-777',
        'vin': 'ZDM13BKU0NB000000',
        'daily_rate': Decimal('85.00'),
        'deposit_amount': Decimal('400.00'),
        'status': 'available',
        'odometer': 6200,
        'fuel_level': 95,
        'features': ['803cc L-Twin', 'Cornering ABS', 'LED DRL', 'USB Socket'],
        'images': {
            'type': 'motorcycle',
            'color': '62 Yellow',
            'location': 'Downtown Harbor Hub',
            'hourlyRate': 20,
            'weeklyRate': 490,
            'transmission': 'Manual',
            'seats': 2,
            'imageUrl': 'https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=800&q=80'
        }
    },
    {
        'id': 'veh-7',
        'name': '2024 Vespa Primavera 150',
        'make': 'Vespa',
        'model': 'Primavera 150',
        'year': 2024,
        'category': 'scooter',
        'license_plate': 'VSP-150',
        'vin': 'ZAPM81200R0000000',
        'daily_rate': Decimal('40.00'),
        'deposit_amount': Decimal('150.00'),
        'status': 'available',
        'odometer': 2100,
        'fuel_level': 100,
        'features': ['i-get 150cc engine', 'ABS', 'Underseat Storage', 'Classic Chrome Details'],
        'images': {
            'type': 'scooter',
            'color': 'Innocenza White',
            'location': 'Marina Bay Outpost',
            'hourlyRate': 10,
            'weeklyRate': 220,
            'transmission': 'Automatic',
            'seats': 2,
            'imageUrl': 'https://images.unsplash.com/photo-1568772585407-9361f9bf3a87?auto=format&fit=crop&w=800&q=80'
        }
    },
    {
        'id': 'veh-8',
        'name': '2024 Chevrolet Corvette Stingray',
        'make': 'Chevrolet',
        'model': 'Corvette Stingray',
        'year': 2024,
        'category': 'car',
        'license_plate': 'VETTE24',
        'vin': '1G1YB2D49R5100000',
        'daily_rate': Decimal('185.00'),
        'deposit_amount': Decimal('800.00'),
        'status': 'available',
        'odometer': 4300,
        'fuel_level': 80,
        'features': ['6.2L LT2 V8', '8-speed Dual-Clutch', 'GT2 Bucket Seats', 'Performance Exhaust'],
        'images': {
            'type': 'car',
            'color': 'Torch Red',
            'location': 'Downtown Harbor Hub',
            'hourlyRate': 35,
            'weeklyRate': 1100,
            'transmission': 'Automatic',
            'seats': 2,
            'imageUrl': 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=800&q=80'
        }
    }
]


def validate_production_owner_inputs(email: str, password: str) -> str:
    """
    Validates the production owner email and password without printing secrets.
    Returns normalized clean email.
    """
    if not email or not email.strip():
        raise ValueError("Production Owner email cannot be empty.")

    clean_email = email.strip().lower()

    if clean_email in RESERVED_DEMO_EMAILS:
        raise ValueError(
            f"Security violation: '{clean_email}' is a reserved development demo email and is locked out in production. "
            "Please configure your own personal or organization email."
        )

    if not password:
        raise ValueError("Production Owner password is required.")

    # Never log or print the password content
    if password.strip() == 'Password123!':
        raise ValueError(
            "Security violation: 'Password123!' is a publicly known demo password and is strictly forbidden in production. "
            "Please choose a unique, strong password."
        )

    if len(password) < 8:
        raise ValueError("Production Owner password must be at least 8 characters in length.")

    return clean_email


def initialize_production_environment(
    owner_email: str,
    owner_password: str,
    owner_name: str = "Production Owner",
    tenant_id: str = "tenant-1",
    tenant_slug: str = "apex-rentals",
    tenant_name: str = "Apex Luxury Rentals"
) -> dict:
    """
    Safely and idempotently initializes the production database:
    1. Validates owner email & password (rejects demo emails & Password123!).
    2. Validates existing tenant or creates initial tenant-1 without overwriting existing settings.
    3. Prevents overwriting or resetting existing Owner accounts.
    4. Seeds only the 8 approved demo vehicles with status='available' without creating duplicates.
    5. Wraps the entire operation in a single atomic transaction.
    """
    clean_email = validate_production_owner_inputs(owner_email, owner_password)
    clean_name = owner_name.strip() if owner_name and owner_name.strip() else "Production Owner"

    result_summary = {
        'tenant_action': None,
        'tenant_id': None,
        'owner_action': None,
        'owner_email': clean_email,
        'vehicles_created': 0,
        'vehicles_retained': 0,
        'total_demo_vehicles': len(APPROVED_DEMO_VEHICLES)
    }

    with transaction.atomic():
        # ----------------------------------------------------
        # 1. TENANT VALIDATION / INITIALIZATION
        # ----------------------------------------------------
        existing_tenant = Tenant.objects.filter(id=tenant_id).first()
        if not existing_tenant:
            # Fallback search by slug
            existing_tenant = Tenant.objects.filter(slug=tenant_slug).first()

        if existing_tenant:
            # Validate tenant integrity; NEVER overwrite existing custom settings
            if existing_tenant.slug != tenant_slug:
                raise ValueError(
                    f"Tenant validation error: Existing tenant '{existing_tenant.id}' has slug '{existing_tenant.slug}', "
                    f"expected '{tenant_slug}'."
                )
            tenant = existing_tenant
            result_summary['tenant_action'] = 'validated_existing'
            result_summary['tenant_id'] = tenant.id
        else:
            tenant = Tenant.objects.create(
                id=tenant_id,
                name=tenant_name,
                slug=tenant_slug,
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
                    'locations': [
                        'Downtown Harbor Hub',
                        'SFO Airport Terminal',
                        'Marina Bay Outpost',
                        'Downtown Hub',
                        'Airport Terminal'
                    ],
                    'categories': ['car', 'motorcycle', 'ebike', 'scooter'],
                    'sequenceCounters': {'rental': 1000, 'invoice': 800}
                }
            )
            result_summary['tenant_action'] = 'created_new'
            result_summary['tenant_id'] = tenant.id

        # ----------------------------------------------------
        # 2. OWNER ACCOUNT VALIDATION / CREATION
        # ----------------------------------------------------
        existing_user = User.objects.filter(email__iexact=clean_email).first()
        if existing_user:
            # Strictly do not overwrite an existing Owner or alter their password
            raise ValueError(
                f"Production Owner account '{clean_email}' already exists (ID: {existing_user.id}). "
                "To preserve credentials and security, existing accounts will not be overwritten or have their passwords modified. "
                "If you need to change your password, please use the official password reset workflow."
            )

        # Create new verified Owner with fresh bcrypt salt
        hashed_password = AuthService.hash_password(owner_password)
        User.objects.create(
            tenant=tenant,
            email=clean_email,
            password_hash=hashed_password,
            name=clean_name,
            role='owner',
            is_active=True,
            email_verified_at=timezone.now()
        )
        result_summary['owner_action'] = 'created_and_verified'

        # ----------------------------------------------------
        # 3. APPROVED DEMO FLEET SEEDING (Idempotent)
        # ----------------------------------------------------
        created_count = 0
        retained_count = 0

        for v_data in APPROVED_DEMO_VEHICLES:
            v_id = v_data['id']
            existing_veh = Vehicle.objects.filter(id=v_id).first()
            if existing_veh:
                # Existing vehicle is preserved without overwriting modifications
                retained_count += 1
            else:
                Vehicle.objects.create(
                    id=v_id,
                    tenant=tenant,
                    name=v_data['name'],
                    make=v_data['make'],
                    model=v_data['model'],
                    year=v_data['year'],
                    category=v_data['category'],
                    license_plate=v_data['license_plate'],
                    vin=v_data['vin'],
                    daily_rate=v_data['daily_rate'],
                    deposit_amount=v_data['deposit_amount'],
                    status=v_data['status'],
                    odometer=v_data['odometer'],
                    fuel_level=v_data['fuel_level'],
                    features=v_data['features'],
                    images=v_data['images']
                )
                created_count += 1

        result_summary['vehicles_created'] = created_count
        result_summary['vehicles_retained'] = retained_count

    return result_summary
