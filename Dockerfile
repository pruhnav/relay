FROM python:3.12-slim

WORKDIR /workspace

RUN pip install --no-cache-dir fastapi==0.115.6 uvicorn[standard]==0.32.1 python-multipart==0.0.20 'openai>=2.0.0,<3.0.0' runloop_api_client==1.28.0

EXPOSE 8000

CMD ["tail", "-f", "/dev/null"]
