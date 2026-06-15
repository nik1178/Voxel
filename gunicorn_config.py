import eventlet
eventlet.monkey_patch()

worker_class = 'eventlet'
bind = '0.0.0.0:8000'
# You can add more Gunicorn settings here if needed, e.g., workers = 2, timeout = 30