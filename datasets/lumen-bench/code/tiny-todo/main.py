from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import current_user, hash_password, issue_token, verify_password
from db import Base, engine, get_db
from models import Todo, User
from settings import settings


Base.metadata.create_all(bind=engine)

app = FastAPI(title="tiny-todo")


# -------- schemas --------

class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TodoCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class TodoUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    done: bool | None = None


class TodoResponse(BaseModel):
    id: str
    title: str
    done: bool
    created_at: datetime
    completed_at: datetime | None

    class Config:
        from_attributes = True


# -------- auth --------

@app.post("/auth/signup", response_model=TokenResponse, status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    existing = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="email already registered")
    user = User(email=payload.email.lower(), password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    return TokenResponse(access_token=issue_token(user.id))


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="invalid credentials")
    return TokenResponse(access_token=issue_token(user.id))


# -------- todos --------

@app.post("/todos", response_model=TodoResponse, status_code=201)
def create_todo(
    payload: TodoCreate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    # Enforce the per-user cap so a runaway client can't fill the DB.
    count = db.execute(
        select(func.count(Todo.id)).where(Todo.user_id == user.id)
    ).scalar_one()
    if count >= settings.MAX_TODOS_PER_USER:
        raise HTTPException(
            status_code=409,
            detail=f"todo limit reached ({settings.MAX_TODOS_PER_USER})",
        )
    todo = Todo(user_id=user.id, title=payload.title.strip())
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@app.get("/todos", response_model=list[TodoResponse])
def list_todos(
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
    include_done: bool = True,
):
    stmt = select(Todo).where(Todo.user_id == user.id).order_by(Todo.created_at.desc())
    if not include_done:
        stmt = stmt.where(Todo.done.is_(False))
    return db.execute(stmt).scalars().all()


@app.patch("/todos/{todo_id}", response_model=TodoResponse)
def update_todo(
    todo_id: str,
    payload: TodoUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    todo = db.get(Todo, todo_id)
    if todo is None or todo.user_id != user.id:
        raise HTTPException(status_code=404, detail="todo not found")
    if payload.title is not None:
        todo.title = payload.title.strip()
    if payload.done is not None:
        # Only stamp completed_at when transitioning to done; wipe it on undo.
        if payload.done and not todo.done:
            todo.completed_at = datetime.now(timezone.utc)
        elif not payload.done and todo.done:
            todo.completed_at = None
        todo.done = payload.done
    db.commit()
    db.refresh(todo)
    return todo


@app.delete("/todos/{todo_id}", status_code=204)
def delete_todo(
    todo_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    todo = db.get(Todo, todo_id)
    if todo is None or todo.user_id != user.id:
        raise HTTPException(status_code=404, detail="todo not found")
    db.delete(todo)
    db.commit()


@app.get("/health")
def health():
    return {"status": "ok"}
