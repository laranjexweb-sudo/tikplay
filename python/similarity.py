import spacy
import numpy as np

nlp = spacy.load("pt_core_news_lg")


def rank_guess(guess: str, secret: str) -> int:
    guess_doc = nlp(guess.lower().strip())
    secret_doc = nlp(secret.lower().strip())

    if not guess_doc.has_vector or not secret_doc.has_vector:
        return 99999

    sim = guess_doc.similarity(secret_doc)
    rank = int((1 - sim) * 5000) + 1
    return max(1, rank)
