from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Folder, Paper
from app.schemas import FolderCreate, FolderOut, FolderUpdate

router = APIRouter(prefix="/api/folders", tags=["folders"])


@router.get("")
def list_folders(
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folders = db.query(Folder).order_by(Folder.sort_order.asc(), Folder.created_at.asc()).all()
    counts = dict(
        db.query(Paper.folder_id, func.count(Paper.id)).group_by(Paper.folder_id).all()
    )
    total_count = db.query(func.count(Paper.id)).scalar() or 0
    uncategorized_count = counts.get(None, 0)

    folder_items = [
        FolderOut(
            id=f.id,
            name=f.name,
            parent_id=f.parent_id,
            sort_order=f.sort_order,
            paper_count=counts.get(f.id, 0),
            created_at=f.created_at,
        )
        for f in folders
    ]
    return {
        "total_count": total_count,
        "uncategorized_count": uncategorized_count,
        "folders": folder_items,
    }


@router.post("", response_model=FolderOut)
def create_folder(
    payload: FolderCreate,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.parent_id:
        parent = db.query(Folder).filter(Folder.id == payload.parent_id).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")

    folder = Folder(name=payload.name.strip(), parent_id=payload.parent_id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return FolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        sort_order=folder.sort_order,
        paper_count=0,
        created_at=folder.created_at,
    )


@router.put("/{folder_id}", response_model=FolderOut)
def update_folder(
    folder_id: str,
    payload: FolderUpdate,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    if payload.name is not None:
        folder.name = payload.name.strip()
    if payload.parent_id is not None and payload.parent_id != folder_id:
        folder.parent_id = payload.parent_id or None
    if payload.sort_order is not None:
        folder.sort_order = payload.sort_order

    db.commit()
    db.refresh(folder)
    cnt = db.query(func.count(Paper.id)).filter(Paper.folder_id == folder.id).scalar() or 0
    return FolderOut(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        sort_order=folder.sort_order,
        paper_count=cnt,
        created_at=folder.created_at,
    )


@router.delete("/{folder_id}")
def delete_folder(
    folder_id: str,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = db.query(Folder).filter(Folder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Papers in this folder become uncategorized rather than deleted
    db.query(Paper).filter(Paper.folder_id == folder_id).update({"folder_id": None})
    db.delete(folder)
    db.commit()
    return {"ok": True}
