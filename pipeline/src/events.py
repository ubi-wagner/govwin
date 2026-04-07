"""Event emission for the three event rivers."""


async def emit_opportunity_event(conn, event_type: str, opportunity_id: str | None = None, source: str | None = None, metadata: dict | None = None) -> None:
    try:
        await conn.execute(
            "INSERT INTO opportunity_events (event_type, opportunity_id, source, metadata) VALUES ($1, $2, $3, $4)",
            event_type, opportunity_id, source, metadata or {},
        )
    except Exception as e:
        print(f"[emitOpportunityEvent] Error: {e}")


async def emit_customer_event(conn, event_type: str, tenant_id: str | None = None, user_id: str | None = None, metadata: dict | None = None) -> None:
    try:
        await conn.execute(
            "INSERT INTO customer_events (event_type, tenant_id, user_id, metadata) VALUES ($1, $2, $3, $4)",
            event_type, tenant_id, user_id, metadata or {},
        )
    except Exception as e:
        print(f"[emitCustomerEvent] Error: {e}")
