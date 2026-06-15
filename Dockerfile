FROM python:3.10-slim-buster

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the Gunicorn configuration file
COPY gunicorn_config.py /app/gunicorn_config.py

# Command to run the application using Gunicorn with the config file
CMD ["gunicorn", "-c", "gunicorn_config.py", "server:app"]