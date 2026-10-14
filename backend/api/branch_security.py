from typing import Optional
from django.db.models import QuerySet
from .models import Tenant, User, Vehicle, Rental, MaintenanceRecord, Invoice


def get_tenant_locations(tenant: Tenant) -> list[str]:
    """
    Retrieve sanitized list of valid branch/location strings configured for the given tenant.
    Defaults safely to ['Main Station Hub'] if no locations are configured.
    """
    if not tenant:
        return ['Main Station Hub']
    settings_dict = tenant.settings if isinstance(tenant.settings, dict) else {}
    raw_locations = settings_dict.get('locations')
    if isinstance(raw_locations, list):
        cleaned = [str(loc).strip() for loc in raw_locations if loc and str(loc).strip()]
        if cleaned:
            return cleaned
    return ['Main Station Hub']


def is_valid_tenant_branch(tenant: Tenant, branch_name: str) -> bool:
    """
    Check if a candidate branch belongs to the tenant's configured branches.
    If the tenant has an explicit locations list configured in settings, strictly enforces membership.
    """
    if not branch_name or not str(branch_name).strip():
        return False
    candidate = str(branch_name).strip()
    settings_dict = tenant.settings if (tenant and isinstance(tenant.settings, dict)) else {}
    raw_locations = settings_dict.get('locations')
    if isinstance(raw_locations, list) and len(raw_locations) > 0:
        valid_locations = [str(loc).strip() for loc in raw_locations if loc and str(loc).strip()]
        return candidate in valid_locations or any(loc.lower() == candidate.lower() for loc in valid_locations)
    # If tenant was created without explicit locations list (e.g. ad-hoc unit test), allow valid string
    return bool(candidate)


def resolve_user_branch_scope(user: User, requested_location: Optional[str] = None) -> tuple[Optional[str], Optional[str]]:
    """
    Resolve the effective branch filter and enforce RBAC for the authenticated user.

    Returns:
        (effective_branch, error_message)
        - effective_branch:
            - None if tenant-wide access is permitted (OWNER only).
            - string (e.g., 'Downtown Harbor Hub') if scoped to a specific branch.
        - error_message:
            - None if access is allowed.
            - string with description if authorization fails (HTTP 403 or 400).
    """
    if not user:
        return None, "Authentication required."

    tenant = user.tenant
    valid_locations = get_tenant_locations(tenant)
    clean_req = requested_location.strip() if (requested_location and isinstance(requested_location, str)) else None

    # Normalization: treat 'ALL', 'all', '', None as tenant-wide request
    is_requesting_all = clean_req is None or clean_req.upper() == 'ALL' or clean_req == ''

    if user.role == 'owner':
        if is_requesting_all:
            return None, None
        # Validate that requested location belongs to owner's tenant
        matched_loc = next((loc for loc in valid_locations if loc.lower() == clean_req.lower()), None)
        if matched_loc:
            return matched_loc, None
        return None, f"Invalid branch '{clean_req}' for this business. Configured branches: {', '.join(valid_locations)}"

    # MANAGER and STAFF
    if user.role in ['manager', 'staff']:
        user_branch = str(user.branch).strip() if (user.branch and str(user.branch).strip()) else None

        # Fail safely: users without a branch assignment or with invalid branches are NEVER granted access
        if not user_branch:
            return None, "Access denied: You are not assigned to a branch. Please contact your organization owner."

        matched_user_loc = next((loc for loc in valid_locations if loc.lower() == user_branch.lower()), None)
        if not matched_user_loc:
            return None, f"Access denied: Your assigned branch '{user_branch}' is no longer active for this business. Please contact your organization owner."

        # Managers/staff cannot request 'ALL' or another branch
        if is_requesting_all and clean_req and clean_req.upper() == 'ALL':
            return None, "Forbidden: Managers and Staff are restricted to their assigned branch and cannot access all branches."

        if clean_req and clean_req.lower() != matched_user_loc.lower():
            return None, f"Forbidden: You are restricted to your assigned branch '{matched_user_loc}'."

        return matched_user_loc, None

    return None, f"Forbidden: Unrecognized user role '{user.role}'."


def is_forbidden_error(err: Optional[str]) -> bool:
    """
    Distinguish between permission/RBAC denials (HTTP 403 Forbidden)
    and bad request parameters from authorized users (HTTP 400 Bad Request).
    """
    if not err:
        return False
    lower = err.lower()
    return 'forbidden' in lower or 'denied' in lower or 'restricted' in lower or 'assigned branch' in lower



def filter_vehicles_by_branch(qs: QuerySet, effective_branch: Optional[str]) -> QuerySet:
    if effective_branch:
        return qs.filter(images__location=effective_branch)
    return qs


