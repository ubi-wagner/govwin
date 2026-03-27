import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.regions import router as regions_router
from routers.leads import router as leads_router
from routers.ledger import router as ledger_router
from routers.analyze import router as analyze_router
from routers.admin import router as admin_router


def _start_hunter_thread():
    """Launch the hunter polling loop in a daemon thread."""
    try:
        from agents.hunter import run_hunter_poll
        thread = threading.Thread(target=run_hunter_poll, daemon=True)
        thread.start()
        print("[main] Hunter background thread started")
    except Exception as e:
        print(f"[main] Failed to start hunter thread: {e}")


@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup
    if os.getenv("ENABLE_HUNTER", "true").lower() == "true":
        _start_hunter_thread()
    yield
    # Shutdown — daemon thread dies automatically


app = FastAPI(title="Insure Lead Engine", version="0.1.0", lifespan=lifespan)

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(regions_router)
app.include_router(leads_router)
app.include_router(ledger_router)
app.include_router(analyze_router)
app.include_router(admin_router)


@app.get("/health")
def health():
    return {"status": "ok"}
