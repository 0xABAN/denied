from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    tiger_database_url: str
    backend_api_token: str

    @classmethod
    def from_environment(cls) -> "Settings":
        database_url = os.environ.get("TIGER_DATABASE_URL")
        api_token = os.environ.get("BACKEND_API_TOKEN")
        if not database_url or not api_token:
            raise RuntimeError(
                "TIGER_DATABASE_URL and BACKEND_API_TOKEN must both be configured."
            )
        return cls(tiger_database_url=database_url, backend_api_token=api_token)
