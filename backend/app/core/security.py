"""Identity for the MVP. Astra is single-user and local-only until real authentication is added.

Every data access is still filtered by this user ID,
so adding auth later only changes this function.
"""

from app.core.config import get_settings


def current_user_id() -> str:
    return get_settings().local_user_id
