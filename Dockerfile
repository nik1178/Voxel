FROM python:3.10-slim-buster

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The server.py and python/ directory will be mounted as volumes,
# so no need to COPY them here.

CMD ["gunicorn", "--worker-class", "eventlet", "--bind", "0.0.0.0:8000", "server:app"]