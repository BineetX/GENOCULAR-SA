from __future__ import annotations

import asyncio
import json
import hmac
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel


router = APIRouter(prefix="/presentation", tags=["Temporary Presentation Launch"])

PRESENTATION_TOKEN = os.getenv(
    "GENOCULAR_PRESENTATION_TOKEN",
    "",
)
GENOCULAR_INITIATING_URL = os.getenv(
    "GENOCULAR_INITIATING_URL",
    "http://localhost:8080/initiating",
)


class LaunchRequest(BaseModel):
    command: str = "launch"
    scope: str = "all"
    group: str = "all"
    url: str | None = None


@dataclass
class Receiver:
    receiver_id: str
    name: str
    group: str
    queue: asyncio.Queue[dict[str, Any]]
    connected_at: float


receivers: dict[str, Receiver] = {}
receivers_lock = asyncio.Lock()


def require_presentation_token(
    authorization: str | None,
    token: str | None = None,
) -> None:
    if len(PRESENTATION_TOKEN) < 32:
        raise HTTPException(status_code=503, detail="Presentation controls are disabled")
    expected = f"Bearer {PRESENTATION_TOKEN}"
    if hmac.compare_digest(authorization or "", expected) or hmac.compare_digest(token or "", PRESENTATION_TOKEN):
        return

    raise HTTPException(
        status_code=401,
        detail="Invalid presentation token",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.get("/events")
async def presentation_events(
    request: Request,
    receiver_id: str | None = Query(default=None),
    name: str = Query(default="Unnamed laptop"),
    group: str = Query(default="all"),
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    require_presentation_token(authorization, token)
    resolved_receiver_id = (
        (receiver_id or "").strip()
        or f"receiver-{uuid.uuid4().hex[:12]}"
    )
    resolved_name = (name or "").strip() or "Unnamed laptop"
    resolved_group = (group or "").strip() or "all"

    receiver = Receiver(
        receiver_id=resolved_receiver_id,
        name=resolved_name,
        group=resolved_group,
        queue=asyncio.Queue(maxsize=10),
        connected_at=time.time(),
    )

    async with receivers_lock:
        receivers[resolved_receiver_id] = receiver

    async def event_stream():
        try:
            yield ": GENOCULAR receiver connected\n\n"

            while True:
                if await request.is_disconnected():
                    break

                try:
                    message = await asyncio.wait_for(receiver.queue.get(), timeout=15)
                    yield "event: presentation\n"
                    yield f"data: {json.dumps(message)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            async with receivers_lock:
                if receivers.get(resolved_receiver_id) is receiver:
                    receivers.pop(resolved_receiver_id, None)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/launch")
async def presentation_launch(
    payload: LaunchRequest | None = Body(default=None),
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    require_presentation_token(authorization, token)
    payload = payload or LaunchRequest()

    if payload.command.lower() != "launch":
        raise HTTPException(status_code=400, detail="Unsupported command")

    if payload.scope not in {"all", "group"}:
        raise HTTPException(status_code=400, detail="Scope must be 'all' or 'group'")

    event_id = str(uuid.uuid4())
    message = {
        "event": "OPEN_GENOCULAR",
        "id": event_id,
        "url": payload.url or GENOCULAR_INITIATING_URL,
        "scope": payload.scope,
        "group": payload.group,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    async with receivers_lock:
        targets = list(receivers.values())

    delivered: list[str] = []
    for receiver in targets:
        if payload.scope == "group" and receiver.group != payload.group:
            continue
        try:
            receiver.queue.put_nowait(message)
            delivered.append(receiver.receiver_id)
        except asyncio.QueueFull:
            continue

    return {
        "status": "broadcast",
        "event_id": event_id,
        "connected_receivers": len(targets),
        "delivered_count": len(delivered),
        "delivered_to": delivered,
        "url": message["url"],
    }


@router.get("/status")
async def presentation_status(
    token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
):
    require_presentation_token(authorization, token)

    async with receivers_lock:
        connected = list(receivers.values())

    return {
        "status": "ready",
        "connected_count": len(connected),
        "receivers": [
            {
                "receiver_id": receiver.receiver_id,
                "name": receiver.name,
                "group": receiver.group,
                "connected_at": receiver.connected_at,
            }
            for receiver in connected
        ],
    }
