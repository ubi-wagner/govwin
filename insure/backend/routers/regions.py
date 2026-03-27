from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import RegionOfInterest
from database.session import get_db

router = APIRouter(prefix="/api/regions", tags=["regions"])


class BoundingBox(BaseModel):
    north: float
    south: float
    east: float
    west: float


class RegionParams(BaseModel):
    stories: int = 3
    coast_distance: float = 5.0


class CreateRegionRequest(BaseModel):
    name: str
    bounding_box: BoundingBox
    parameters: RegionParams | None = None


@router.post("")
def create_region(body: CreateRegionRequest, db: Session = Depends(get_db)):
    try:
        if not body.name.strip():
            raise HTTPException(status_code=400, detail="Region name is required")

        region = RegionOfInterest(
            name=body.name.strip(),
            bounding_box=body.bounding_box.model_dump(),
            parameters=body.parameters.model_dump() if body.parameters else None,
        )
        db.add(region)
        db.commit()
        db.refresh(region)

        return {
            "data": {
                "id": region.id,
                "name": region.name,
                "status": region.status.value,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        console_error = f"[POST /api/regions] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail="Failed to create region")


@router.get("")
def list_regions(db: Session = Depends(get_db)):
    try:
        regions = db.query(RegionOfInterest).order_by(RegionOfInterest.created_at.desc()).all()
        return {
            "data": [
                {
                    "id": r.id,
                    "name": r.name,
                    "status": r.status.value,
                    "target_county": r.target_county,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in regions
            ]
        }
    except Exception as e:
        console_error = f"[GET /api/regions] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail="Failed to list regions")
