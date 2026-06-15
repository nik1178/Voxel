worker_class = 'gthread' # Use gthread workers for Flask-Sock
bind = '0.0.0.0:8000'
workers = 1 # Start with 1 worker, adjust based on CPU/memory
threads = 8 # Number of threads per worker, adjust based on concurrency needs
timeout = 120 # Worker timeout in seconds, adjust if chunks take longer to load
# You can add more Gunicorn settings here if needed