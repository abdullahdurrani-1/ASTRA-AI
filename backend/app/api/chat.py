import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError
from app.core.security import current_user_id
from app.db.session import get_db
from app.models import Conversation, Message
from app.schemas import (
    ChatRequest,
    ChatResponse,
    ConversationList,
    ConversationOut,
    ConversationSummary,
    MessageOut,
)
from app.services.assistant import AssistantReply, respond, respond_stream

router = APIRouter(tags=["chat"])


def _get_conversation(db: Session, user_id: str, conversation_id: str) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user_id:
        raise NotFoundError("Conversation not found.")
    return conv


def _history(conv: Conversation, limit: int = 6) -> list[tuple[str, str]]:
    return [(m.role, m.content) for m in conv.messages[-limit:]]


def _persist(
    db: Session, conv: Conversation, question: str, req: ChatRequest, result: AssistantReply
) -> ChatResponse:
    db.add(conv)
    db.add(
        Message(
            conversation=conv,
            role="user",
            content=question,
            language=result.language,
            document_ids=req.document_ids,
            citations=[],
        )
    )
    reply = Message(
        conversation=conv,
        role="assistant",
        content=result.answer,
        language=result.language,
        status=result.status,
        document_ids=req.document_ids,
        citations=[c.model_dump() for c in result.citations],
    )
    db.add(reply)
    db.commit()
    return ChatResponse(
        conversation_id=conv.id,
        message_id=reply.id,
        answer=result.answer,
        status=result.status,
        language=result.language,
        citations=result.citations,
        mock=result.mock,
        intent=result.intent,
        intent_stage=result.intent_stage,
        detected_language=result.detected_language,
        suggestions=result.suggestions,
        searched_question=result.searched_question,
    )


@router.post("/chat", response_model=ChatResponse)
def chat(
    req: ChatRequest, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> ChatResponse:
    question = req.question.strip()
    conv = (
        _get_conversation(db, user_id, req.conversation_id)
        if req.conversation_id
        else Conversation(user_id=user_id)
    )
    result = respond(
        db,
        get_settings(),
        user_id,
        question,
        req.document_ids,
        req.language,
        req.tz_offset_minutes,
        _history(conv),
    )
    return _persist(db, conv, question, req, result)


def _sse(event: str, data: object) -> str:
    # A stray surrogate must never abort a stream that has already started.
    text = json.dumps(data, ensure_ascii=False).encode("utf-8", "replace").decode("utf-8")
    return f"event: {event}\ndata: {text}\n\n"


@router.post("/chat/stream")
def chat_stream(
    req: ChatRequest, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> StreamingResponse:
    """Server-sent events: `delta` {text} while the answer is written, then `done` with the same
    body as POST /chat. Conversational replies send only `done`."""
    question = req.question.strip()
    conv = (
        _get_conversation(db, user_id, req.conversation_id)
        if req.conversation_id
        else Conversation(user_id=user_id)
    )
    history = _history(conv)

    def events() -> Iterator[str]:
        try:
            for kind, payload in respond_stream(
                db,
                get_settings(),
                user_id,
                question,
                req.document_ids,
                req.language,
                req.tz_offset_minutes,
                history,
            ):
                if kind == "delta":
                    yield _sse("delta", {"text": payload})
                else:
                    assert isinstance(payload, AssistantReply)
                    yield _sse("done", _persist(db, conv, question, req, payload).model_dump())
        except AppError as e:
            yield _sse("error", {"code": e.code, "message": str(e)})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


_TITLE_CHARS = 60


@router.get("/conversations", response_model=ConversationList)
def list_conversations(
    db: Session = Depends(get_db), user_id: str = Depends(current_user_id), limit: int = 50
) -> ConversationList:
    """Recent conversations, newest activity first; the title is the first question."""
    last = func.max(Message.created_at).label("last")
    rows = db.execute(
        select(Conversation, last, func.count(Message.id))
        .join(Message, Message.conversation_id == Conversation.id)
        .where(Conversation.user_id == user_id)
        .group_by(Conversation.id)
        .order_by(last.desc())
        .limit(min(max(limit, 1), 200))
    ).all()
    out = []
    for conv, updated, count in rows:
        first = (
            db.scalars(
                select(Message.content)
                .where(Message.conversation_id == conv.id, Message.role == "user")
                .order_by(Message.created_at)
                .limit(1)
            ).first()
            or ""
        )
        title = " ".join(first.split())
        if len(title) > _TITLE_CHARS:
            title = title[: _TITLE_CHARS - 1] + "…"
        out.append(
            ConversationSummary(
                id=conv.id,
                title=title,
                created_at=conv.created_at,
                updated_at=updated,
                message_count=count,
            )
        )
    return ConversationList(conversations=out)


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: str, db: Session = Depends(get_db), user_id: str = Depends(current_user_id)
) -> ConversationOut:
    conv = _get_conversation(db, user_id, conversation_id)
    return ConversationOut(
        id=conv.id,
        created_at=conv.created_at,
        messages=[MessageOut.model_validate(m) for m in conv.messages],
    )
