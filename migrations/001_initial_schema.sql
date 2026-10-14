-- RentFlow Production Database Schema (PostgreSQL 14+)
-- Multi-Tenant Schema with Row-Level Isolation, Constraints, and Anti-Double-Booking Range Exclusions

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- -----------------------------------------------------------------------------
-- 1. TENANTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'USD',
    timezone VARCHAR(50) DEFAULT 'UTC',
    tax_rate NUMERIC(5, 4) DEFAULT 0.0875,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

-- -----------------------------------------------------------------------------
-- 2. USERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('owner', 'manager', 'staff')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_user_email UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);

-- -----------------------------------------------------------------------------
-- 3. VEHICLES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(64) NOT NULL,
    make VARCHAR(100) NOT NULL,
    model VARCHAR(100) NOT NULL,
    year INT NOT NULL,
    license_plate VARCHAR(32) NOT NULL,
    vin VARCHAR(64),
    daily_rate NUMERIC(10, 2) NOT NULL CHECK (daily_rate >= 0),
    deposit_amount NUMERIC(10, 2) NOT NULL DEFAULT 500 CHECK (deposit_amount >= 0),
    status VARCHAR(32) NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'rented', 'maintenance', 'reserved')),
    odometer INT NOT NULL DEFAULT 0 CHECK (odometer >= 0),
    fuel_level INT NOT NULL DEFAULT 100 CHECK (fuel_level >= 0 AND fuel_level <= 100),
    features JSONB DEFAULT '[]'::jsonb,
    images JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_license_plate UNIQUE (tenant_id, license_plate)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_status ON vehicles(tenant_id, status);

-- -----------------------------------------------------------------------------
-- 4. CUSTOMERS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    address TEXT,
    driver_license JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_rentals INT NOT NULL DEFAULT 0,
    total_spent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    rating NUMERIC(3, 2) DEFAULT 5.0,
    status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'blacklisted')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_customer_email UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);

-- -----------------------------------------------------------------------------
-- 5. RENTALS (BOOKINGS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rentals (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rental_number VARCHAR(64) NOT NULL,
    customer_id VARCHAR(64) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
    customer_name VARCHAR(255) NOT NULL,
    vehicle_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'active', 'completed', 'cancelled')),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    daily_rate NUMERIC(10, 2) NOT NULL,
    days INT NOT NULL CHECK (days > 0),
    base_rental NUMERIC(10, 2) NOT NULL,
    add_ons JSONB DEFAULT '[]'::jsonb,
    total_add_ons NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0875,
    tax_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    deposit_amount NUMERIC(10, 2) NOT NULL DEFAULT 500,
    total_amount NUMERIC(10, 2) NOT NULL,
    balance_due NUMERIC(10, 2) NOT NULL,
    notes TEXT,
    check_out_inspection JSONB,
    check_in_inspection JSONB,
    booking_range TSTZRANGE GENERATED ALWAYS AS (tstzrange(start_date, end_date, '[)')) STORED,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_rental_number UNIQUE (tenant_id, rental_number),
    CONSTRAINT chk_rental_dates CHECK (end_date > start_date)
);

-- PostgreSQL GiST constraint physically preventing double booking for non-cancelled rentals
ALTER TABLE rentals ADD CONSTRAINT no_overlapping_rentals
EXCLUDE USING gist (
    vehicle_id WITH =,
    booking_range WITH &&
) WHERE (status NOT IN ('cancelled', 'completed'));

CREATE INDEX IF NOT EXISTS idx_rentals_tenant_status ON rentals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_rentals_vehicle_dates ON rentals(vehicle_id, start_date, end_date);

-- -----------------------------------------------------------------------------
-- 6. INVOICES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(64) NOT NULL,
    rental_id VARCHAR(64) REFERENCES rentals(id) ON DELETE SET NULL,
    customer_id VARCHAR(64) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    customer_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'issued' CHECK (status IN ('draft', 'issued', 'paid', 'partially_paid', 'overdue', 'cancelled')),
    subtotal NUMERIC(10, 2) NOT NULL,
    tax_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(10, 2) NOT NULL,
    paid_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
    balance_due NUMERIC(10, 2) NOT NULL DEFAULT 0,
    payments JSONB DEFAULT '[]'::jsonb,
    due_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_tenant_invoice_number UNIQUE (tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status ON invoices(tenant_id, status);

-- -----------------------------------------------------------------------------
-- 7. MAINTENANCE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_records (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    vehicle_id VARCHAR(64) NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    vehicle_name VARCHAR(255) NOT NULL,
    service_type VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    cost NUMERIC(10, 2) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
    scheduled_date TIMESTAMPTZ NOT NULL,
    completed_date TIMESTAMPTZ,
    odometer_at_service INT,
    vendor VARCHAR(255),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_maintenance_tenant_vehicle ON maintenance_records(tenant_id, vehicle_id);

-- -----------------------------------------------------------------------------
-- 8. ENQUIRIES & CRM LEADS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enquiries (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_name VARCHAR(255) NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50),
    vehicle_category VARCHAR(64),
    preferred_vehicle_id VARCHAR(64) REFERENCES vehicles(id) ON DELETE SET NULL,
    preferred_vehicle_name VARCHAR(255),
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    estimated_budget NUMERIC(10, 2),
    status VARCHAR(32) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'quoted', 'converted', 'lost')),
    notes TEXT,
    source VARCHAR(64) DEFAULT 'website',
    converted_rental_id VARCHAR(64) REFERENCES rentals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_enquiries_tenant_status ON enquiries(tenant_id, status);

-- -----------------------------------------------------------------------------
-- 9. AUDIT LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id VARCHAR(64),
    user_name VARCHAR(255) NOT NULL,
    user_role VARCHAR(32),
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(tenant_id, entity_type, entity_id);
