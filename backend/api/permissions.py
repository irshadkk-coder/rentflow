from rest_framework import permissions, exceptions


class IsAuthenticated(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and getattr(request.user, 'is_authenticated', False)):
            raise exceptions.NotAuthenticated('Unauthorized: Missing or invalid Bearer token.')
        return True


class IsOwner(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and getattr(request.user, 'is_authenticated', False)):
            raise exceptions.NotAuthenticated('Unauthorized: Missing or invalid Bearer token.')
        if getattr(request.user, 'role', '') != 'owner':
            raise exceptions.PermissionDenied("Forbidden: Requires owner role.")
        return True


class IsOwnerOrManager(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and getattr(request.user, 'is_authenticated', False)):
            raise exceptions.NotAuthenticated('Unauthorized: Missing or invalid Bearer token.')
        if getattr(request.user, 'role', '') not in ['owner', 'manager']:
            raise exceptions.PermissionDenied("Forbidden: Requires manager or owner role.")
        return True


class IsStaff(permissions.BasePermission):
    def has_permission(self, request, view):
        if not (request.user and getattr(request.user, 'is_authenticated', False)):
            raise exceptions.NotAuthenticated('Unauthorized: Missing or invalid Bearer token.')
        if getattr(request.user, 'role', '') not in ['owner', 'manager', 'staff']:
            raise exceptions.PermissionDenied("Forbidden: Action requires staff, manager, or owner role.")
        return True
