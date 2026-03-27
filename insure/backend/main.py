import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Insure Lead Engine", version="0.1.0")

frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from routers.regions import router as regions_router
from routers.leads import router as leads_router
from routers.ledger import router as ledger_router
from routers.analyze import router as analyze_router

app.include_router(regions_router)
app.include_router(leads_router)
app.include_router(ledger_router)
app.include_router(analyze_router)


@app.get("/health")
def health():
    return {"status": "ok"}
