from django.db import migrations, models
from django.utils import timezone


def verify_existing_users(apps, schema_editor):
    User = apps.get_model('api', 'User')
    User.objects.filter(email_verified_at__isnull=True).update(email_verified_at=timezone.now())


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_alter_maintenancerecord_vehicle_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='email_verification_sent_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verification_token_hash',
            field=models.CharField(blank=True, max_length=128, null=True),
        ),
        migrations.AddField(
            model_name='user',
            name='email_verified_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='tenant',
            name='currency',
            field=models.CharField(blank=True, default='₹', max_length=10, null=True),
        ),
        migrations.RunPython(verify_existing_users, reverse_code=migrations.RunPython.noop),
    ]
