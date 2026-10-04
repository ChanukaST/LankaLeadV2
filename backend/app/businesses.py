import re


def normalize_business_name(name: str) -> str:
    value = name.casefold().replace("&", " and ")
    value = re.sub(r"\b(restaurant|rest|cafe|lk|sri lanka)\b", " ", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()
