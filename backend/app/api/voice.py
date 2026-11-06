from fastapi import APIRouter, File, Response, UploadFile

from app.core.config import get_settings
from app.core.errors import AppError
from app.providers.speech import get_stt, get_tts
from app.schemas import SynthesizeRequest, TranscriptionOut

router = APIRouter(prefix="/voice", tags=["voice"])

_AUDIO_TYPES = ("audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4")
_MIN_AUDIO_BYTES = 1024  # anything smaller is effectively silence/an aborted recording


@router.post("/transcribe", response_model=TranscriptionOut)
async def transcribe(file: UploadFile = File(...)) -> TranscriptionOut:
    s = get_settings()
    stt = get_stt(s)  # fail fast (503) before reading audio if voice is disabled
    content_type = (file.content_type or "").split(";")[0]
    if content_type not in _AUDIO_TYPES:
        raise AppError("Unsupported audio format.", code="unsupported_audio")
    audio = await file.read(s.max_audio_mb * 1024 * 1024 + 1)
    if len(audio) > s.max_audio_mb * 1024 * 1024:
        raise AppError("Recording is too long.", code="audio_too_large", status_code=413)
    if len(audio) < _MIN_AUDIO_BYTES:
        raise AppError("No audio was captured. Please try again.", code="empty_audio")
    text, lang = stt.transcribe(audio, file.filename or "audio.webm", content_type)
    del audio  # not retained
    if not text.strip():
        raise AppError("I couldn't hear any speech. Please try again.", code="no_speech")
    return TranscriptionOut(text=text.strip(), language=lang)


@router.post("/synthesize", responses={200: {"content": {"audio/mpeg": {}}}})
def synthesize(req: SynthesizeRequest) -> Response:
    tts = get_tts(get_settings())
    return Response(content=tts.synthesize(req.text, req.language), media_type=tts.media_type)
