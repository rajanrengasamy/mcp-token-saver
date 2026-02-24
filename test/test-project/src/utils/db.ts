import { USER_TABLE } from "../models/User";

export function queryById(id: string): string {
  return `SELECT * FROM ${USER_TABLE} WHERE id = '${id}'`;
}
