"use strict";

async function down() {
  console.log("[schema-catchup] down: no-op (columns/tables retained)");
}

module.exports = { down };
