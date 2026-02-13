import { getPool } from "../pool.js";

export async function addItemRating(input: {
  userId: string;
  itemId: string;
  rating: number;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    "INSERT INTO feedback(user_id, item_id, rating) VALUES ($1, $2, $3)",
    [input.userId, input.itemId, input.rating]
  );
}
