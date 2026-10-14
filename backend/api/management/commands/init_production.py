import os
import sys
import getpass
from django.core.management.base import BaseCommand, CommandError
from api.prod_seed_service import initialize_production_environment


class Command(BaseCommand):
    help = (
        "Safely and non-destructively initializes the production environment on Render: "
        "validates/creates the production tenant, seeds the approved demo vehicles with storefront metadata, "
        "and creates a dedicated verified Owner account without truncating tables."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--owner-email',
            type=str,
            default=None,
            help="Production Owner email address (defaults to PROD_OWNER_EMAIL environment variable)."
        )
        parser.add_argument(
            '--owner-name',
            type=str,
            default=None,
            help="Production Owner display name (defaults to PROD_OWNER_NAME or 'Production Owner')."
        )
        parser.add_argument(
            '--tenant-slug',
            type=str,
            default="apex-rentals",
            help="Tenant slug for the public storefront URL (default: 'apex-rentals')."
        )
        parser.add_argument(
            '--tenant-id',
            type=str,
            default="tenant-1",
            help="Primary key for the production tenant (default: 'tenant-1')."
        )

    def handle(self, *args, **options):
        # 1. Resolve Owner Email
        owner_email = options.get('owner_email') or os.environ.get('PROD_OWNER_EMAIL')
        if not owner_email or not owner_email.strip():
            raise CommandError(
                "Missing owner email. Provide via --owner-email or set the PROD_OWNER_EMAIL environment variable."
            )

        # 2. Resolve Owner Name
        owner_name = options.get('owner_name') or os.environ.get('PROD_OWNER_NAME', 'Production Owner')

        # 3. Resolve Owner Password SECURELY from environment variable (never via CLI flag to avoid process table leak)
        owner_password = os.environ.get('PROD_OWNER_PASSWORD')
        if not owner_password:
            # If running in an interactive terminal session, support secure getpass prompt
            if sys.stdin.isatty():
                self.stdout.write(self.style.WARNING("PROD_OWNER_PASSWORD environment variable not found."))
                owner_password = getpass.getpass("Enter Production Owner Password: ")
            else:
                raise CommandError(
                    "Missing owner password. Please set the PROD_OWNER_PASSWORD environment variable in Render."
                )

        if not owner_password or not owner_password.strip():
            raise CommandError("Production Owner password cannot be empty.")

        tenant_id = options.get('tenant_id', 'tenant-1')
        tenant_slug = options.get('tenant_slug', 'apex-rentals')

        self.stdout.write(self.style.NOTICE("Initializing RentFlow production environment..."))

        try:
            summary = initialize_production_environment(
                owner_email=owner_email,
                owner_password=owner_password,
                owner_name=owner_name,
                tenant_id=tenant_id,
                tenant_slug=tenant_slug
            )
        except ValueError as e:
            # Never print secrets in errors
            raise CommandError(str(e))
        except Exception as e:
            raise CommandError(f"Unexpected error during production initialization: {str(e)}")

        # Output sanitized summary without leaking credentials
        self.stdout.write(self.style.SUCCESS("-" * 65))
        self.stdout.write(self.style.SUCCESS("RentFlow Production Initialization Completed Successfully"))
        self.stdout.write(self.style.SUCCESS("-" * 65))

        if summary['tenant_action'] == 'created_new':
            self.stdout.write(f"  Tenant Status: Created initial tenant '{summary['tenant_id']}' ({tenant_slug}).")
        else:
            self.stdout.write(f"  Tenant Status: Validated existing tenant '{summary['tenant_id']}' (settings preserved).")

        self.stdout.write(f"  Owner Status: Created & verified '{summary['owner_email']}' as active organization Owner.")
        self.stdout.write(
            f"  Fleet Status: {summary['vehicles_created']} demo vehicles seeded, "
            f"{summary['vehicles_retained']} existing vehicles preserved "
            f"({summary['total_demo_vehicles']} total catalog vehicles)."
        )
        self.stdout.write(self.style.SUCCESS("All demo vehicle photos hosted externally on CDN; storefront ready."))
        self.stdout.write(self.style.SUCCESS("-" * 65))
