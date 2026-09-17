import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { PublicUser } from "../../shared/auth";
import { AuthError } from "./errors";
import {
  createStoredUser,
  normalizeEmail,
  toPublicUser,
  type StoredUser,
  type UserStore,
  verifyStoredUserPassword,
} from "./userCredentials";

const emailIndex = "email-index";

function storedFromItem(item: Record<string, unknown>): StoredUser {
  return {
    id: String(item.userId),
    email: String(item.email),
    displayName: String(item.displayName),
    passwordHash: String(item.passwordHash),
    passwordSalt: String(item.passwordSalt),
    createdAt: String(item.createdAt),
  };
}

export class DynamoUserStore implements UserStore {
  private doc: DynamoDBDocumentClient;

  constructor(
    private tableName: string,
    client = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1",
    }),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private missingTableError() {
    return new AuthError(
      "USERS_TABLE_MISSING",
      `DynamoDB table "${this.tableName}" was not found in ${process.env.AWS_REGION || "us-east-1"}. Check USERS_TABLE_NAME matches the console exactly.`,
      503,
    );
  }

  private misconfiguredTableError(detail?: string) {
    return new AuthError(
      "USERS_TABLE_MISCONFIGURED",
      detail ||
        `DynamoDB table "${this.tableName}" is missing the "${emailIndex}" index. Run npm run users:create-table or add the GSI in the AWS console.`,
      503,
    );
  }

  private awsAuthError(error: any) {
    if (error?.name === "ResourceNotFoundException") return this.missingTableError();
    if (
      error?.name === "ValidationException" &&
      /index/i.test(String(error?.message || ""))
    )
      return this.misconfiguredTableError();
    if (/AccessDenied|UnauthorizedOperation|ExpiredToken/.test(error?.name || ""))
      return new AuthError(
        "AWS_AUTH_UNAVAILABLE",
        "AWS credentials cannot access the users table. Check IAM permissions and refresh credentials.",
        503,
      );
    return null;
  }

  private async findByEmail(email: string): Promise<StoredUser | null> {
    try {
      const result = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: emailIndex,
          KeyConditionExpression: "email = :email",
          ExpressionAttributeValues: { ":email": email },
          Limit: 1,
        }),
      );
      const item = result.Items?.[0];
      return item ? storedFromItem(item) : null;
    } catch (error: any) {
      throw this.awsAuthError(error) ?? error;
    }
  }

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<PublicUser> {
    const user = await createStoredUser(input);
    const existing = await this.findByEmail(user.email);
    if (existing)
      throw new AuthError(
        "EMAIL_IN_USE",
        "An account with this email already exists.",
        409,
      );
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            userId: user.id,
            email: user.email,
            displayName: user.displayName,
            passwordHash: user.passwordHash,
            passwordSalt: user.passwordSalt,
            createdAt: user.createdAt,
          },
          ConditionExpression: "attribute_not_exists(userId)",
        }),
      );
    } catch (error: any) {
      if (error?.name === "ConditionalCheckFailedException")
        throw new AuthError(
          "EMAIL_IN_USE",
          "An account with this email already exists.",
          409,
        );
      throw this.awsAuthError(error) ?? error;
    }
    return toPublicUser(user);
  }

  async verifyLogin(email: string, password: string): Promise<PublicUser> {
    const user = await this.findByEmail(normalizeEmail(email));
    if (!user)
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
        401,
      );
    return verifyStoredUserPassword(user, password);
  }

  async findById(id: string): Promise<PublicUser | null> {
    try {
      const result = await this.doc.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { userId: id },
        }),
      );
      return result.Item ? toPublicUser(storedFromItem(result.Item)) : null;
    } catch (error: any) {
      throw this.awsAuthError(error) ?? error;
    }
  }
}
