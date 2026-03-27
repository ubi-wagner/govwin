from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database.models import DocType, Entity, EntityAsset
from database.session import get_db
from services.ai_analyzer import deep_dive

router = APIRouter(prefix="/api/leads", tags=["analyze"])


@router.post("/{lead_id}/analyze")
def analyze_lead(lead_id: int, db: Session = Depends(get_db)):
    try:
        entity = db.query(Entity).filter(Entity.id == lead_id).first()
        if not entity:
            raise HTTPException(status_code=404, detail="Lead not found")

        # Fetch all three document types
        assets = db.query(EntityAsset).filter(EntityAsset.entity_id == lead_id).all()

        sunbiz_text = ""
        audit_text = ""
        ie_text = ""
        for asset in assets:
            if asset.doc_type == DocType.SUNBIZ:
                sunbiz_text = asset.extracted_text or ""
            elif asset.doc_type == DocType.AUDIT:
                audit_text = asset.extracted_text or ""
            elif asset.doc_type == DocType.IE_REPORT:
                ie_text = asset.extracted_text or ""

        if not any([sunbiz_text, audit_text, ie_text]):
            raise HTTPException(
                status_code=400,
                detail="No documents found for this lead. Upload documents first.",
            )

        # Run the Kill → Cook pipeline
        extracted, emails = deep_dive(
            entity_name=entity.name,
            entity_address=entity.address or "",
            entity_county=entity.county or "",
            sunbiz_text=sunbiz_text,
            audit_text=audit_text,
            ie_text=ie_text,
        )

        # Save extracted data and emails to entity characteristics
        chars = entity.characteristics or {}
        chars.update(extracted)
        chars["emails"] = emails
        entity.characteristics = chars

        # Force SQLAlchemy to detect the JSONB change
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(entity, "characteristics")

        db.commit()

        return {
            "data": {
                "extracted": extracted,
                "emails": emails,
            }
        }

    except HTTPException:
        raise
    except ValueError as e:
        console_error = f"[POST /api/leads/{lead_id}/analyze] Config error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        db.rollback()
        console_error = f"[POST /api/leads/{lead_id}/analyze] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail="Analysis failed. Check server logs.")
