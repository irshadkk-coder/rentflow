import os
from pathlib import Path
from urllib.parse import urlparse
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent

# Load .env from project root
env_path = ROOT_DIR / '.env'
if env_path.exists():
    load_dotenv(dotenv_path=env_path)

# Environment & Debug settings
if 'DJANGO_DEBUG' in os.environ:
    DEBUG = os.environ.get('DJANGO_DEBUG', 'True').lower() == 'true'
elif 'DEBUG' in os.environ:
    DEBUG = os.environ.get('DEBUG', 'True').lower() == 'true'
elif os.environ.get('RENDER') == 'true' or os.environ.get('RENDER') == '1':
    DEBUG = False
elif os.environ.get('ENVIRONMENT') == 'production' or os.environ.get('NODE_ENV') == 'production':
    DEBUG = False
else:
    DEBUG = True

# Demo Persona / Switcher Configuration
# In production (DEBUG=False), demo mode is strictly disabled regardless of env variables.
# In development, it defaults to True unless ENABLE_DEMO_MODE is set to 'false'.
raw_enable_demo = os.environ.get('ENABLE_DEMO_MODE', '').strip().lower()
if not DEBUG:
    ENABLE_DEMO_MODE = False
elif raw_enable_demo in ['false', '0', 'no', 'off']:
    ENABLE_DEMO_MODE = False
else:
    ENABLE_DEMO_MODE = True

# Secret Keys
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY')
JWT_SECRET = os.environ.get('JWT_SECRET')

if not DEBUG:
    if not SECRET_KEY:
        raise ImproperlyConfigured('DJANGO_SECRET_KEY environment variable is required when DEBUG=False.')
    if not JWT_SECRET:
        raise ImproperlyConfigured('JWT_SECRET environment variable is required when DEBUG=False.')
else:
    if not SECRET_KEY:
        raise ImproperlyConfigured('DJANGO_SECRET_KEY is required. Please set it in your .env file or environment.')
    if not JWT_SECRET:
        raise ImproperlyConfigured('JWT_SECRET is required. Please set it in your .env file or environment.')

# Turnstile / Bot Protection Configuration
TURNSTILE_SITE_KEY = (
    os.environ.get('TURNSTILE_SITE_KEY')
    or os.environ.get('CLOUDFLARE_TURNSTILE_SITE_KEY')
    or os.environ.get('CF_TURNSTILE_SITE_KEY')
    or ''
)
TURNSTILE_SECRET_KEY = (
    os.environ.get('TURNSTILE_SECRET_KEY')
    or os.environ.get('CLOUDFLARE_TURNSTILE_SECRET_KEY')
    or os.environ.get('CF_TURNSTILE_SECRET_KEY')
    or ''
)

# Allowed Hosts
raw_allowed_hosts = os.environ.get('ALLOWED_HOSTS')
if raw_allowed_hosts:
    ALLOWED_HOSTS = [h.strip() for h in raw_allowed_hosts.split(',') if h.strip()]
else:
    ALLOWED_HOSTS = ['*'] if DEBUG else ['localhost', '127.0.0.1', '[::1]']

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'django.contrib.staticfiles',
    'django.contrib.postgres',
    'corsheaders',
    'rest_framework',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'rentflow_backend.urls'

WSGI_APPLICATION = 'rentflow_backend.wsgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
            ],
        },
    },
]

# Database configuration: PostgreSQL
DATABASE_URL = os.environ.get('DATABASE_URL')
if DATABASE_URL:
    url = urlparse(DATABASE_URL)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': url.path[1:],
            'USER': url.username,
            'PASSWORD': url.password,
            'HOST': url.hostname,
            'PORT': url.port or 5432,
            'CONN_MAX_AGE': 600,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.environ.get('PGDATABASE', 'rentflow'),
            'USER': os.environ.get('PGUSER', 'postgres'),
            'PASSWORD': os.environ.get('PGPASSWORD', 'postgres'),
            'HOST': os.environ.get('PGHOST', '127.0.0.1'),
            'PORT': os.environ.get('PGPORT', '5432'),
            'CONN_MAX_AGE': 600,
        }
    }

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Security & CORS
raw_cors = os.environ.get('CORS_ALLOWED_ORIGINS')
if raw_cors:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in raw_cors.split(',') if o.strip()]
    CORS_ALLOW_ALL_ORIGINS = False
