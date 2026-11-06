def test_health_reports_mock_mode_without_credentials(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["mock_mode"] is True
    assert body["providers"] == {"embeddings": "mock", "llm": "mock"}
    assert body["voice"] == {"stt": False, "tts": False}


def test_unknown_route_is_404_json(client):
    assert client.get("/api/nope").status_code == 404


def test_openapi_available(client):
    assert client.get("/openapi.json").status_code == 200
