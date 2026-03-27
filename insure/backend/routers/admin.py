from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/seed")
def run_seed():
    """Trigger the seed script to populate mock data. Idempotent-safe for demo."""
    try:
        from scripts.seed import seed
        seed()
        return {"data": {"message": "Seed completed successfully"}}
    except Exception as e:
        console_error = f"[POST /api/admin/seed] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail=f"Seed failed: {e}")
