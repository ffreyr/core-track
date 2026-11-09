"""Tests for the /api/notes notepad endpoints."""

from fastapi.testclient import TestClient


def test_create_read_update_delete(client: TestClient) -> None:
    created = client.post("/api/notes", json={"title": "  Ideas  ", "body": "  - indented line\n"})
    assert created.status_code == 201
    note = created.json()
    assert note["title"] == "Ideas"  # title trimmed
    assert note["body"] == "  - indented line\n"  # body kept exactly
    assert note["is_pinned"] is False

    patched = client.patch(f"/api/notes/{note['id']}", json={"body": "new text", "is_pinned": True}).json()
    assert (patched["title"], patched["body"], patched["is_pinned"]) == ("Ideas", "new text", True)

    assert client.get(f"/api/notes/{note['id']}").json()["body"] == "new text"
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert client.get(f"/api/notes/{note['id']}").status_code == 404


def test_blank_note_is_rejected_but_body_only_is_fine(client: TestClient) -> None:
    assert client.post("/api/notes", json={"title": " ", "body": "\n "}).status_code == 422
    assert client.post("/api/notes", json={"body": "Just text"}).status_code == 201


def test_null_fields_and_unknown_fields_are_rejected(client: TestClient) -> None:
    note = client.post("/api/notes", json={"title": "A"}).json()
    assert client.patch(f"/api/notes/{note['id']}", json={"title": None}).status_code == 422
    assert client.post("/api/notes", json={"title": "A", "colour": "red"}).status_code == 422


def test_pinned_first_then_most_recently_edited(client: TestClient) -> None:
    first = client.post("/api/notes", json={"title": "First"}).json()
    client.post("/api/notes", json={"title": "Second"})
    client.post("/api/notes", json={"title": "Pinned", "is_pinned": True})
    client.patch(f"/api/notes/{first['id']}", json={"body": "edited"})

    titles = [n["title"] for n in client.get("/api/notes").json()]
    assert titles == ["Pinned", "First", "Second"]
    assert [n["title"] for n in client.get("/api/notes", params={"pinned": True}).json()] == ["Pinned"]


def test_search_matches_title_or_body_case_insensitively(client: TestClient) -> None:
    client.post("/api/notes", json={"title": "Shopping", "body": "milk, eggs"})
    client.post("/api/notes", json={"title": "Exam", "body": "Read chapter 4 about EGGS?"})
    client.post("/api/notes", json={"title": "Budget", "body": "Save 50% of income"})

    assert {n["title"] for n in client.get("/api/notes", params={"q": "eggs"}).json()} == {"Shopping", "Exam"}
    assert [n["title"] for n in client.get("/api/notes", params={"q": "shop"}).json()] == ["Shopping"]
    # LIKE wildcards are matched literally.
    assert [n["title"] for n in client.get("/api/notes", params={"q": "50%"}).json()] == ["Budget"]
    assert client.get("/api/notes", params={"q": "_"}).json() == []


def test_missing_note_is_404(client: TestClient) -> None:
    assert client.patch("/api/notes/999", json={"title": "x"}).status_code == 404
    assert client.delete("/api/notes/999").status_code == 404
