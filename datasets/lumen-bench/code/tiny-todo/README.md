# tiny-todo

A minimal FastAPI + SQLite todo service used as a fixture for the
Lumen code-RAG benchmark. Small enough (≈300 LOC) that every answer
the model gives about it can be verified by eye.

## Run

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## Endpoints

- `POST /todos` — create a todo (auth required)
- `GET /todos` — list your todos (auth required)
- `PATCH /todos/{id}` — mark complete / rename
- `DELETE /todos/{id}` — delete
- `POST /auth/signup` and `POST /auth/login` — issue JWT

## Structure

- `main.py` — FastAPI app + routes
- `models.py` — SQLAlchemy models
- `auth.py` — bcrypt password hashing + PyJWT tokens
- `db.py` — engine + session
- `settings.py` — config loaded from env
