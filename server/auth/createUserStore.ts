import path from "node:path";
import { DynamoUserStore } from "./dynamoStore";
import { FileUserStore } from "./fileStore";
import type { UserStore } from "./userCredentials";

export function createUserStore(env: NodeJS.ProcessEnv = process.env): UserStore {
  const tableName = env.USERS_TABLE_NAME?.trim();
  if (tableName) {
    console.log(`Momentum users: DynamoDB table ${tableName}`);
    return new DynamoUserStore(tableName);
  }
  const root = env.AUTH_RUNTIME_ROOT
    ? path.resolve(env.AUTH_RUNTIME_ROOT)
    : path.resolve(".runtime/users");
  console.log(`Momentum users: local file store at ${root}`);
  return new FileUserStore(root);
}
