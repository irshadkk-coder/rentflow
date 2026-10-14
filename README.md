# RentFlow — Modern Multi-Tenant Vehicle Rental SaaS Platform

[![React](https://img.shields.io/badge/Frontend-React%2019%20%7C%20TypeScript%20%7C%20Vite-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Django](https://img.shields.io/badge/Backend-Django%205%20%7C%20DRF%20%7C%20Python%203.11-092e20?logo=django&logoColor=white)](https://www.djangoproject.com/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%2016-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Deployment](https://img.shields.io/badge/Deployment-Vercel%20%2B%20Render-black?logo=vercel&logoColor=white)](https://vercel.com/)
[![License](https://img.shields.io/badge/License-MIT-emerald)](LICENSE)

**RentFlow** is a production-grade, multi-tenant Software-as-a-Service (SaaS) application engineered for vehicle and mobility rental operators (car rental agencies, motorcycle hire fleets, and e-bike operators). Built with a decoupled architecture featuring a modern React 19 single-page application and a robust Django REST Framework backend with strict PostgreSQL multi-tenant isolation.

---

## 🌟 Key Features

### 🏢 1. Multi-Tenant Architecture & Enterprise Isolation
* **Cryptographic Tenant Isolation**: Tenant identity is securely bound to JWT claims and enforced at the database query layer. Cross-tenant data leakage and IDOR vulnerabilities are prevented.
* **Role-Based Access Control (RBAC)**: Fine-grained permissions for `Owner`, `Manager`, and `Staff` roles.
* **Tenant Scoping & Custom Branding**: Each tenant operates under an isolated vanity slug (e.g. `/store/apex-rentals`) with custom tax rates, currencies, branch locations, and deposits.

### 🚗 2. Fleet Management & Booking Engine
* **Conflict Prevention**: Server-side double-booking prevention across overlapping date and time ranges using transactional locks.
* **Canonical Pricing Engine**: Server calculates base rates, duration tiers, optional add-ons, sales taxes, and security deposits. Tampered client-side totals are rejected.
* **Inspection Handover Workflows**: Step-by-step check-out departure and check-in return inspections recording fuel percentages, odometer readings, and condition reports.

### 🌐 3. Public Storefront & Guest Checkout
* **Vanity Storefronts**: Publicly accessible, responsive catalog at `/store/:slug` for online customer reservations.
* **Real-Time Fleet Availability**: Live inventory filtering by vehicle category (cars, motorcycles, e-bikes, scooters).
* **Instant Quote Calculator & Direct Booking**: Generates real-time price quotes and auto-registers guest renters with confirmed reservations and instant booking reference numbers.

### 💼 4. CRM Pipeline & Operational Analytics
* **Leads Intake Pipeline**: Captures web storefront inquiries, phone calls, and walk-in leads (`new` → `contacted` → `quoted` → `converted`).
* **1-Click Booking Conversion**: Converts qualified sales inquiries directly into confirmed reservations with pre-filled vehicle, customer, and date details.
* **Executive KPI Dashboard**: Real-time revenue metrics, fleet utilization rates, upcoming returns, and pending maintenance alerts.

### 🧾 5. Billing, Invoices & Audit Trail
* **Accounting Sequences**: Formats human-readable, sequential identifiers (`BK-1046`, `INV-0886`).
* **Payment Reconciliation**: Tracks partial payments, card/cash settlements, security deposit holdings, and refunds.
* **Immutable Security Audit Log**: Records sensitive operations (`rental.create`, `rental.checkin`, `vehicle.delete`, `invoice.payment`) with user identity, timestamps, and IP addresses.

---

## 📸 Screenshots & UI Walkthrough

| Executive Operations Dashboard | Public Vehicle Storefront (`/store/:slug`) |
|:---:|:---:|
| ![Dashboard Screenshot](https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80) | ![Storefront Screenshot](https://images.unsplash.com/photo-1560958089-b8a1929cea89?auto=format&fit=crop&w=800&q=80) |
| *Real-time fleet KPI metrics, active rentals, and revenue charts* | *Online guest catalog with live instant quote calculator* |

| Fleet Inventory & Quick Actions | Reservation Timeline & Gantt View |
|:---:|:---:|
| ![Fleet Management](https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=800&q=80) | ![Timeline View](https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80) |
| *Vehicle availability, maintenance tracking, and specs* | *Interactive scheduling view showing overlapping bookings* |

---

## 🛠️ Technology Stack

```mermaid
graph TD
    Client[Browser / Client] -->|HTTPS / REST API| Vercel[Vercel CDN / Frontend React 19 SPA]
    Vercel -->|/api/* Rewrites| Render[Render Web Service / Django DRF]
    Render -->|PostgreSQL Wire Protocol| Postgres[(PostgreSQL 16 Database)]
    Render -->|Asynchronous Tasks| Celery[Celery Worker + Redis]
    Render -->|Transactional Emails| Brevo[Brevo SMTP / API v3]
```

| Layer | Technologies |
|---|---|
| **Frontend** | React 19, TypeScript, React Router 7, Vite 6, Tailwind CSS, Lucide Icons, Recharts |
| **Backend** | Python 3.11, Django 5, Django REST Framework, Gunicorn WSGI, Celery |
| **Database & Cache** | PostgreSQL 16 (Relational tables + JSONB metadata), Redis 7 |
| **Authentication & Security** | JWT (JSON Web Tokens), `bcrypt` password hashing, Turnstile bot detection |
| **Deployment** | Frontend on **Vercel** (`vercel.json`), Backend on **Render** (`Dockerfile`) |

---

## 🧭 Application Routes

| Path | Description | Access Control |
|---|---|---|
| `/` or `/dashboard` | Operational dashboard with live KPIs, active rentals, and alerts | Authenticated |
| `/fleet` | Fleet directory, status toggles, specifications, and fast booking | Authenticated |
| `/rentals` | Booking directory, departure check-out, and return check-in | Authenticated |
| `/timeline` | Gantt chart of fleet scheduling and overlapping bookings | Authenticated |
| `/customers` | Customer directory, driver license records, and rental history | Authenticated |
| `/enquiries` | Sales lead pipeline and 1-click booking converter | Authenticated |
| `/invoices` | Billing ledger, payments settlement, and receipt preview | Authenticated |
| `/maintenance` | Service orders, odometer triggers, and maintenance logs | Authenticated |
| `/audit-logs` | Immutable audit trail for security compliance and staff actions | Owner / Manager |
| `/settings` | Business profile, tax rates, currencies, and branch config | Owner |
| `/store/:slug` | Customer-facing public storefront (e.g. `/store/apex-rentals`) | Public |
| `/login` | Staff and Owner sign-in portal | Public |

---

## 👥 Seed Demo Personas (Development Mode)

In development mode (`DEBUG=True`), RentFlow includes pre-configured demo personas to facilitate local evaluation of role-based permissions and multi-tenant isolation:

| Name | Role | Email | Organization (Tenant) |
|---|---|---|---|
| **Alex Rivera** | Owner | `alex.rivera@apexrentals.com` | Apex Luxury Rentals (`tenant-1`) |
| **Sarah Chen** | Manager | `sarah.chen@apexrentals.com` | Apex Luxury Rentals (`tenant-1`) |
| **Jordan Lee** | Staff | `jordan.lee@apexrentals.com` | Apex Luxury Rentals (`tenant-1`) |
| **Maya Lin** | Owner | `maya.lin@coastalrentals.com` | Metro City Car Share (`tenant-2`) |

> [!IMPORTANT]
> **Production Demo Lockout**: In production (`DEBUG=False`), authentication to predefined demo accounts and accounts with the known seed password `Password123!` is **strictly blocked** by the backend authentication service.

---

## 🚀 Local Development Setup

### Prerequisites
* **Node.js** 20.x or higher & **npm** 9.x+
* **Python** 3.11 or higher
* **PostgreSQL** 14+ (running locally or via Docker)

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/your-username/rentflow.git
cd rentflow

# Install frontend dependencies
npm install

# Create and activate Python virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install backend dependencies
pip install -r backend/requirements.txt
```

### 2. Configure Environment Variables
Copy the template files into place:
```bash
# Copy local development configuration
cp .env.example .env
```

Configure your PostgreSQL credentials in `.env`:
```bash
DATABASE_URL="postgresql://postgres:password@localhost:5432/rentflow"
DJANGO_SECRET_KEY="your-local-dev-secret-key"
JWT_SECRET="your-local-jwt-secret-at-least-32-chars"
```

### 3. Run Database Migrations & Baseline Seed
```bash
# Apply Django migrations
python backend/manage.py migrate

# (Optional) Seed demo personas and vehicles for development evaluation
npm run seed:django
```

### 4. Start Development Servers
Run the frontend and backend concurrently:
```bash
# Terminal 1: Start Django REST API backend (http://127.0.0.1:8000)
npm run dev:django

# Terminal 2: Start Vite frontend development server (http://localhost:3000)
npm run dev
```

Visit `http://localhost:3000` to access the application.

---

## 🧪 Testing & Code Quality

The codebase includes comprehensive test suites across both the frontend and backend:

```bash
# 1. Frontend TypeScript type checking
npm run lint

# 2. Production frontend compilation bundle
npm run build

# 3. Django system checks
python backend/manage.py check

# 4. Run automated backend test suites
python backend/manage.py test api --keepdb
```

---

## 🌐 Production Deployment

RentFlow is structured for deployment using a split architecture:

### 1. Backend Deployment (Render)
1. Deploy a **Web Service** on Render using the included [`Dockerfile`](Dockerfile).
2. Attach a managed **PostgreSQL** instance.
3. Configure production environment variables in Render according to [`.env.production.example`](.env.production.example):
   * `DJANGO_DEBUG=False`
   * `DJANGO_SECRET_KEY`: Generate using `python -c "import secrets; print(secrets.token_urlsafe(50))"`
   * `JWT_SECRET`: Generate using `python -c "import secrets; print(secrets.token_hex(32))"`
   * `DATABASE_URL`: Your Render internal database connection URL
   * `CORS_ALLOWED_ORIGINS`: Your Vercel frontend URL (e.g. `https://rentflow.vercel.app`)
   * `PROD_OWNER_EMAIL`: Your initial production owner email
   * `PROD_OWNER_PASSWORD`: Your unique, strong production owner password
4. Run migrations and safe initialization in the Render Shell:
   ```bash
   python manage.py migrate --noinput
   python manage.py init_production
   ```

### 2. Frontend Deployment (Vercel)
1. Import the repository into **Vercel**.
2. Vercel automatically detects the Vite configuration using [`vercel.json`](vercel.json).
3. In [`vercel.json`](vercel.json), set your Render backend domain:
   ```json
   {
     "source": "/api/:path*",
     "destination": "https://your-render-backend.onrender.com/api/:path*"
   }
   ```
4. Deploy. Vercel will serve the SPA and transparently proxy all `/api/*` calls to your Render backend.

---

## 📄 License
This project is open-source and available under the [MIT License](LICENSE).
