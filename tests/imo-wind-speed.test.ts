import assert from "node:assert/strict";
import test from "node:test";
import { isWindRelatedImoWarning, splitImoWindSpeeds } from "../src/lib/imoWindSpeed";

function speeds(source: string) {
  return splitImoWindSpeeds(source).filter((part) => part.speed).map((part) => part.value);
}

test("hyphen and en-dash wind ranges keep the original token including m/s", () => {
  assert.deepEqual(speeds("東風 18-25 m/s"), ["18-25 m/s"]);
  assert.deepEqual(speeds("東風 18–25 m/s"), ["18–25 m/s"]);
  assert.deepEqual(speeds("東風 18 - 25 m/s"), ["18 - 25 m/s"]);
  assert.deepEqual(speeds("東風 18 – 25 m/s"), ["18 – 25 m/s"]);
});

test("single, production, and decimal wind speeds are highlighted whole", () => {
  assert.deepEqual(speeds("局部陣風超過 35 m/s"), ["35 m/s"]);
  assert.deepEqual(speeds("東風 20-28 m/s，並伴隨非常強烈的陣風。"), ["20-28 m/s"]);
  assert.deepEqual(speeds("15-23 m/s"), ["15-23 m/s"]);
  assert.deepEqual(speeds("陣風 12.5 m/s"), ["12.5 m/s"]);
});

test("two speeds in one sentence stay separate and unchanged", () => {
  const source = "東南風 18–25 m/s，局部陣風超過 35 m/s";
  assert.deepEqual(speeds(source), ["18–25 m/s", "35 m/s"]);
  assert.equal(splitImoWindSpeeds(source).map((part) => part.value).join(""), source);
});

test("Icelandic place names without m/s are not treated as speeds", () => {
  const source = "南部山區及 Reykjanes 半島附近";
  assert.deepEqual(speeds(source), []);
  assert.deepEqual(splitImoWindSpeeds(source), [{ value: source, speed: false }]);
});

test("wind related warnings follow event or headline wording, not colour", () => {
  const warning = { warningColor: "Yellow", eventEn: "Weather Warning: Wind", headlineEn: "East severe gale" };
  assert.equal(isWindRelatedImoWarning(warning.eventEn, warning.headlineEn), true);
  assert.equal(warning.warningColor, "Yellow");
  assert.equal(isWindRelatedImoWarning(undefined, "East storm and heavy rain"), true);
  assert.equal(isWindRelatedImoWarning(undefined, "Southeast gales"), true);
  assert.equal(isWindRelatedImoWarning("Weather Warning: Precipitation", "Heavy rain"), false);
  assert.equal(isWindRelatedImoWarning("Weather Warning: Precipitation", "Heavy rain 20 m/s"), false);
});
