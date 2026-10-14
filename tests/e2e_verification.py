import os
import urllib.request
import json
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

# Load environment configuration from root .env if present
ROOT_DIR = Path(__file__).resolve().parent.parent
env_file = ROOT_DIR / '.env'
if env_file.exists():
    load_dotenv(dotenv_path=env_file)

BASE_URL = os.environ.get('E2E_BASE_URL', 'http://localhost:3000/api')

def get_database_url():
    if os.environ.get('DATABASE_URL'):
        return os.environ['DATABASE_URL']
    pg_user = os.environ.get('PGUSER', 'postgres')
    pg_password = os.environ.get('PGPASSWORD', '')
    pg_host = os.environ.get('PGHOST', '127.0.0.1')
    pg_port = os.environ.get('PGPORT', '5432')
    pg_db = os.environ.get('PGDATABASE', 'rentflow')
    if pg_password:
        return f"postgresql://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_db}"
    return f"postgresql://{pg_user}@{pg_host}:{pg_port}/{pg_db}"

DB_URL = get_database_url()

def run_test():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    print("=== STARTING END-TO-END REACT -> DJANGO -> POSTGRESQL VERIFICATION ===")

    # 1. AUTHENTICATION & PERSONA SWITCHING
    print("\n--- 1. Testing Authentication ---")
    req = urllib.request.Request(
        f'{BASE_URL}/auth/switch-demo-user',
        data=json.dumps({'email': 'alex.rivera@apexrentals.com'}).encode(),
        headers={'Content-Type': 'application/json'}
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200, f"Expected 200, got {res.status}"
    auth_data = json.loads(res.read().decode())
    token = auth_data['token']
    user = auth_data['user']
    assert user['email'] == 'alex.rivera@apexrentals.com'
    print(f"  [PASS] Switch Demo User: {user['name']} ({user['email']})")

    headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

    req = urllib.request.Request(f'{BASE_URL}/auth/me', headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status == 200
    me_data = json.loads(res.read().decode())
    me_user = me_data.get('user', me_data)
    assert me_user['id'] == user['id']
    print(f"  [PASS] Auth Me: {me_user['name']}")

    req = urllib.request.Request(f'{BASE_URL}/auth/users', headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status == 200
    team_users = json.loads(res.read().decode())
    assert len(team_users) >= 1
    print(f"  [PASS] Auth Team Users count: {len(team_users)}")

    # 2. DASHBOARD / ANALYTICS
    print("\n--- 2. Testing Dashboard / Analytics ---")
    req = urllib.request.Request(f'{BASE_URL}/analytics', headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status == 200
    analytics = json.loads(res.read().decode())
    assert 'totalRevenue' in analytics
    assert 'fleetUtilizationRate' in analytics or 'utilizationRate' in analytics
    util = analytics.get('fleetUtilizationRate', analytics.get('utilizationRate'))
    print(f"  [PASS] Analytics loaded: Total Revenue=₹{analytics['totalRevenue']}, Fleet Utilization={util}%")

    import time
    test_suffix = str(int(time.time()))[-4:]

    # 3. VEHICLES (CREATE, READ, UPDATE, DB VERIFICATION)
    print("\n--- 3. Testing Vehicles ---")
    test_plate = f"E2E-{test_suffix}"
    veh_data = {
        'make': 'Porsche',
        'model': 'Taycan Turbo',
        'year': 2025,
        'licensePlate': test_plate,
        'vin': f'WP0AA2Y123456{test_suffix}',
        'dailyRate': 299.00,
        'depositAmount': 500.00,
        'odometer': 1500,
        'status': 'available',
        'category': 'luxury',
        'transmission': 'automatic',
        'seats': 4,
        'color': 'Gentian Blue',
        'location': 'Downtown Hub'
    }
    req = urllib.request.Request(f'{BASE_URL}/vehicles', data=json.dumps(veh_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status in (200, 201), f"Vehicle creation failed: {res.status}"
    created_veh = json.loads(res.read().decode())
    veh_id = created_veh['id']
    print(f"  [PASS] Created Vehicle via API: {veh_id} ({created_veh['name']})")

    # Verify directly in PostgreSQL
    cur.execute("SELECT id, make, model, license_plate, daily_rate FROM vehicles WHERE id = %s", (veh_id,))
    v_row = cur.fetchone()
    assert v_row is not None, "Vehicle not found in PostgreSQL!"
    assert v_row[3] == test_plate
    print(f"  [PASS] Verified Vehicle in PostgreSQL: {v_row[1]} {v_row[2]} ({v_row[3]})")

    # Update vehicle
    req = urllib.request.Request(
        f'{BASE_URL}/vehicles/{veh_id}',
        data=json.dumps({'odometer': 1600, 'color': 'Frozen Berry'}).encode(),
        headers=headers,
        method='PUT'
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200
    updated_veh = json.loads(res.read().decode())
    assert updated_veh['odometer'] == 1600
    print(f"  [PASS] Updated Vehicle via API: Odometer={updated_veh['odometer']}, Color={updated_veh['color']}")

    # 4. CUSTOMERS (CREATE, READ, UPDATE, DB VERIFICATION)
    print("\n--- 4. Testing Customers ---")
    test_email = f"driver.e2e.{test_suffix}@testflow.com"
    cust_data = {
        'name': 'E2E Test Driver',
        'email': test_email,
        'phone': '+1 555-4321',
        'address': '555 Silicon Way, San Francisco, CA',
        'notes': 'Verified test driver notes',
        'driverLicense': {
            'number': f'DL-TEST-{test_suffix}',
            'stateOrCountry': 'CA',
            'expiryDate': '2030-05-15'
        }
    }
    req = urllib.request.Request(f'{BASE_URL}/customers', data=json.dumps(cust_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status in (200, 201)
    created_cust = json.loads(res.read().decode())
    cust_id = created_cust['id']
    print(f"  [PASS] Created Customer via API: {cust_id} ({created_cust['name']})")

    cur.execute("SELECT id, name, email, driver_license FROM customers WHERE id = %s", (cust_id,))
    c_row = cur.fetchone()
    assert c_row is not None, "Customer not found in PostgreSQL!"
    assert c_row[1] == 'E2E Test Driver'
    assert c_row[3].get('notes') == 'Verified test driver notes'
    print(f"  [PASS] Verified Customer in PostgreSQL: {c_row[1]} ({c_row[2]})")

    # 5. PRICING & QUOTES
    print("\n--- 5. Testing Pricing & Quotes ---")
    quote_data = {
        'vehicleId': veh_id,
        'startDate': '2026-11-01',
        'endDate': '2026-11-05',
        'insurancePlan': 'premium',
        'gps': True,
        'childSeat': 0
    }
    req = urllib.request.Request(f'{BASE_URL}/quote', data=json.dumps(quote_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status == 200
    quote = json.loads(res.read().decode())
    assert quote['days'] == 4
    assert quote['totalAmount'] > 0
    print(f"  [PASS] Quote calculated: {quote['days']} days, Total=₹{quote['totalAmount']}, Deposit=₹{quote['deposit']}")

    # 6. RENTALS / BOOKINGS (CREATE & DB VERIFICATION)
    print("\n--- 6. Testing Rentals / Bookings ---")
    rental_data = {
        'customerId': cust_id,
        'vehicleId': veh_id,
        'startDate': '2026-11-01T10:00:00Z',
        'endDate': '2026-11-05T10:00:00Z',
        'dailyRate': quote['dailyRate'],
        'insuranceRate': quote['insuranceRate'],
        'insurancePlan': 'premium',
        'addons': quote['addons'],
        'securityDeposit': quote['deposit'],
        'notes': 'E2E Booking Verification'
    }
    req = urllib.request.Request(f'{BASE_URL}/rentals', data=json.dumps(rental_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status in (200, 201), f"Rental creation failed: {res.status}"
    created_rental = json.loads(res.read().decode())
    rental_id = created_rental['id']
    rental_number = created_rental['rentalNumber']
    print(f"  [PASS] Rental created: {rental_number} (ID: {rental_id}), Status: {created_rental['status']}")

    cur.execute("SELECT id, rental_number, status, total_amount FROM rentals WHERE id = %s", (rental_id,))
    r_row = cur.fetchone()
    assert r_row is not None, "Rental not found in PostgreSQL!"
    assert r_row[2] == 'confirmed'
    print(f"  [PASS] Verified Rental in PostgreSQL: {r_row[1]}, Status={r_row[2]}, Total=₹{r_row[3]}")

    # Check Invoice was automatically generated in PostgreSQL
    cur.execute("SELECT id, invoice_number, total_amount, balance_due, status FROM invoices WHERE rental_id = %s", (rental_id,))
    inv_row = cur.fetchone()
    assert inv_row is not None, "Invoice not found for rental in PostgreSQL!"
    inv_id = inv_row[0]
    inv_number = inv_row[1]
    inv_total = float(inv_row[2])
    print(f"  [PASS] Verified auto-generated Invoice in PostgreSQL: {inv_number}, Total=₹{inv_total}, Status={inv_row[4]}")

    # 7. PAYMENTS (RECORD PAYMENT & VERIFY STATUS IN DB)
    print("\n--- 7. Testing Payments ---")
    pay_data = {
        'amount': inv_total,
        'method': 'card',
        'reference': 'TX-VERIFY-9988'
    }
    req = urllib.request.Request(f'{BASE_URL}/invoices/{inv_id}/pay', data=json.dumps(pay_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status == 200
    paid_inv = json.loads(res.read().decode())
    assert paid_inv['status'] == 'paid'
    assert paid_inv['balanceDue'] == 0
    print(f"  [PASS] Payment recorded via API: Status={paid_inv['status']}, Balance Due=₹{paid_inv['balanceDue']}")

    cur.execute("SELECT status, paid_amount, balance_due, payments FROM invoices WHERE id = %s", (inv_id,))
    p_row = cur.fetchone()
    assert p_row[0] == 'paid'
    assert float(p_row[2]) == 0.0
    print(f"  [PASS] Verified Paid Invoice in PostgreSQL: Status={p_row[0]}, Paid=₹{p_row[1]}, Balance=₹{p_row[2]}")

    # 8. CHECKOUT & CHECK-IN
    print("\n--- 8. Testing Checkout & Check-In ---")
    # Check-out
    co_inspection = {
        'odometer': 1600,
        'fuelLevel': 100,
        'conditionNotes': 'Pristine condition upon checkout',
        'photos': [],
        'inspectorId': user['id']
    }
    req = urllib.request.Request(
        f'{BASE_URL}/rentals/{rental_id}/check-out',
        data=json.dumps({'inspection': co_inspection}).encode(),
        headers=headers
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200, f"Checkout failed: {res.status}"
    co_rental = json.loads(res.read().decode())
    assert co_rental['status'] == 'active'
    print(f"  [PASS] Rental Checked Out: Status={co_rental['status']}")

    cur.execute("SELECT rentals.status, vehicles.status FROM rentals JOIN vehicles ON rentals.vehicle_id = vehicles.id WHERE rentals.id = %s", (rental_id,))
    co_row = cur.fetchone()
    assert co_row[0] == 'active', f"Expected active, got {co_row[0]}"
    print(f"  [PASS] Verified Checkout in PostgreSQL: Rental Status={co_row[0]}, Vehicle Status={co_row[1]}")

    # Check-in
    ci_inspection = {
        'odometer': 1850,
        'fuelLevel': 100,
        'conditionNotes': 'Returned in great shape, no scratches',
        'photos': [],
        'inspectorId': user['id']
    }
    req = urllib.request.Request(
        f'{BASE_URL}/rentals/{rental_id}/check-in',
        data=json.dumps({'inspection': ci_inspection, 'returnDate': '2026-11-05T12:00:00Z'}).encode(),
        headers=headers
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200, f"Check-in failed: {res.status}"
    ci_rental = json.loads(res.read().decode())
    assert ci_rental['status'] == 'completed'
    print(f"  [PASS] Rental Checked In: Status={ci_rental['status']}")

    cur.execute("SELECT status FROM rentals WHERE id = %s", (rental_id,))
    ci_row = cur.fetchone()
    assert ci_row[0] == 'completed'
    print(f"  [PASS] Verified Check-in in PostgreSQL: Rental Status={ci_row[0]}")

    # 9. MAINTENANCE (SCHEDULE, UPDATE, COMPLETE & DB VERIFICATION)
    print("\n--- 9. Testing Maintenance ---")
    maint_data = {
        'vehicleId': veh_id,
        'type': 'routine',
        'description': '5,000-mile inspection and tire rotation',
        'scheduledDate': '2026-11-10',
        'estimatedCost': 150.00,
        'vendor': 'Apex Service Center',
        'status': 'scheduled'
    }
    req = urllib.request.Request(f'{BASE_URL}/maintenance', data=json.dumps(maint_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status in (200, 201), f"Maintenance creation failed: {res.status}"
    created_maint = json.loads(res.read().decode())
    maint_id = created_maint['id']
    print(f"  [PASS] Maintenance created: {maint_id}, Status={created_maint['status']}")

    cur.execute("SELECT id, service_type, status, cost FROM maintenance_records WHERE id = %s", (maint_id,))
    m_row = cur.fetchone()
    assert m_row is not None
    assert m_row[2] == 'scheduled'
    print(f"  [PASS] Verified Maintenance in PostgreSQL: Type={m_row[1]}, Status={m_row[2]}")

    # Update to completed
    req = urllib.request.Request(
        f'{BASE_URL}/maintenance/{maint_id}',
        data=json.dumps({'status': 'completed', 'actualCost': 145.00, 'completedDate': '2026-11-10'}).encode(),
        headers=headers,
        method='PUT'
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200
    updated_maint = json.loads(res.read().decode())
    assert updated_maint['status'] == 'completed'
    print(f"  [PASS] Completed Maintenance via API: Status={updated_maint['status']}")

    # 10. ENQUIRIES & CONVERSION
    print("\n--- 10. Testing Enquiries & Conversion ---")
    enq_data = {
        'customerName': 'Corporate Lead',
        'customerEmail': 'corporate@enterprise.com',
        'customerPhone': '+1 555-8888',
        'vehicleId': veh_id,
        'startDate': '2026-12-01',
        'endDate': '2026-12-05',
        'status': 'new',
        'source': 'website',
        'notes': 'Interested in corporate fleet rate'
    }
    req = urllib.request.Request(f'{BASE_URL}/enquiries', data=json.dumps(enq_data).encode(), headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status in (200, 201), f"Enquiry creation failed: {res.status}"
    created_enq = json.loads(res.read().decode())
    enq_id = created_enq['id']
    print(f"  [PASS] Enquiry created: {enq_id}, Customer={created_enq['customerName']}")

    cur.execute("SELECT id, customer_name, customer_email, status FROM enquiries WHERE id = %s", (enq_id,))
    e_row = cur.fetchone()
    assert e_row is not None
    assert e_row[3] == 'new'
    print(f"  [PASS] Verified Enquiry in PostgreSQL: {e_row[1]} ({e_row[2]}), Status={e_row[3]}")

    # Convert Enquiry
    req = urllib.request.Request(
        f'{BASE_URL}/enquiries/{enq_id}/convert',
        data=json.dumps({'rentalId': rental_id}).encode(),
        headers=headers
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200
    conv_data = json.loads(res.read().decode())
    assert conv_data['enquiry']['status'] == 'converted'
    print(f"  [PASS] Enquiry converted via API: Status={conv_data['enquiry']['status']}")

    cur.execute("SELECT status FROM enquiries WHERE id = %s", (enq_id,))
    conv_row = cur.fetchone()
    assert conv_row[0] == 'converted'
    print(f"  [PASS] Verified Converted Enquiry in PostgreSQL: Status={conv_row[0]}")

    # 11. AUDIT LOGS
    print("\n--- 11. Testing Audit Logs ---")
    req = urllib.request.Request(f'{BASE_URL}/audit-logs', headers=headers)
    res = urllib.request.urlopen(req)
    assert res.status == 200
    logs = json.loads(res.read().decode())
    assert len(logs) > 0
    print(f"  [PASS] Audit Logs fetched: {len(logs)} entries")

    cur.execute("SELECT action, entity_type, details FROM audit_logs WHERE tenant_id = 'tenant-1' ORDER BY created_at DESC LIMIT 5")
    recent_logs = cur.fetchall()
    print("  Recent Audit Logs in PostgreSQL:")
    for al in recent_logs:
        print(f"    - Action: {al[0]}, Entity: {al[1]}, Details: {al[2]}")

    # 12. PUBLIC STOREFRONT & PUBLIC BOOKING
    print("\n--- 12. Testing Public Storefront ---")
    req = urllib.request.Request(f'{BASE_URL}/public/business/apex-rentals')
    res = urllib.request.urlopen(req)
    assert res.status == 200
    pub_biz = json.loads(res.read().decode())
    print(f"  [PASS] Public Business fetched: {pub_biz['name']}, Slug={pub_biz['slug']}")

    req = urllib.request.Request(f'{BASE_URL}/public/vehicles?slug=apex-rentals')
    res = urllib.request.urlopen(req)
    assert res.status == 200
    pub_fleet = json.loads(res.read().decode())
    assert len(pub_fleet) > 0
    print(f"  [PASS] Public Fleet fetched: {len(pub_fleet)} vehicles available")

    # Public Quote
    pub_quote_data = {
        'slug': 'apex-rentals',
        'vehicleId': pub_fleet[0]['id'],
        'startDate': '2026-12-10',
        'endDate': '2026-12-14',
        'insurancePlan': 'basic',
        'gps': False,
        'childSeat': 1
    }
    req = urllib.request.Request(
        f'{BASE_URL}/public/quote',
        data=json.dumps(pub_quote_data).encode(),
        headers={'Content-Type': 'application/json'}
    )
    res = urllib.request.urlopen(req)
    assert res.status == 200
    pub_quote = json.loads(res.read().decode())
    print(f"  [PASS] Public Quote calculated: {pub_quote['days']} days, Total=₹{pub_quote['totalAmount']}")

    # Public Booking
    pub_booking_data = {
        'slug': 'apex-rentals',
        'vehicleId': pub_fleet[0]['id'],
        'customerName': 'Public Storefront Guest',
        'customerEmail': 'storefront.guest@example.com',
        'customerPhone': '+1 555-7777',
        'startDate': '2026-12-10T10:00:00Z',
        'endDate': '2026-12-14T10:00:00Z',
        'insurancePlan': 'basic',
        'notes': 'Booked from storefront'
    }
    req = urllib.request.Request(
        f'{BASE_URL}/public/bookings',
        data=json.dumps(pub_booking_data).encode(),
        headers={'Content-Type': 'application/json'}
    )
    res = urllib.request.urlopen(req)
    assert res.status in (200, 201), f"Public booking failed: {res.status}"
    pub_res = json.loads(res.read().decode())
    assert pub_res['success'] is True
    print(f"  [PASS] Public Booking created: {pub_res['bookingNumber']}, Rental ID: {pub_res['rentalId']}")

    cur.execute("SELECT id, rental_number, status, total_amount FROM rentals WHERE id = %s", (pub_res['rentalId'],))
    pub_db_rental = cur.fetchone()
    assert pub_db_rental is not None
    print(f"  [PASS] Verified Public Booking in PostgreSQL: Number={pub_db_rental[1]}, Status={pub_db_rental[2]}, Total=₹{pub_db_rental[3]}")

    print("\n=======================================================")
    print("ALL 12 WORKFLOWS VERIFIED THROUGH REACT/VITE -> DJANGO -> POSTGRESQL!")
    print("=======================================================")

if __name__ == '__main__':
    run_test()
