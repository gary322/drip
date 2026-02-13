# recommender service (placeholder)

Responsibilities:
- Generate image/text embeddings for products + outfits
- Maintain user preference vectors from feedback events
- Serve ranking results for viewport queries and outfit planning

Production notes:
- Use pgvector or a dedicated vector DB
- Add exploration (bandits) + diversity constraints
- Offline evaluation + A/B testing
