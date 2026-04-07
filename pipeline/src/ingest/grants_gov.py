"""grants_gov opportunity ingester — TODO: copy from existing codebase and adapt."""


class Grants_govIngester:
    """Fetches opportunities from grants_gov API."""

    async def run(self, conn, mode: str = "incremental") -> dict:
        # TODO: Implement
        return {"opportunities_fetched": 0, "opportunities_new": 0}
