import os
import multiprocessing

# Server socket
bind = os.environ.get('GUNICORN_BIND', '0.0.0.0:8000')
backlog = 2048

# Worker processes & threading
# Support environment variables GUNICORN_WORKERS and GUNICORN_THREADS
default_workers = (2 * multiprocessing.cpu_count()) + 1
workers = int(os.environ.get('GUNICORN_WORKERS', default_workers))
threads = int(os.environ.get('GUNICORN_THREADS', 2))
worker_class = 'gthread'
worker_connections = 1000
max_requests = int(os.environ.get('GUNICORN_MAX_REQUESTS', 2000))
max_requests_jitter = int(os.environ.get('GUNICORN_MAX_REQUESTS_JITTER', 200))

# Timeouts & Keepalive
timeout = int(os.environ.get('GUNICORN_TIMEOUT', 60))
graceful_timeout = int(os.environ.get('GUNICORN_GRACEFUL_TIMEOUT', 30))
keepalive = int(os.environ.get('GUNICORN_KEEPALIVE', 5))

# Process naming
proc_name = 'rentflow_gunicorn'

# Logging (stdout/stderr for container/cloud logging)
accesslog = '-'
errorlog = '-'
loglevel = os.environ.get('GUNICORN_LOG_LEVEL', 'info')
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'

# Security & Reverse Proxy Forwarding
forwarded_allow_ips = os.environ.get('GUNICORN_FORWARDED_ALLOW_IPS', '*')
secure_scheme_headers = {
    'X-FORWARDED-PROTOCOL': 'ssl',
    'X-FORWARDED-PROTO': 'https',
    'X-FORWARDED-SSL': 'on'
}
