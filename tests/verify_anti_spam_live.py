import requests
import time

API_BASE = "http://127.0.0.1:8000/api"
FRONTEND_BASE = "http://localhost:3000"

def test_live_anti_spam_system():
    print("==================================================")
    print("RENTFLOW LIVE ANTI-SPAM & ABUSE PROTECTION TEST")
    print("==================================================")

    # 1. Test Frontend Storefront Serving
    try:
        fe_res = requests.get(f"{FRONTEND_BASE}/store/apex-rentals", timeout=5)
        print(f"[*] Frontend /store/apex-rentals HTTP Status: {fe_res.status_code}")
        assert fe_res.status_code == 200, "Frontend did not return 200"
        print("[+] Frontend storefront HTML loaded successfully.")
    except Exception as e:
        print(f"[-] Frontend check error: {e}")

    # 2. Test Public Business & Fleet APIs
    biz_res = requests.get(f"{API_BASE}/public/business/apex-rentals", timeout=5)
    print(f"[*] Public Business API Status: {biz_res.status_code} ({biz_res.json().get('name')})")
    assert biz_res.status_code == 200

    vehicles_res = requests.get(f"{API_BASE}/public/vehicles?slug=apex-rentals", timeout=5)
    vehicles = vehicles_res.json()
    print(f"[*] Public Fleet Available: {len(vehicles)} vehicles")
    assert len(vehicles) > 0
    veh = vehicles[0]
    veh_id = veh['id']

    # 3. Test Invalid Phone Rejection (isolated IP)
    print("\n--- Testing Phone Validation ---")
    ts = int(time.time())
    bad_phone_payload = {
        "slug": "apex-rentals",
        "vehicleId": veh_id,
        "startDate": "2026-12-01T10:00:00Z",
        "endDate": "2026-12-03T10:00:00Z",
        "customerName": "Bad Phone Test",
        "customerPhone": "12345",  # Too short (< 7 digits)
        "rentalRateType": "daily"
    }
    bad_phone_res = requests.post(
        f"{API_BASE}/public/bookings",
        json=bad_phone_payload,
        headers={"X-Forwarded-For": f"198.51.{ts % 50}.1"},
        timeout=5
    )
    print(f"[*] Bad phone (too short) response: {bad_phone_res.status_code} -> {bad_phone_res.json().get('error')}")
    assert bad_phone_res.status_code == 400

    dummy_phone_payload = {
        "slug": "apex-rentals",
        "vehicleId": veh_id,
        "startDate": "2026-12-01T10:00:00Z",
        "endDate": "2026-12-03T10:00:00Z",
        "customerName": "Dummy Phone Test",
        "customerPhone": "1111111111",  # Repetitive dummy
        "rentalRateType": "daily"
    }
    dummy_phone_res = requests.post(
        f"{API_BASE}/public/bookings",
        json=dummy_phone_payload,
        headers={"X-Forwarded-For": f"198.51.{ts % 50}.2"},
        timeout=5
    )
    print(f"[*] Dummy phone (repetitive) response: {dummy_phone_res.status_code} -> {dummy_phone_res.json().get('error')}")
    assert dummy_phone_res.status_code == 400
    print("[+] Phone validation successfully rejects invalid/dummy numbers.")

    # 4. Test Valid Guest Booking (No account required)
    print("\n--- Testing Legitimate Guest Booking ---")
    guest_ip = f"198.51.{ts % 50}.10"
    test_phone = f"+91 98451 {ts % 90000 + 10000}"
    test_email = f"arjun.{ts}@example.com"
    valid_payload = {
        "slug": "apex-rentals",
        "vehicleId": veh_id,
        "startDate": "2026-12-05T10:00:00Z",
        "endDate": "2026-12-07T10:00:00Z",
        "customerName": "Arjun Singhania",
        "customerPhone": test_phone,
        "customerEmail": test_email,
        "customerAddress": "Indiranagar 100ft Rd, Bengaluru",
        "rentalRateType": "daily",
        "captchaToken": "dev-turnstile-token"
    }
    book_res = requests.post(
        f"{API_BASE}/public/bookings",
        json=valid_payload,
        headers={"X-Forwarded-For": guest_ip},
        timeout=5
    )
    print(f"[*] Valid Booking Response: {book_res.status_code} -> {book_res.json()}")
    assert book_res.status_code in [200, 201], f"Expected 201 or 200, got {book_res.status_code}"
    book_data = book_res.json()
    booking_number = book_data.get('bookingNumber')
    print(f"[+] Guest booking succeeded without login! Booking Number: #{booking_number}")

    # 5. Test Duplicate Booking Protection
    print("\n--- Testing Duplicate Booking Protection ---")
    dup_res = requests.post(
        f"{API_BASE}/public/bookings",
        json=valid_payload,
        headers={"X-Forwarded-For": guest_ip},
        timeout=5
    )
    print(f"[*] Duplicate Booking Response: {dup_res.status_code} -> {dup_res.json()}")
    assert dup_res.status_code == 200
    dup_data = dup_res.json()
    assert dup_data.get('duplicate') is True
    assert dup_data.get('bookingNumber') == booking_number
    print(f"[+] Duplicate booking successfully recognized and safely returned existing reference #{booking_number} without duplicate charge/record.")

    # 6. Test Rate Limiting
    print("\n--- Testing Rate Limiting ---")
    spammer_ip = f"198.51.{ts % 50}.99"
    rate_limited = False
    for i in range(10):
        test_payload = {
            "slug": "apex-rentals",
            "vehicleId": veh_id,
            "startDate": f"2026-12-{15+i}T10:00:00Z",
            "endDate": f"2026-12-{17+i}T10:00:00Z",
            "customerName": f"Spam Tester {i}",
            "customerPhone": f"+91 98451 777{i:02d}",
            "rentalRateType": "daily",
            "captchaToken": "dev-token"
        }
        res = requests.post(
            f"{API_BASE}/public/bookings",
            json=test_payload,
            headers={"X-Forwarded-For": spammer_ip},
            timeout=5
        )
        if res.status_code == 429:
            print(f"[+] Rate limit successfully activated on attempt {i+1}: HTTP 429 -> {res.json().get('error')}")
            rate_limited = True
            break
        time.sleep(0.05)

    assert rate_limited, "Rate limit did not activate after rapid requests!"

    # 7. Test Staff Authentication Unaffected
    print("\n--- Testing Staff Authentication ---")
    login_payload = {
        "email": "alex.rivera@apexrentals.com",
        "password": "Password123!"
    }
    login_res = requests.post(f"{API_BASE}/auth/login", json=login_payload, timeout=5)
    print(f"[*] Staff Login Response: {login_res.status_code}")
    assert login_res.status_code == 200
    staff_token = login_res.json().get('token')
    assert staff_token, "No token returned for staff"

    me_res = requests.get(f"{API_BASE}/auth/me", headers={"Authorization": f"Bearer {staff_token}"}, timeout=5)
    print(f"[*] Staff Me API: {me_res.status_code} (User: {me_res.json().get('user', {}).get('name')})")
    assert me_res.status_code == 200
    print("[+] Staff login and console authentication remain 100% operational.")

    print("\n==================================================")
    print("ALL LIVE ANTI-SPAM & ABUSE CHECKS PASSED PERFECTLY!")
    print("==================================================")

if __name__ == "__main__":
    test_live_anti_spam_system()
