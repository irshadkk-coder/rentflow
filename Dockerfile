# ==============================================================================
# Stage 1: Build the React + Vite Frontend
# ==============================================================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Install dependencies with clean install
COPY package*.json ./
RUN npm ci

# Copy frontend source and build configuration
COPY tsconfig*.json vite.config.ts index.html ./
COPY src/ ./src/

# Compile production React bundle (output into /app/dist)
RUN npm run build

# ==============================================================================
# Stage 2: Production Python Runtime (Django + Gunicorn + Celery)
# ==============================================================================
FROM python:3.11-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend

# Install OS dependencies needed for runtime and health checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Install Python production dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy Django backend
COPY backend/ /app/backend/

# Copy compiled frontend from Stage 1 into /app/frontend_dist
COPY --from=frontend-builder /app/dist /app/frontend_dist

# Create static and media directories
RUN mkdir -p /app/backend/staticfiles /app/backend/media

# Collect Django static assets (admin, rest_framework, etc.)
RUN python /app/backend/manage.py collectstatic --noinput

# Non-root user for security
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app
USER appuser

EXPOSE 8000

# Health check against Django health endpoint
HEALTHCHECK --interval=20s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/health/ || exit 1

WORKDIR /app/backend

# Default entrypoint starts Gunicorn with production configuration
CMD ["gunicorn", "--config", "gunicorn.conf.py", "rentflow_backend.wsgi:application"]
