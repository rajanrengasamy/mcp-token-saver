import { queryById } from "../utils/db";
import type { User } from "../models/User";

export function getUser(id: string): User {
  queryById(id);
  return {
    id,
    email: `user-${id}@example.com`,
  };
}