else:
    if DEBUG:
        CORS_ALLOW_ALL_ORIGINS = True
    else:
        CORS_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000']
        CORS_ALLOW_ALL_ORIGINS = False

CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

# Production Security Headers (Active when DEBUG=False)
if not DEBUG:
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'
    SECURE_HSTS_SECONDS = int(os.environ.get('SECURE_HSTS_SECONDS', 31536000))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_SSL_REDIRECT = os.environ.get('SECURE_SSL_REDIRECT', 'False').lower() == 'true'
    SESSION_COOKIE_SECURE = os.environ.get('SESSION_COOKIE_SECURE', 'False').lower() == 'true'
    CSRF_COOKIE_SECURE = os.environ.get('CSRF_COOKIE_SECURE', 'False').lower() == 'true'
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# REST Framework settings: Default to IsAuthenticated and scoped throttles
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ] if not DEBUG else [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'api.authentication.RentFlowJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'api.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '120/minute',
        'user': '300/minute',
        'login': '15/minute',
        'public_booking': '25/minute',
        'public_quote': '60/minute',
        'public_enquiry': '30/minute',
        'public_branches': '120/minute',
    },
    'UNAUTHENTICATED_USER': None,
    'EXCEPTION_HANDLER': 'api.exceptions.custom_exception_handler',
}

# Static & Media files
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# CSRF Trusted Origins
raw_csrf = os.environ.get('CSRF_TRUSTED_ORIGINS')
if raw_csrf:
    CSRF_TRUSTED_ORIGINS = [o.strip() for o in raw_csrf.split(',') if o.strip()]
else:
    CSRF_TRUSTED_ORIGINS = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:8000',
        'http://127.0.0.1:8000',
    ]

# Celery & Redis Configuration
CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', os.environ.get('REDIS_URL', 'redis://localhost:6379/0'))
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', CELERY_BROKER_URL)
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 30 * 60  # 30 minutes
CELERY_WORKER_MAX_TASKS_PER_CHILD = 1000

# Production-safe Structured Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '[{asctime}] {levelname} {name} {process:d} {thread:d} - {message}',
            'style': '{',
        },
        'simple': {
            'format': '[{asctime}] {levelname} {name} - {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose' if not DEBUG else 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO'),
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': os.environ.get('DJANGO_LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'api': {
            'handlers': ['console'],
            'level': os.environ.get('APP_LOG_LEVEL', 'INFO'),
            'propagate': False,
        },
    },
}

APPEND_SLASH = False

# Email Configuration (Brevo Transactional Email & Standard Django)
EMAIL_PROVIDER = os.environ.get('EMAIL_PROVIDER', 'brevo').strip().lower()
BREVO_API_KEY = os.environ.get('BREVO_API_KEY', '').strip()
BREVO_API_URL = os.environ.get('BREVO_API_URL', 'https://api.brevo.com/v3/smtp/email').strip()
BREVO_TIMEOUT = int(os.environ.get('BREVO_TIMEOUT', '10'))
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', 'RentFlow <no-reply@rentflow.app>').strip()
FRONTEND_URL = os.environ.get('FRONTEND_URL', os.environ.get('APP_URL', 'http://localhost:3000')).strip()

# Standard Django mail settings (kept for backend compatibility)
EMAIL_BACKEND = os.environ.get(
    'EMAIL_BACKEND',
    'django.core.mail.backends.console.EmailBackend' if DEBUG else 'django.core.mail.backends.smtp.EmailBackend'
)
EMAIL_HOST = os.environ.get('EMAIL_HOST', 'localhost')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', 587))
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', 'True').lower() == 'true'
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')

# Testing execution flag
import sys
TESTING = ('test' in sys.argv)

# Production Email & URL Configuration Validation
if not DEBUG and not TESTING:
    if EMAIL_PROVIDER == 'brevo' and not BREVO_API_KEY:
        raise ImproperlyConfigured('BREVO_API_KEY environment variable is required when EMAIL_PROVIDER=brevo and DEBUG=False.')
    if FRONTEND_URL.startswith(('http://localhost', 'http://127.0.0.1')):
        raise ImproperlyConfigured('FRONTEND_URL must not point to localhost in production (DEBUG=False).')
    if not FRONTEND_URL.startswith('https://'):
        raise ImproperlyConfigured('FRONTEND_URL must use HTTPS in production (DEBUG=False).')
