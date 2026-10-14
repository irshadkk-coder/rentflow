from rest_framework.views import exception_handler


class EmailDeliveryError(Exception):
    """Raised when transactional email dispatch fails."""
    pass


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        if isinstance(response.data, dict):
            if 'detail' in response.data and 'error' not in response.data:
                response.data['error'] = response.data['detail']
        elif isinstance(response.data, list):
            first_err = str(response.data[0]) if response.data else 'Error'
            response.data = {'error': first_err, 'details': response.data}
    return response
