# fullbody-validator

Strict full-body validation service used by `profile.ingestPhotos` when:

- `FULLBODY_VALIDATOR_MODE=strict`
- `FULLBODY_VALIDATOR_URL` points to this service

## API

- `GET /healthz`
- `POST /validate`

`POST /validate` request (example):

```json
{
  "imageUrl": "https://...",
  "imageBase64": "...",
  "mimeType": "image/png",
  "checks": { "requireFeetVisible": true }
}
```

Response (example):

```json
{
  "approved": false,
  "reasons": ["feet_missing", "not_front_facing"],
  "metrics": {
    "width": 900,
    "height": 1200,
    "aspectRatio": 1.33,
    "blurScore": 12.9,
    "brightness": 0.48,
    "bodyCoverage": 0.37,
    "frontalScore": 0.35,
    "landmarkConfidence": 0.55
  },
  "checks": {
    "feetVisible": false,
    "frontFacing": false
  }
}
```

## Local run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8090
```

## Tests

```bash
python3 -m pytest tests
```

## Note

Current implementation is a strict heuristic validator to provide deterministic server-side gating and reason codes.
For production-grade landmark accuracy, replace/augment `app.pose` with a true landmark model pipeline.
