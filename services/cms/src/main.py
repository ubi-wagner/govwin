"""CMS/CRM Service — Dormant for V1. Placeholder for future content and CRM capabilities."""
from fastapi import FastAPI

app = FastAPI(title="RFP Pipeline CMS", version="0.1.0")


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "cms", "note": "Not deployed in V1"}
