import assert from "node:assert/strict";
import test from "node:test";
import { fisherYatesShuffle } from "../src/random-utils.ts";

test("fisherYatesShuffle uses each shrinking range and preserves the input", () => {
  const input = ["a", "b", "c", "d"];
  const draws = [0, 0.5, 0.99];
  let drawIndex = 0;
  const shuffled = fisherYatesShuffle(input, () => draws[drawIndex++]);

  assert.deepEqual(shuffled, ["d", "c", "b", "a"]);
  assert.deepEqual(input, ["a", "b", "c", "d"]);
  assert.equal(drawIndex, input.length - 1);
});

test("fisherYatesShuffle retains every item exactly once", () => {
  const input = [1, 2, 3, 4, 5, 6];
  const shuffled = fisherYatesShuffle(input, () => 0.25);

  assert.deepEqual([...shuffled].sort((a, b) => a - b), input);
});
