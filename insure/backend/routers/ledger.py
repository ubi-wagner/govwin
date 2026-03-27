from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database.models import ActionType, Entity, LeadLedger
from database.session import get_db

router = APIRouter(prefix="/api/ledger", tags=["ledger"])


class LedgerEntry(BaseModel):
    entity_id: int
    action_type: str


@router.post("")
def create_ledger_event(body: LedgerEntry, db: Session = Depends(get_db)):
    try:
        # Validate action type
        try:
            action = ActionType(body.action_type)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid action_type. Must be one of: {[a.value for a in ActionType]}",
            )

        # Validate entity exists
        entity = db.query(Entity).filter(Entity.id == body.entity_id).first()
        if not entity:
            raise HTTPException(status_code=404, detail="Entity not found")

        event = LeadLedger(entity_id=body.entity_id, action_type=action)
        db.add(event)
        db.commit()
        db.refresh(event)

        return {
            "data": {
                "id": event.id,
                "entity_id": event.entity_id,
                "action_type": event.action_type.value,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        console_error = f"[POST /api/ledger] Error: {e}"
        print(console_error)
        raise HTTPException(status_code=500, detail="Failed to create ledger event")