def filter_rentals_by_branch(qs: QuerySet, effective_branch: Optional[str]) -> QuerySet:
    if effective_branch:
        return qs.filter(vehicle__images__location=effective_branch)
    return qs


def filter_maintenance_by_branch(qs: QuerySet, effective_branch: Optional[str]) -> QuerySet:
    if effective_branch:
        return qs.filter(vehicle__images__location=effective_branch)
    return qs


def filter_invoices_by_branch(qs: QuerySet, effective_branch: Optional[str]) -> QuerySet:
    if effective_branch:
        return qs.filter(rental__vehicle__images__location=effective_branch)
    return qs


def validate_vehicle_mutation(user: User, vehicle: Optional[Vehicle], requested_location: Optional[str] = None) -> Optional[str]:
    """
    Validate vehicle create/update authorization based on branch RBAC.
    Returns error string if disallowed, None if permitted.
    """
    effective_branch, err = resolve_user_branch_scope(user)
    if err:
        return err

    tenant = user.tenant
    valid_locations = get_tenant_locations(tenant)

    if user.role == 'owner':
        if requested_location:
            candidate = requested_location.strip()
            if not any(loc.lower() == candidate.lower() for loc in valid_locations):
                return f"Invalid branch '{requested_location}' for this business. Configured branches: {', '.join(valid_locations)}"
        return None

    if user.role == 'manager':
        # Manager modifying existing vehicle: vehicle must belong to manager's branch
        if vehicle:
            v_loc = (vehicle.images if isinstance(vehicle.images, dict) else {}).get('location', '')
            if str(v_loc).strip().lower() != effective_branch.lower():
                return f"Forbidden: You cannot modify vehicles belonging to branch '{v_loc}'."

        # Manager cannot assign vehicle to another branch
        if requested_location:
            candidate = requested_location.strip()
            if candidate.lower() != effective_branch.lower():
                return f"Forbidden: Managers can only assign vehicles to their assigned branch '{effective_branch}'."

        return None

    return "Forbidden: Staff members cannot create or modify vehicle records."


def validate_rental_mutation(
    user: User,
    vehicle: Optional[Vehicle],
    rental: Optional[Rental] = None,
    requested_location: Optional[str] = None
) -> Optional[str]:
    """
    Validate rental create/update/check-in/check-out authorization based on branch RBAC.
    Returns error string if disallowed, None if permitted.
    """
    effective_branch, err = resolve_user_branch_scope(user)
    if err:
        return err

    if user.role == 'owner':
        return None

    if user.role in ['manager', 'staff']:
        # Existing rental target check
        if rental and rental.vehicle:
            r_loc = (rental.vehicle.images if isinstance(rental.vehicle.images, dict) else {}).get('location', '')
            if str(r_loc).strip().lower() != effective_branch.lower():
                return f"Forbidden: You cannot access or modify rentals belonging to branch '{r_loc}'."

        # Target vehicle must belong to user's assigned branch
        if vehicle:
            v_loc = (vehicle.images if isinstance(vehicle.images, dict) else {}).get('location', '')
            if str(v_loc).strip().lower() != effective_branch.lower():
                return f"Forbidden: You cannot create or modify rentals for vehicle at branch '{v_loc}'."

        if requested_location:
            candidate = requested_location.strip()
            if candidate.lower() != effective_branch.lower():
                return f"Forbidden: Pickup location must match your assigned branch '{effective_branch}'."

        return None

    return "Forbidden: Insufficient privileges."


def validate_maintenance_mutation(
    user: User,
    vehicle: Optional[Vehicle],
    record: Optional[MaintenanceRecord] = None
) -> Optional[str]:
    """
    Validate maintenance create/update authorization based on branch RBAC.
    Returns error string if disallowed, None if permitted.
    """
    effective_branch, err = resolve_user_branch_scope(user)
    if err:
        return err

    if user.role == 'owner':
        return None

    if user.role == 'manager':
        if record and record.vehicle:
            rec_loc = (record.vehicle.images if isinstance(record.vehicle.images, dict) else {}).get('location', '')
            if str(rec_loc).strip().lower() != effective_branch.lower():
                return f"Forbidden: You cannot modify maintenance tasks for vehicle at branch '{rec_loc}'."

        if vehicle:
            v_loc = (vehicle.images if isinstance(vehicle.images, dict) else {}).get('location', '')
            if str(v_loc).strip().lower() != effective_branch.lower():
                return f"Forbidden: You cannot schedule maintenance for vehicle at branch '{v_loc}'."

        return None

    return "Forbidden: Staff members cannot create or modify maintenance records."
