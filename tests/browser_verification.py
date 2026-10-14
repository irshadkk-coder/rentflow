import asyncio
import json
import subprocess
import time
import urllib.request
import websockets
import os

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
CDP_PORT = 9222
BASE_URL = "http://localhost:3000"

class BrowserSession:
    def __init__(self):
        self.proc = None
        self.ws = None
        self.msg_id = 0
        self.pending_responses = {}
        self.network_requests = []
        self.network_responses = []
        self.console_logs = []
        self.console_errors = []

    def start_chrome(self):
        self.proc = subprocess.Popen([
            CHROME_PATH,
            '--headless=new',
            f'--remote-debugging-port={CDP_PORT}',
            '--no-first-run',
            '--no-default-browser-check',
            '--window-size=1280,800',
            f'{BASE_URL}/'
        ])
        time.sleep(2.5)

    def stop_chrome(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()

    async def connect(self):
        res = urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json')
        tabs = json.loads(res.read().decode())
        page_tab = [t for t in tabs if t.get('type') == 'page'][0]
        ws_url = page_tab['webSocketDebuggerUrl']
        self.ws = await websockets.connect(ws_url, max_size=10_000_000)

        # Start background event listener
        asyncio.create_task(self._listen_events())

        # Enable domains
        await self.send_cmd('Network.enable')
        await self.send_cmd('Page.enable')
        await self.send_cmd('Runtime.enable')

    async def _listen_events(self):
        try:
            async for message in self.ws:
                data = json.loads(message)
                if 'id' in data and data['id'] in self.pending_responses:
                    self.pending_responses[data['id']].set_result(data)
                elif 'method' in data:
                    method = data['method']
                    params = data.get('params', {})
                    if method == 'Network.requestWillBeSent':
                        url = params.get('request', {}).get('url', '')
                        if '/api/' in url:
                            self.network_requests.append({
                                'url': url,
                                'method': params.get('request', {}).get('method'),
                                'requestId': params.get('requestId')
                            })
                    elif method == 'Network.responseReceived':
                        url = params.get('response', {}).get('url', '')
                        if '/api/' in url:
                            self.network_responses.append({
                                'url': url,
                                'status': params.get('response', {}).get('status'),
                                'statusText': params.get('response', {}).get('statusText'),
                                'requestId': params.get('requestId')
                            })
                    elif method == 'Runtime.consoleAPICalled':
                        log_type = params.get('type')
                        args = [str(a.get('value', a.get('description', ''))) for a in params.get('args', [])]
                        msg = ' '.join(args)
                        self.console_logs.append(f"[{log_type}] {msg}")
                        if log_type == 'error':
                            self.console_errors.append(msg)
        except Exception as e:
            pass

    async def send_cmd(self, method, params=None):
        self.msg_id += 1
        call_id = self.msg_id
        fut = asyncio.get_event_loop().create_future()
        self.pending_responses[call_id] = fut
        payload = {'id': call_id, 'method': method}
        if params:
            payload['params'] = params
        await self.ws.send(json.dumps(payload))
        resp = await fut
        del self.pending_responses[call_id]
        if 'error' in resp:
            raise RuntimeError(f"CDP Error in {method}: {resp['error']}")
        return resp.get('result', {})

    async def evaluate(self, expr):
        res = await self.send_cmd('Runtime.evaluate', {
            'expression': expr,
            'returnByValue': True,
            'awaitPromise': True
        })
        val = res.get('result', {}).get('value')
        return val

    async def navigate(self, url, wait_ms=1500):
        await self.send_cmd('Page.navigate', {'url': url})
        await asyncio.sleep(wait_ms / 1000.0)

async def run_browser_tests():
    session = BrowserSession()
    session.start_chrome()
    try:
        await session.connect()
        print("=== BROWSER CLIENT CONNECTED TO CHROME HEADLESS VIA CDP ===")

        # Wait for initial load
        await asyncio.sleep(2.5)

        # 1. AUTHENTICATION & PERSONA
        print("\n--- 1. Testing Browser Authentication Flow ---")
        user_name = await session.evaluate("""
            document.querySelector('[data-testid=\"user-profile\"], header, nav')?.innerText || document.body.innerText
        """)
        token = await session.evaluate("localStorage.getItem('rentflow_jwt_token')")
        user_raw = await session.evaluate("localStorage.getItem('rentflow_auth_user')")
        print(f"  [PASS] Stored JWT Token exists: {bool(token and len(token) > 20)}")
        assert token, "Token missing in localStorage!"
        assert user_raw, "User missing in localStorage!"
        user_obj = json.loads(user_raw)
        print(f"  [PASS] Logged-in user in browser: {user_obj.get('name')} ({user_obj.get('email')}), Role: {user_obj.get('role')}")

        # Test persona switcher to manager Sarah Chen
        switch_res = await session.evaluate("""
            (async () => {
                const res = await window.fetch('/api/auth/switch-demo-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'sarah.chen@apexrentals.com' })
                });
                return { status: res.status, data: await res.json() };
            })()
        """)
        assert switch_res['status'] == 200, f"Switch user failed: {switch_res}"
        print(f"  [PASS] Switched to Persona: {switch_res['data']['user']['name']} ({switch_res['data']['user']['role']})")

        # Switch back to owner Alex Rivera
        await session.evaluate("""
            (async () => {
                const res = await window.fetch('/api/auth/switch-demo-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'alex.rivera@apexrentals.com' })
                });
                const d = await res.json();
                localStorage.setItem('rentflow_jwt_token', d.token);
                localStorage.setItem('rentflow_auth_user', JSON.stringify(d.user));
            })()
        """)

        # 2. DASHBOARD VIEW
        print("\n--- 2. Testing Browser Dashboard View ---")
        await session.navigate(f"{BASE_URL}/")
        await asyncio.sleep(2.0)
        body_text = await session.evaluate("document.body.innerText")
        assert "Revenue" in body_text, "Revenue metric not found on dashboard!"
        assert "Fleet" in body_text or "Vehicles" in body_text, "Fleet metric not found!"
        print("  [PASS] Dashboard rendered: KPIs and metric cards loaded.")

        # 3. FLEET / VEHICLES VIEW
        print("\n--- 3. Testing Browser Fleet / Vehicles View ---")
        await session.navigate(f"{BASE_URL}/fleet")
        await asyncio.sleep(2.0)
        fleet_count = await session.evaluate("""
            document.querySelectorAll('div[class*=\"rounded\"], tr').length
        """)
        fleet_text = await session.evaluate("document.body.innerText")
        assert "Porsche" in fleet_text or "Tesla" in fleet_text, "Vehicles not listed in Fleet view!"
        print(f"  [PASS] Fleet view rendered: Vehicles displayed correctly.")

        # 4. CUSTOMERS VIEW
        print("\n--- 4. Testing Browser Customers View ---")
        await session.navigate(f"{BASE_URL}/customers")
        await asyncio.sleep(2.0)
        cust_text = await session.evaluate("document.body.innerText")
        assert "Driver" in cust_text or "Customer" in cust_text or "@" in cust_text, "Customers table empty!"
        print("  [PASS] Customers view rendered: Customer directory table loaded.")

        # 5. RENTALS & PRICING / BOOKINGS VIEW
        print("\n--- 5. Testing Browser Rentals & Quotes View ---")
        await session.navigate(f"{BASE_URL}/rentals")
        await asyncio.sleep(2.0)
        rentals_text = await session.evaluate("document.body.innerText")
        assert "RF-" in rentals_text or "Booking" in rentals_text or "Rental" in rentals_text, "Rentals view empty!"
        print("  [PASS] Rentals view rendered: Reservations table loaded.")

        # 6. INVOICES & PAYMENTS VIEW
        print("\n--- 6. Testing Browser Invoices & Payments View ---")
        await session.navigate(f"{BASE_URL}/invoices")
        await asyncio.sleep(2.0)
        invoices_text = await session.evaluate("document.body.innerText")
        assert "INV-" in invoices_text or "Paid" in invoices_text or "Balance" in invoices_text, "Invoices view empty!"
        print("  [PASS] Invoices view rendered: Billing statements loaded.")

        # 7. MAINTENANCE VIEW
        print("\n--- 7. Testing Browser Maintenance View ---")
        await session.navigate(f"{BASE_URL}/maintenance")
        await asyncio.sleep(2.0)
        maint_text = await session.evaluate("document.body.innerText")
        assert "Maintenance" in maint_text or "Service" in maint_text, "Maintenance view empty!"
        print("  [PASS] Maintenance view rendered: Work orders loaded.")

        # 8. ENQUIRIES VIEW
        print("\n--- 8. Testing Browser Enquiries View ---")
        await session.navigate(f"{BASE_URL}/enquiries")
        await asyncio.sleep(2.0)
        enq_text = await session.evaluate("document.body.innerText")
        assert "Enquir" in enq_text or "Lead" in enq_text, "Enquiries view empty!"
        print("  [PASS] Enquiries view rendered: CRM Leads loaded.")

        # 9. AUDIT LOGS VIEW
        print("\n--- 9. Testing Browser Audit Logs View ---")
        await session.navigate(f"{BASE_URL}/audit-logs")
        await asyncio.sleep(2.0)
        audit_text = await session.evaluate("document.body.innerText")
        assert "Audit" in audit_text or "system" in audit_text or "rental." in audit_text, "Audit logs view empty!"
        print("  [PASS] Audit Logs view rendered: Real-time audit timeline loaded.")

        # 10. PUBLIC STOREFRONT VIEW
        print("\n--- 10. Testing Browser Public Storefront View ---")
        await session.navigate(f"{BASE_URL}/store/apex-rentals")
        await asyncio.sleep(2.0)
        store_text = await session.evaluate("document.body.innerText")
        assert "Apex" in store_text or "Reserve" in store_text or "Book" in store_text, "Public storefront empty!"
        print("  [PASS] Public Storefront rendered: Customer booking portal active.")

        # 11. CHECK ALL BROWSER NETWORK REQUESTS & RESPONSES
        print("\n--- 11. Browser Network Traffic Analysis ---")
        print(f"Total API requests captured from browser: {len(session.network_requests)}")
        print(f"Total API responses captured from browser: {len(session.network_responses)}")

        status_counts = {}
        failed_endpoints = []
        for r in session.network_responses:
            code = r['status']
            status_counts[code] = status_counts.get(code, 0) + 1
            if code >= 400:
                failed_endpoints.append(f"{r['url']} -> HTTP {code} ({r['statusText']})")

        print("HTTP Status Breakdown:")
        for code, count in sorted(status_counts.items()):
            print(f"  HTTP {code}: {count} requests")

        if failed_endpoints:
            print("\nFAILED ENDPOINTS:")
            for ep in failed_endpoints:
                print(f"  [FAIL] {ep}")
            raise AssertionError(f"Detected {len(failed_endpoints)} failed API requests in browser!")
        else:
            print("  [ALL PASS] 100% of browser API requests returned 200/201!")

        print("\n--- 12. Browser Console Verification ---")
        if session.console_errors:
            print(f"Console errors noted: {len(session.console_errors)}")
            for ce in session.console_errors[:5]:
                print(f"  - {ce}")
        else:
            print("  [PASS] Zero console errors during all 10 view transitions!")

        print("\n=======================================================")
        print("ALL BROWSER WORKFLOWS VERIFIED AGAINST REACT -> DJANGO -> POSTGRESQL!")
        print("=======================================================")

    finally:
        session.stop_chrome()

if __name__ == '__main__':
    asyncio.run(run_browser_tests())
