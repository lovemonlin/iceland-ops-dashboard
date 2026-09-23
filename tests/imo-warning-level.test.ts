import assert from "node:assert/strict";
import test from "node:test";
import {
  IMO_RANK_CODE,
  IMO_RANK_LABEL,
  higherImoRank,
  imoLevelLabel,
  imoWarningRank,
  isImoActiveHazardRank,
} from "../src/lib/imoWarningLevel";

test("official colour aliases collapse to one canonical rank", () => {
  assert.equal(imoWarningRank("Yellow"), "yellow");
  assert.equal(imoWarningRank("yellow"), "yellow");
  assert.equal(imoWarningRank("Orange"), "orange");
  assert.equal(imoWarningRank("AMBER"), "orange");
  assert.equal(imoWarningRank("Amber"), "orange");
  assert.equal(imoWarningRank("Red"), "red");
  assert.equal(imoWarningRank("GREEN"), "green");
  assert.equal(imoWarningRank("Green"), "green");
  assert.equal(imoWarningRank("purple"), "unknown");
  assert.equal(imoWarningRank(undefined), "unknown");
});

test("amber is orange in the UI, never a separate level", () => {
  assert.equal(IMO_RANK_CODE[imoWarningRank("Amber")], "ORANGE");
  assert.equal(IMO_RANK_LABEL.orange, "橙色警報");
  assert.match(imoLevelLabel("orange"), /橙色警報/);
});

test("UI labels keep official colour names including cancelled green", () => {
  assert.match(imoLevelLabel("yellow"), /黃色警報/);
  assert.match(imoLevelLabel("red"), /紅色警報/);
  assert.match(imoLevelLabel("green"), /已解除/);
  assert.equal(IMO_RANK_CODE.green, "GREEN");
  assert.equal(IMO_RANK_CODE.unknown, "UNKNOWN");
  assert.match(imoLevelLabel("unknown"), /等級未知/);
});

test("active severity is red over orange over yellow over unknown, and green is excluded", () => {
  assert.equal(higherImoRank("yellow", "orange"), "orange");
  assert.equal(higherImoRank("orange", "red"), "red");
  assert.equal(higherImoRank("unknown", "yellow"), "yellow");
  assert.equal(higherImoRank("green", "yellow"), "yellow");
  assert.equal(higherImoRank("red", "green"), "red");
  assert.equal(isImoActiveHazardRank("green"), false);
  assert.equal(isImoActiveHazardRank("yellow"), true);
  assert.equal(isImoActiveHazardRank("unknown"), true);
});
