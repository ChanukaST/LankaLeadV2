FROM python:3.12-slim
WORKDIR /service
COPY pyproject.toml requirements.txt ./
RUN pip install --no-cache-dir -e .[dev]
COPY app ./app
COPY seed.py ./seed.py
