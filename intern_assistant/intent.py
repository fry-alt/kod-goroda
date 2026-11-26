"""Match independent clues in a question against a small, curated knowledge base."""
import re
from functools import cache

WORDS = re.compile(r"[а-яa-z0-9]+")
KEYBOARD = str.maketrans("qwertyuiop[]asdfghjkl;'zxcvbnm,.", "йцукенгшщзхъфывапролджэячсмитьбю")


def normalize(text: str) -> tuple[str, ...]:
    if text.strip().lower() != "feedback" and re.fullmatch(r"[a-z\s\[\];',.!?0-9]+", text.lower()):
        text = text.lower().translate(KEYBOARD)
    return tuple(WORDS.findall(text.lower().replace("ё", "е")))


def one_edit(left: str, right: str) -> bool:
    if abs(len(left) - len(right)) > 1:
        return False
    index = next((i for i, (a, b) in enumerate(zip(left, right)) if a != b),
                 min(len(left), len(right)))
    if len(left) != len(right):
        shorter, longer = sorted((left, right), key=len)
        return shorter[index:] == longer[index + 1:]
    return (left[index + 1:] == right[index + 1:]
            or left[index:index + 2] == right[index:index + 2][::-1]
            and left[index + 2:] == right[index + 2:])


def clue_score(words: tuple[str, ...], clue: str) -> int:
    if clue.endswith("*"):
        stem = clue[:-1]
        if any(word.startswith(stem) for word in words):
            return 3
        if len(stem) >= 5 and any(
            one_edit(word[:length], stem)
            for word in words
            for length in (len(stem), len(stem) + 1, len(stem) - 1)
            if len(word) >= length
        ):
            return 1
    elif clue in words:
        return 3
    elif len(clue) >= 5 and any(one_edit(word, clue) for word in words):
        return 1
    return 0


@cache
def terms(expression: str) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(group.split("|")) for group in expression.split())


def score(words: tuple[str, ...], expression: str) -> int:
    scores = [max(clue_score(words, clue) for clue in group) for group in terms(expression)]
    if not all(scores):
        return 0
    # Short one-word typo matches need corroboration from another clue.
    if scores == [1] and max(len(clue.rstrip("*")) for clue in terms(expression)[0]) < 7:
        return 0
    return sum(scores) + 2 * (len(scores) - 1)
