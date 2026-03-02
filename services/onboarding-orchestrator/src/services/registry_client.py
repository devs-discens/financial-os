import logging
from .http_client import get_http_client

logger = logging.getLogger("onboarding")


class RegistryClient:
    def __init__(self, registry_url: str):
        self.registry_url = registry_url

    async def list_institutions(self) -> list[dict]:
        url = f"{self.registry_url}/registry/institutions"
        logger.debug("Registry → GET %s", url)
        client = await get_http_client()
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()["institutions"]
        logger.debug("Registry ← %d institutions returned", len(data))
        return data

    async def get_institution(self, institution_id: str) -> dict | None:
        url = f"{self.registry_url}/registry/institutions/{institution_id}"
        logger.debug("Registry → GET %s", url)
        client = await get_http_client()
        resp = await client.get(url)
        if resp.status_code == 404:
            logger.debug("Registry ← %s not found (404)", institution_id)
            return None
        resp.raise_for_status()
        data = resp.json()
        logger.debug(
            "Registry ← institution=%s status=%s baseUrl=%s",
            institution_id, data.get("status"), data.get("baseUrl"),
        )
        return data

    async def is_live(self, institution_id: str) -> bool:
        inst = await self.get_institution(institution_id)
        live = inst is not None and inst.get("status") == "live"
        logger.debug("Registry → is_live(%s) = %s", institution_id, live)
        return live
