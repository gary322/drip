FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
# MediaPipe depends on OpenCV which expects libGL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir --default-timeout=120 -r requirements.txt

COPY app ./app

EXPOSE 8090

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
