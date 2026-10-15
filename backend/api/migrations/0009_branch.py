import api.models
import django.db.models.deletion
from django.db import migrations, models


def populate_initial_branches(apps, schema_editor):
    Tenant = apps.get_model('api', 'Tenant')
    Branch = apps.get_model('api', 'Branch')
    import uuid
    from decimal import Decimal

    KNOWN_LOCATIONS = {
        'Downtown Harbor Hub': {
            'address': 'Suite 100, 100 The Embarcadero',
            'city': 'San Francisco',
            'pincode': '94105',
            'latitude': Decimal('37.793600'),
            'longitude': Decimal('-122.395800'),
            'phone': '+1 (415) 555-0142',
        },
        'SFO Airport Terminal': {
            'address': 'Level 2, International Terminal Blvd',
            'city': 'San Francisco',
            'pincode': '94128',
            'latitude': Decimal('37.621300'),
            'longitude': Decimal('-122.379000'),
            'phone': '+1 (415) 555-0199',
        },
        'Marina Bay Outpost': {
            'address': 'Marina Blvd & Scott St, Marina District',
            'city': 'San Francisco',
            'pincode': '94123',
            'latitude': Decimal('37.803700'),
            'longitude': Decimal('-122.436800'),
            'phone': '+1 (415) 555-0177',
        },
        'Downtown Hub': {
            'address': '101 Market St, Financial District',
            'city': 'San Francisco',
            'pincode': '94105',
            'latitude': Decimal('37.794100'),
            'longitude': Decimal('-122.395200'),
            'phone': '+1 (415) 555-0201',
        },
        'Metro Train Depot': {
            'address': '700 4th Street, Mission Bay',
            'city': 'San Francisco',
            'pincode': '94107',
            'latitude': Decimal('37.776500'),
            'longitude': Decimal('-122.394800'),
            'phone': '+1 (415) 555-0202',
        },
        'Airport Terminal': {
            'address': 'North Terminal Concourse B',
            'city': 'San Francisco',
            'pincode': '94128',
            'latitude': Decimal('37.618900'),
            'longitude': Decimal('-122.375000'),
            'phone': '+1 (415) 555-0198',
        },
    }

    for tenant in Tenant.objects.all():
        settings = tenant.settings if isinstance(tenant.settings, dict) else {}
        loc_names = settings.get('locations')
        if not isinstance(loc_names, list) or not loc_names:
            loc_names = ['Downtown Harbor Hub', 'SFO Airport Terminal', 'Marina Bay Outpost']

        created_names = []
        for loc in loc_names:
            loc_str = str(loc).strip()
            if not loc_str or loc_str in created_names:
                continue
            created_names.append(loc_str)

            meta = KNOWN_LOCATIONS.get(loc_str, {
                'address': f"{loc_str} Rental Station",
                'city': 'San Francisco',
                'pincode': '94105',
                'latitude': Decimal('37.774900'),
                'longitude': Decimal('-122.419400'),
                'phone': tenant.phone or '+1 (415) 555-0100',
            })

            Branch.objects.get_or_create(
                tenant=tenant,
                name=loc_str,
                defaults={
                    'id': str(uuid.uuid4()),
                    'address': meta['address'],
                    'city': meta['city'],
                    'pincode': meta['pincode'],
                    'latitude': meta['latitude'],
                    'longitude': meta['longitude'],
                    'phone': meta['phone'],
                    'is_active': True,
                }
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0008_user_branch_user_is_active_teaminvitation'),
    ]

    operations = [
        migrations.CreateModel(
            name='Branch',
            fields=[
                ('id', models.CharField(default=api.models.generate_uuid, max_length=64, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=255)),
                ('address', models.CharField(max_length=255)),
                ('city', models.CharField(max_length=100)),
                ('pincode', models.CharField(max_length=20)),
                ('latitude', models.DecimalField(decimal_places=6, max_digits=9)),
                ('longitude', models.DecimalField(decimal_places=6, max_digits=9)),
                ('phone', models.CharField(blank=True, max_length=50, null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True, null=True)),
                ('updated_at', models.DateTimeField(auto_now=True, null=True)),
                ('tenant', models.ForeignKey(db_column='tenant_id', on_delete=django.db.models.deletion.CASCADE, related_name='branches', to='api.tenant')),
            ],
            options={
                'db_table': 'branches',
                'ordering': ['name'],
                'unique_together': {('tenant', 'name')},
            },
        ),
        migrations.RunPython(populate_initial_branches, reverse_code=noop_reverse),
    ]

