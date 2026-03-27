from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from database.models import (
    ActionType,
    Contact,
    Entity,
    EntityAsset,
    LeadLedger,
)
from database.session import get_db

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("")
def list_leads(sort: str = "date", db: Session = Depends(get_db)):
    try:
        # Subquery: latest action per entity
        latest_action_sq = (
            db.query(
                LeadLedger.entity_id,
                func.max(LeadLedger.created_at).label("max_created"),
            )
            .group_by(LeadLedger.entity_id)
            .subquery()
        )

        latest_action_type = (
            db.query(LeadLedger.entity_id, LeadLedger.action_type)
            .join(
                latest_action_sq,
                (LeadLedger.entity_id == latest_action_sq.c.entity_id)
                & (LeadLedger.created_at == latest_action_sq.c.max_created),
            )
            .subquery()
        )

        query = db.query(Entity, latest_action_type.c.action_type).outerjoin(
            latest_action_type,
            Entity.id == latest_action_type.c.entity_id,
        )

        if sort == "coast_distance":
            # Sort by coast_distance from characteristics JSONB (nulls last)
            query = query.order_by(
                func.coalesce(
                    Entity.characteristics["coast_distance"].as_float(), 9999
                )
            )
        else:
            query = query.order_by(desc(Entity.created_at))

        results = query.all()

        data = []
        for entity, action_type in results:
            data.append(
                {
                    "id": entity.id,
                    "name": entity.name,
                    "address": entity.address,
                    "county": entity.county,
                    "latitude": entity.latitude,
                    "longitude": entity.longitude,
                    "characteristics": entity.characteristics,
                    "created_at": entity.created_at.isoformat() if entity.created_at else None,
                    "latest_action": action_type.value if action_type else None,
                }
            )

        return {"data": data}
    except Exception as e:
        console_error = f"[GET /api/leads] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail="Failed to load leads")


@router.get("/{lead_id}")
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    try:
        entity = db.query(Entity).filter(Entity.id == lead_id).first()
        if not entity:
            raise HTTPException(status_code=404, detail="Lead not found")

        contacts = db.query(Contact).filter(Contact.entity_id == lead_id).all()
        assets = db.query(EntityAsset).filter(EntityAsset.entity_id == lead_id).all()

        # Check if emails exist in characteristics
        chars = entity.characteristics or {}
        emails = chars.get("emails") if isinstance(chars, dict) else None

        return {
            "data": {
                "id": entity.id,
                "name": entity.name,
                "address": entity.address,
                "county": entity.county,
                "latitude": entity.latitude,
                "longitude": entity.longitude,
                "characteristics": entity.characteristics,
                "contacts": [
                    {"name": c.name, "title": c.title} for c in contacts
                ],
                "assets": [
                    {
                        "doc_type": a.doc_type.value,
                        "extracted_text": a.extracted_text,
                    }
                    for a in assets
                ],
                "emails": emails,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        console_error = f"[GET /api/leads/{lead_id}] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail="Failed to load lead")
