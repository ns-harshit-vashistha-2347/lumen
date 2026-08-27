import hashlib


from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)

from src.core.logging import get_logger
from src.interfaces.base_chunker import BaseChunker, Chunk
from src.interfaces.base_parser import ParsedUnit
from src.core.llm import get_llm
from langchain_core.messages import HumanMessage, SystemMessage


CONTEXT_SYSTEM_PROMPT = """Given a document excerpt, write ONE short sentence (<20 words) describing
what this excerpt is about, to help a search system understand its place in the document.
Do not summarize content, just describe its topic/role. Respond with only the sentence."""

def _generate_semantic_header(chunk_text: str) -> str:
    llm = get_llm(task="compress", temperature=0.0)  # small/fast model
    try:
        response = llm.invoke([
            SystemMessage(content=CONTEXT_SYSTEM_PROMPT),
            HumanMessage(content=chunk_text[:1500]),
        ])
        return response.content.strip()
    except Exception:
        return ""

    
logger = get_logger(__name__)

MARKDOWN_HEADERS_TO_SPLIT_ON = [
    ("#", "h1"),
    ("##", "h2"),
    ("###", "h3"),
]


def _deterministic_chunk_id(document_id: str, unit_index: int, chunk_index: int) -> str:
    raw = f"{document_id}:{unit_index}:{chunk_index}"
    logger.debug(f"Generated deterministic chunk ID: {raw}")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class RecursiveTokenChunker(BaseChunker):
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        self.markdown_splitter = MarkdownHeaderTextSplitter(
            headers_to_split_on=MARKDOWN_HEADERS_TO_SPLIT_ON,
        )

        self.token_splitter = (
            RecursiveCharacterTextSplitter.from_tiktoken_encoder(
                encoding_name="cl100k_base",
                chunk_size=self.chunk_size,
                chunk_overlap=self.chunk_overlap,
            )
        )

    def _looks_like_markdown(self, text: str) -> bool:
        return any(
            header in text
            for header, _ in MARKDOWN_HEADERS_TO_SPLIT_ON
        )

    def _build_context_header(self, metadata: dict) -> str:
        parts: list[str] = []

        title = metadata.get("doc_title")
        source = metadata.get("source")
        page = metadata.get("page_number")
        if title:
            parts.append(f"Document: {title}")
        if source:
            parts.append(f"Source file: {source}" + (f" (page {page})" if page else ""))

        section_path = " > ".join(metadata[key] for key in ("h1", "h2", "h3") if metadata.get(key))
        if section_path:
            parts.append(f"Section: {section_path}")

        return "\n".join(parts)

    def _is_low_quality(self, text: str) -> bool:
        stripped = text.strip()
        if len(stripped) < 40:
            return True
        if stripped.replace(" ", "").isdigit():         
            return True
        alpha_chars = sum(c.isalpha() for c in stripped)
        if alpha_chars < len(stripped) * 0.3:             
            return True
        return False

    def chunk(
        self,
        units: list[ParsedUnit],
        *,
        document_id: str,
        user_id: str | None = None,
    ) -> list[Chunk]:

        chunks: list[Chunk] = []
        chunk_index = 0

        for unit_index, unit in enumerate(units):

            # Tables and image OCR/captions are already small, self-contained
            # units. Passing them through the token splitter risks slicing a
            # markdown table in half; emit each as a single chunk instead.
            kind = unit.metadata.get("content_kind")
            if kind in ("table", "image"):
                combined_metadata = {
                    **unit.metadata,
                    "document_id": document_id,
                    "chunk_index": chunk_index,
                }
                combined_metadata["prev_chunk_id"] = (
                    chunks[-1].id
                    if chunks and chunks[-1].metadata.get("document_id") == document_id
                    else None
                )
                if user_id is not None:
                    combined_metadata["user_id"] = user_id
                header = self._build_context_header(combined_metadata)
                embedded_text = f"{header}\n\n{unit.content}" if header else unit.content
                chunks.append(
                    Chunk(
                        id=_deterministic_chunk_id(document_id, unit_index, chunk_index),
                        content=embedded_text,
                        metadata={
                            **combined_metadata,
                            "raw_content": unit.content,
                            "context_header": header,
                        },
                    )
                )
                chunk_index += 1
                continue

            if self._looks_like_markdown(unit.content):
                sections = self.markdown_splitter.split_text(
                    unit.content
                )

                section_texts = [
                    section.page_content
                    for section in sections
                ]

                section_metadatas = [
                    section.metadata
                    for section in sections
                ]

            else:
                section_texts = [unit.content]
                section_metadatas = [{}]

            for text, metadata in zip(
                section_texts,
                section_metadatas
            ):

                section_chunks = self.token_splitter.split_text(text)

                for chunk_text in section_chunks:
                    if self._is_low_quality(chunk_text):
                        continue

                    combined_metadata = {
                        **unit.metadata,
                        **metadata,
                        "document_id": document_id,
                        "chunk_index": chunk_index,
                    }
                    combined_metadata["prev_chunk_id"] = chunks[-1].id if chunks and chunks[-1].metadata.get("document_id") == document_id else None

                    if user_id is not None:
                        combined_metadata["user_id"] = user_id

                    header = self._build_context_header(combined_metadata)
                    embedded_text = f"{header}\n\n{chunk_text}" if header else chunk_text

                    chunks.append(
                        Chunk(
                            id=_deterministic_chunk_id(
                                document_id,
                                unit_index,
                                chunk_index,
                            ),
                            content=embedded_text,
                            metadata={
                                **combined_metadata,
                                "raw_content": chunk_text,
                                "context_header": header,
                            },
                        )
                    )

                    chunk_index += 1

        return chunks
    

def chunk_node(state: dict) -> dict:
    document_id = state["document_id"]
    user_id = state.get("user_id")
    units = state["parsed_units"]
    logger.info(f"Chunking {len(units)} parsed units for document {document_id}")

    chunker = RecursiveTokenChunker()
    chunks = chunker.chunk(units, document_id=document_id, user_id=user_id)

    if not chunks:
        raise ValueError(f"No chunks were created for document {document_id}. Please check the input data.")

    logger.info(f"Created {len(chunks)} chunks for document {document_id}")
    return {**state, "chunks": chunks}