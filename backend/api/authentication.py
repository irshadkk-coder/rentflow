import jwt
from django.conf import settings
from rest_framework import authentication, exceptions
from .models import User, Tenant


class RentFlowUser:
    """User representation verified against PostgreSQL database."""
    def __init__(self, user_id: str, email: str, name: str, role: str, tenant_id: str, token_version: int = 1, db_user: User | None = None):
        self.id = user_id
        self.email = email
        self.name = name
        self.role = role
        self.tenant_id = tenant_id
        self.token_version = token_version
        self.is_authenticated = True
        self._db_user = db_user

    @property
    def db_user(self):
        if self._db_user is None:
            self._db_user = User.objects.select_related('tenant').filter(id=self.id).first()
        return self._db_user

    @property
    def pk(self):
        return self.id

    @property
    def is_anonymous(self):
        return False

    def __str__(self):
        return f"{self.name} <{self.email}> [{self.role} @ {self.tenant_id}] (v{self.token_version})"


class RentFlowJWTAuthentication(authentication.BaseAuthentication):
    """
    Decodes Bearer JWT tokens and verifies against PostgreSQL:
    1. Cryptographic signature and expiration verification (HS256).
    2. User existence verification in database.
    3. Tenant isolation verification (token tenantId matches user tenant_id in DB).
    4. Account activity verification.
    5. Role freshness (uses current database role, never blindly trusting token claims).
    6. Token version revocation (rejects tokens issued prior to latest password reset).
    """
    def authenticate_header(self, request):
        return 'Bearer realm="api"'

    def authenticate(self, request):
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None

        token = auth_header.split(' ', 1)[1].strip()
        jwt_secret = getattr(settings, 'JWT_SECRET', None)
        if not jwt_secret:
            raise exceptions.AuthenticationFailed('Unauthorized: Missing JWT configuration.')

        try:
            payload = jwt.decode(token, jwt_secret, algorithms=['HS256'])
        except jwt.ExpiredSignatureError:
            raise exceptions.AuthenticationFailed('Unauthorized: Token has expired.')
        except jwt.InvalidTokenError:
            raise exceptions.AuthenticationFailed('Unauthorized: Invalid token.')

        user_id = payload.get('id')
        token_tenant_id = payload.get('tenantId') or payload.get('tenant_id')
        token_version = payload.get('tokenVersion') or payload.get('token_version')

        if not user_id or not token_tenant_id:
            raise exceptions.AuthenticationFailed('Unauthorized: Token missing required identity claims.')

        # Database verification: Verify user exists in PostgreSQL
        try:
            db_user = User.objects.select_related('tenant').get(id=user_id)
        except User.DoesNotExist:
            raise exceptions.AuthenticationFailed('Unauthorized: Invalid or expired token.')

        # Tenant isolation: Verify user belongs to the tenant claimed in the token
        if db_user.tenant_id != token_tenant_id:
            raise exceptions.AuthenticationFailed('Unauthorized: Invalid or expired token.')

        # Verify account is active and allowed to authenticate
        if getattr(db_user, 'is_active', True) is False:
            raise exceptions.AuthenticationFailed('Unauthorized: User account is inactive.')

        if not db_user.is_email_verified:
            raise exceptions.AuthenticationFailed('Unauthorized: User email is not verified.')

        # Secure Token Revocation Check:
        # Every token must possess a tokenVersion claim that matches the user's active database token_version.
        # Any token issued before the user's latest password reset is rejected immediately.
        if token_version is None or token_version != db_user.token_version:
            raise exceptions.AuthenticationFailed('Unauthorized: Token has been revoked. Please log in again.')

        # Use current database record for all attributes (especially role)
        # rather than trusting payload claims
        user = RentFlowUser(
            user_id=db_user.id,
            email=db_user.email,
            name=db_user.name,
            role=db_user.role,
            tenant_id=db_user.tenant_id,
            token_version=db_user.token_version,
            db_user=db_user
        )

        return (user, token)
