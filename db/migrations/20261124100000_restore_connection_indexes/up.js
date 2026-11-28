"use strict";

const indexes = [
  {
    name: "idx_connection_requester_status",
    columns: ["requester_user_id", "status"],
    unique: false
  },
  {
    name: "idx_connection_recipient_status",
    columns: ["recipient_user_id", "status"],
    unique: false
  },
  {
    name: "uq_connection_pair",
    columns: ["requester_user_id", "recipient_user_id"],
    unique: true
  }
];

async function up(conn) {
  const [existing] = await conn.query(
    `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsInOrder
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'member_connections'
     GROUP BY INDEX_NAME, NON_UNIQUE`
  );
  const existingByName = new Map(existing.map((index) => [index.name, index]));
  const missing = indexes.filter(({ name, columns, unique }) => {
    const index = existingByName.get(name);
    if (!index) return true;
    if (index.columnsInOrder !== columns.join(",") || Number(index.nonUnique) !== Number(!unique)) {
      throw new Error(`Existing index ${name} has a different definition`);
    }
    return false;
  });
  if (missing.length === 0) return;

  if (missing.some((index) => index.unique)) {
    const [duplicates] = await conn.query(
      `SELECT 1 FROM member_connections
       GROUP BY requester_user_id, recipient_user_id
       HAVING COUNT(*) > 1
       LIMIT 1`
    );
    if (duplicates.length > 0) {
      throw new Error("Duplicate directed connection pairs must be resolved before adding uq_connection_pair");
    }
  }

  const clauses = missing.map(({ name, columns, unique }) =>
    `ADD ${unique ? "UNIQUE " : ""}INDEX \`${name}\` (${columns.map((column) => `\`${column}\``).join(", ")})`
  );
  await conn.query(
    `ALTER TABLE member_connections ${clauses.join(", ")}, ALGORITHM=INPLACE, LOCK=NONE`
  );
}

module.exports = { up };
