"""Persistent, unverified prototype reports. No messages are sent to the City."""
import json
import math
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

REPORT_DB = Path(__file__).resolve().parents[1] / 'data/out/luma-reports.sqlite'
router = APIRouter(prefix='/api/reports', tags=['Reports'])


def connect():
    REPORT_DB.parent.mkdir(exist_ok=True, parents=True)
    db = sqlite3.connect(REPORT_DB)
    db.row_factory = sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, payload TEXT NOT NULL, delete_token TEXT NOT NULL)')
    return db


class ReportRequest(BaseModel):
    issue_type: Literal['signal_silent', 'no_locator_tone', 'button_hard_to_find', 'tactile_problem', 'obstruction', 'other']
    location_name: str = Field(min_length=1, max_length=200)
    coordinates: tuple[float, float]
    notes: str = Field('', max_length=2000)
    location_source: Literal['selected', 'gps', 'route_preview'] = 'selected'
    accuracy_metres: float | None = Field(None, ge=0, le=100000, allow_inf_nan=False)

    @field_validator('coordinates')
    @classmethod
    def coordinate(cls, c):
        if not all(math.isfinite(v) for v in c) or not (-79.8 < c[0] < -79 and 43.5 < c[1] < 44):
            raise ValueError('Choose a location in Toronto.')
        return c

    @field_validator('location_name')
    @classmethod
    def nonempty_name(cls, value):
        if not value.strip():
            raise ValueError('Enter a location name.')
        return value.strip()


@router.post('', status_code=201)
def create_report(req: ReportRequest):
    report = dict(req.model_dump(), id=str(uuid4()), created_at=datetime.now(timezone.utc).isoformat(), status='unverified')
    token = secrets.token_urlsafe(32)
    with connect() as db:
        db.execute('INSERT INTO reports VALUES(?,?,?)', (report['id'], json.dumps(report), token))
    return dict(report, delete_token=token)


@router.get('/{report_id}')
def read_report(report_id: UUID):
    with connect() as db:
        row = db.execute('SELECT payload FROM reports WHERE id=?', (str(report_id),)).fetchone()
    if not row:
        raise HTTPException(404, 'Report not found.')
    return json.loads(row['payload'])


@router.delete('/{report_id}', status_code=204)
def delete_report(report_id: UUID, x_report_token: str = Header('')):
    with connect() as db:
        row = db.execute('SELECT delete_token FROM reports WHERE id=?', (str(report_id),)).fetchone()
        if not row:
            raise HTTPException(404, 'Report not found.')
        if not secrets.compare_digest(row['delete_token'], x_report_token):
            raise HTTPException(403, 'This device does not have the key to delete this report.')
        db.execute('DELETE FROM reports WHERE id=?', (str(report_id),))
