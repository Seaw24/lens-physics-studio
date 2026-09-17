import "dotenv/config";
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand,
} from "@aws-sdk/client-dynamodb";

const tableName = process.env.USERS_TABLE_NAME || "momentum-users";
const region = process.env.AWS_REGION || "us-east-1";
const emailIndex = "email-index";
const client = new DynamoDBClient({ region });

function hasEmailIndex(table) {
  return table.GlobalSecondaryIndexes?.some(
    (index) => index.IndexName === emailIndex,
  );
}

async function ensureEmailIndex() {
  const { Table } = await client.send(
    new DescribeTableCommand({ TableName: tableName }),
  );
  if (hasEmailIndex(Table)) {
    console.log(`GSI "${emailIndex}" already exists on "${tableName}".`);
    return;
  }
  console.log(`Adding GSI "${emailIndex}" to "${tableName}"...`);
  await client.send(
    new UpdateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [{ AttributeName: "email", AttributeType: "S" }],
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: emailIndex,
            KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
            Projection: { ProjectionType: "ALL" },
          },
        },
      ],
    }),
  );
  console.log(`GSI "${emailIndex}" is being created (may take a minute).`);
}

try {
  await client.send(new DescribeTableCommand({ TableName: tableName }));
  console.log(`Table "${tableName}" already exists in ${region}.`);
  await ensureEmailIndex();
} catch (error) {
  if (error?.name !== "ResourceNotFoundException") throw error;
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "email", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: emailIndex,
          KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );
  console.log(`Created table "${tableName}" in ${region}.`);
}
