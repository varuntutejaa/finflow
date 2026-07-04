import assert from "node:assert/strict";
import { randomUUID } from "crypto";

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

const creator = await createDemoUser("creator");
const friendOne = await createDemoUser("friend_one");
const friendTwo = await createDemoUser("friend_two");

let group = await createExpenseGroup(creator.id, {
  name: "Trip",
  memberUsernames: [friendOne.username, friendTwo.username],
});

group = await addExpense(group.id, creator.id, {
  description: "Dinner",
  amount: 10000,
  splitType: "equal",
});

const dinner = group.expenses[0];
assert.equal(dinner.splits.reduce((sum, split) => sum + split.shareAmount, 0), 10000);
assert.equal(dinner.splits.find((split) => split.username === creator.username).shareAmount, 3334);
assert.equal(dinner.splits.find((split) => split.username === friendOne.username).shareAmount, 3333);
assert.equal(dinner.splits.find((split) => split.username === friendTwo.username).shareAmount, 3333);

group = await generateSettlements(group.id, creator.id);
assert.equal(group.settlements.length, 2);

let removalError = null;
try {
  await removeGroupMember(group.id, creator.id, friendOne.username);
} catch (err) {
  removalError = err;
}
assert.ok(removalError);
assert.equal(removalError.code, "MEMBER_HAS_FINANCIAL_HISTORY");

const cleanMember = await createDemoUser("clean_member");
const cleanGroup = await createExpenseGroup(creator.id, {
  name: "Clean",
  memberUsernames: [cleanMember.username],
});
const afterRemoval = await removeGroupMember(cleanGroup.id, creator.id, cleanMember.username);
assert.equal(afterRemoval.members.some((member) => member.username === cleanMember.username), false);

console.log("split checklist smoke passed");
