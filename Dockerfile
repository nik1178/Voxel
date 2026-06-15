FROM python:3.10-slim-buster

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY gunicorn_config.py /app/gunicorn_config.py

CMD ["gunicorn", "-c", "gunicorn_config.py", "server:app"]