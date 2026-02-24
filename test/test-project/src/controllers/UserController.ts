import { getUser } from "../services/UserService";

export function getUserController(id: string): string {
  return JSON.stringify(getUser(id));
}
