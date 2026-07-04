import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-split-check-"));
process.env.DATA_DIR = tempRoot;

const { createUser } = await import("../src/config/database.js");
const { createExpenseGroup, addExpense, generateSettlements, removeGroupMember } = await import("../src/config/splitDatabase.js");

function createDemoUser(label) {
  const token = randomUUID().slice(0, 8);
  return createUser({
    username: `${label}_${token}`,
    email: `${label}_${token}@example.test`,
    passwordHash: "hash",
    upiPinHash: "pin",
    name: label,
  });
}

const creator = createDemoUser("creator");
const friendOne = createDemoUser("friend_one");
const friendTwo = createDemoUser("friend_two");

let group = createExpenseGroup(creator.id, {
  name: "Trip",
  memberUsernames: [friendOne.username, friendTwo.username],
});

group = addExpense(group.id, creator.id, {
  description: "Dinner",
  amount: 10000,
  splitType: "equal",
});

const dinner = group.expenses[0];
assert.equal(dinner.splits.reduce((sum, split) => sum + split.shareAmount, 0), 10000);
assert.equal(dinner.splits.find((split) => split.username === creator.username).shareAmount, 3334);
assert.equal(dinner.splits.find((split) => split.username === friendOne.username).shareAmount, 3333);
assert.equal(dinner.splits.find((split) => split.username === friendTwo.username).shareAmount, 3333);

group = generateSettlements(group.id, creator.id);
assert.equal(group.settlements.length, 2);

let removalError = null;
try {
  removeGroupMember(group.id, creator.id, friendOne.username);
} catch (err) {
  removalError = err;
}
assert.ok(removalError);
assert.equal(removalError.code, "MEMBER_HAS_FINANCIAL_HISTORY");

const cleanMember = createDemoUser("clean_member");
const cleanGroup = createExpenseGroup(creator.id, {
  name: "Clean",
  memberUsernames: [cleanMember.username],
});
const afterRemoval = removeGroupMember(cleanGroup.id, creator.id, cleanMember.username);
assert.equal(afterRemoval.members.some((member) => member.username === cleanMember.username), false);

console.log("split checklist smoke passed");
