# try-on service (placeholder)

Responsibilities:
- Accept a try-on request (user photoset + product/outfit)
- Run an async pipeline (queue workers)
- Store generated images in object storage
- Return status + signed URLs

Production notes:
- Strong privacy controls (consent, retention, deletion)
- Abuse prevention (watermarking, rate limits)
- Vendor fallback strategy and quality monitoring
