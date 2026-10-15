#!/bin/sh
set -e

# Run database migrations against the production database
echo "==> Running database migrations..."
python manage.py migrate --noinput

# Start application server with provided command arguments (e.g. Gunicorn)
echo "==> Starting application server..."
exec "$@"
