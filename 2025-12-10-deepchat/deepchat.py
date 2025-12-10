#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from tqdm import tqdm
import chromadb
import ollama

# -------------------------
# CONFIG
# -------------------------
EMBED_MODEL = "nomic-embed-text"  # Ollama embedding model
CHAT_MODEL = "llama3.2"  # Ollama chat model
VECTOR_DB_PATH = ".deepchat_store"


# -------------------------
# INDEX + CHUNK CODEBASE
# -------------------------
def load_code_files(root):
    exts = {".py", ".js", ".ts", ".java", ".go", ".rs", ".cpp", ".c", ".cs"}
    files = []

    for file in Path(root).rglob("*"):
        if file.suffix.lower() in exts:
            try:
                content = file.read_text(errors="ignore")
                if content.strip():
                    files.append((str(file), content))
            except:
                pass

    return files


def chunk_text(text, max_lines=40):
    """Simple chunker: split code by fixed number of lines."""
    lines = text.split("\n")
    chunks = []

    for i in range(0, len(lines), max_lines):
        chunk = "\n".join(lines[i : i + max_lines]).strip()
        if chunk:
            chunks.append(chunk)
    return chunks


# -------------------------
# BUILD VECTOR STORE
# -------------------------
def embed_text(text):
    """Get embedding vector."""
    resp = ollama.embeddings(model=EMBED_MODEL, prompt=text)
    return resp["embedding"]


def build_index(path):
    print(f"Indexing codebase at: {path}")

    chroma = chromadb.PersistentClient(path=VECTOR_DB_PATH)
    if "code" in [c.name for c in chroma.list_collections()]:
        chroma.delete_collection("code")

    col = chroma.create_collection("code")

    files = load_code_files(path)
    print(f"Found {len(files)} code files.")

    all_chunks = []
    for file_path, content in files:
        chunks = chunk_text(content)
        for c in chunks:
            all_chunks.append((file_path, c))

    print(f"Embedding {len(all_chunks)} chunks...")

    for idx, (fpath, chunk) in enumerate(tqdm(all_chunks)):
        emb = embed_text(chunk)

        col.add(
            ids=[str(idx)],
            embeddings=[emb],
            metadatas=[{"path": fpath}],
            documents=[chunk],
        )

    print("Index built successfully!")
    return col


# -------------------------
# QUERY + CHAT
# -------------------------
def retrieve(col, question, k=5):
    q_emb = embed_text(question)
    res = col.query(query_embeddings=[q_emb], n_results=k)

    docs = res["documents"][0]
    paths = res["metadatas"][0]
    return docs, paths


def answer_with_context(question, docs):
    context = "\n\n".join(docs)

    messages = [
        {
            "role": "system",
            "content": "You are an AI that explains code clearly and safely.",
        },
        {
            "role": "user",
            "content": f"Context from the codebase:\n{context}\n\nQuestion: {question}",
        },
    ]

    resp = ollama.chat(
        model=CHAT_MODEL,
        messages=messages,
    )

    return resp["message"]["content"]


# -------------------------
# CLI LOOP
# -------------------------
def chat_loop(col):
    print("\nDeepChat CLI — ask questions about your codebase.")
    print("Type 'quit' to exit.\n")

    while True:
        q = input("> ").strip()
        if q.lower() in {"quit", "exit"}:
            break
        if not q:
            continue

        docs, metas = retrieve(col, q)
        response = answer_with_context(q, docs)
        print("\n" + response + "\n")


# -------------------------
# MAIN
# -------------------------
def main():
    if len(sys.argv) != 2:
        print("Usage: python deepchat.py /path/to/codebase")
        sys.exit(1)

    project_path = sys.argv[1]

    # Build index if not present
    chroma = chromadb.PersistentClient(path=VECTOR_DB_PATH)
    try:
        col = chroma.get_collection("code")
        print("Using existing index.")
    except:
        col = build_index(project_path)

    chat_loop(col)


if __name__ == "__main__":
    main()
